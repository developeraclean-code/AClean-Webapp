/**
 * /api/cron-reminder.js — ALL-IN-ONE CRON
 * Semua tugas cron digabung ke 1 file untuk hemat Serverless Function slot
 *
 * Routes (dipanggil via Vercel Cron atau manual):
 *   POST /api/cron-reminder              → invoice overdue reminder (10:00 UTC)
 *   POST /api/cron-reminder?task=daily   → laporan harian (11:00 UTC)
 *   POST /api/cron-reminder?task=stock   → alert stok (01:00 UTC)
 *   POST /api/cron-reminder?task=cleanup → cleanup foto lama (19:00 UTC tgl 1)
 */

import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/node";
import { timingSafeEqual, createHmac, createHash } from "crypto";
import { initSentry, setCronContext } from "./sentry-init.js";
import { runWithCronLogging, logStructured } from "./_logger.js";
import { verifyAppToken } from "./_auth.js";
import { uploadBufferToR2, hasR2Config } from "./_r2-upload.js";
import { parseKasbonText, matchKasbonName, isKasbonApprovalMessage } from "./_kasbon-parser.js";

// Initialize Sentry
initSentry();

const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const OWNER_PHONE  = process.env.OWNER_PHONE;
if (!OWNER_PHONE) {
  throw new Error("[CRITICAL] OWNER_PHONE environment variable is required but not set");
}
const FONNTE_TOKEN = process.env.FONNTE_TOKEN  || "";

async function sendWA(phone, message) {
  if (!FONNTE_TOKEN || !phone) return false;
  try {
    const r = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { "Authorization": FONNTE_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ target: phone, message, countryCode: "62" }),
    });
    const d = await r.json();
    return d.status === true;
  } catch(e) { return false; }
}

// Cek toggle dari cron_jobs JSON (sumber utama) atau key lama (fallback)
// Mengembalikan true jika job aktif, default ON jika belum diset
function isCronJobEnabled(settingsMap, backendKey) {
  if (settingsMap.cron_jobs) {
    try {
      const jobs = JSON.parse(settingsMap.cron_jobs);
      const job = jobs.find(j => j.backendKey === backendKey);
      if (job) return job.active !== false;
    } catch (_) {}
  }
  // Fallback ke key lama
  return settingsMap[backendKey] !== "false";
}

function fmt(n) { return "Rp" + (Number(n)||0).toLocaleString("id-ID"); }
function daysSince(d) { return d ? Math.floor((Date.now()-new Date(d).getTime())/86400000) : 0; }

async function log(action, detail, status="SUCCESS") {
  try {
    const { error } = await sb.from("agent_logs").insert({
      action, detail, status,
      time: new Date().toISOString()
    });
    if (error) console.error("[CRON_LOG_ERROR]", {action, error: error.message});
  } catch(err) {
    console.error("[CRON_LOG_ERROR]", {action, error: err.message});
  }
}

// ══════════════════════════════════════════════════
// TASK 1: Invoice Reminder (default)
// ══════════════════════════════════════════════════
async function taskReminder() {
  // Indonesia timezone (UTC+7)
  const today = new Date(Date.now() + 7*60*60*1000).toISOString().slice(0,10);
  const res = { reminder1:0, reminder2:0, reminder3:0, escalated:0, autoapproved:0 };

  // Fetch settings dari app_settings
  const { data: bankData } = await sb.from("app_settings")
    .select("key,value")
    .in("key", ["bank_name","bank_number","bank_holder","company_name","invoice_reminder_enabled","cron_jobs"]);
  const bankMap = Object.fromEntries((bankData||[]).map(s=>[s.key, s.value]));

  // Cek toggle — prioritas: cron_jobs JSON > key lama invoice_reminder_enabled
  const isEnabled = isCronJobEnabled(bankMap, "invoice_reminder_enabled");
  if (!isEnabled) {
    await log("CRON_REMINDER", "Dilewati — Payment Reminder dinonaktifkan via Settings", "INFO");
    return { skipped: true, reason: "Payment Reminder dinonaktifkan via Settings" };
  }
  const BANK_NAME   = bankMap.bank_name   || process.env.BANK_NAME;
  const BANK_NUMBER = bankMap.bank_number || process.env.BANK_NUMBER;
  const BANK_HOLDER = bankMap.bank_holder || process.env.BANK_HOLDER;
  if (!BANK_NAME || !BANK_NUMBER || !BANK_HOLDER) {
    await log("CRON_REMINDER", "❌ Bank details tidak lengkap — set BANK_NAME, BANK_NUMBER, BANK_HOLDER di env", "ERROR");
    return { error: "Bank details incomplete", skipped: true };
  }

  // Limit to prevent timeout (Vercel max 30s). Process in batches if needed.
  const { data: invs } = await sb.from("invoices").select("*").in("status",["UNPAID","OVERDUE"]).limit(500);
  for (const inv of invs||[]) {
    const daysOverdue = daysSince(inv.due || inv.sent);
    if (inv.status==="UNPAID" && inv.due && inv.due<today) {
      await sb.from("invoices").update({status:"OVERDUE"}).eq("id",inv.id);
    }
    if (!inv.phone) continue;
    // Tagihan efektif: jika ada DP/paid_amount, tagih sisa (bukan total)
    const paid = Number(inv.paid_amount) || 0;
    const sisaBayar = Math.max(0, (inv.total || 0) - paid);
    const tagihLabel = paid > 0
      ? `sisa pembayaran *${fmt(sisaBayar)}* (total ${fmt(inv.total)} — sudah DP ${fmt(paid)})`
      : `total *${fmt(inv.total)}*`;
    let msg = null;
    if (daysOverdue>=1  && daysOverdue<=7)  { msg=`Halo ${inv.customer} 🙏\n\nPengingat invoice *${inv.id}* — ${tagihLabel}, jatuh tempo ${inv.due}.\n\nTransfer ke: *${BANK_NAME} ${BANK_NUMBER}* a.n. ${BANK_HOLDER}\nTerima kasih! — AClean`; res.reminder1++; }
    else if (daysOverdue>=8  && daysOverdue<=14) { msg=`Halo ${inv.customer},\n\nInvoice *${inv.id}* belum dibayar (${daysOverdue} hari). ${tagihLabel}.\n\nTransfer ke *${BANK_NAME} ${BANK_NUMBER}* a.n. ${BANK_HOLDER}.\n\n— AClean`; res.reminder2++; }
    else if (daysOverdue>=15 && daysOverdue<=21) { msg=`Halo ${inv.customer},\n\nInvoice *${inv.id}* sudah ${daysOverdue} hari lewat jatuh tempo (${tagihLabel}).\n\nAda kendala? Balas pesan ini. — AClean`; res.reminder3++; await sendWA(OWNER_PHONE,`⚠️ OVERDUE ${inv.id} — ${inv.customer} — ${daysOverdue}h — ${fmt(sisaBayar)}`); }
    else if (daysOverdue>=22) { res.escalated++; await sendWA(OWNER_PHONE,`🚨 ESKALASI ${inv.id} — ${inv.customer} — ${daysOverdue}h — ${fmt(sisaBayar)}`); continue; }
    if (msg) { await sendWA(inv.phone, msg); await log("REMINDER_SENT",`${inv.id} — ${daysOverdue}d`); }
  }

  // Auto-approve PENDING_APPROVAL > 6 jam
  // Cleaning/Install: UNPAID (ada tagihan)
  // Repair/Complain gratis (total=0): langsung PAID (tidak perlu tagih)
  const { data: pend } = await sb.from("invoices").select("*").eq("status","PENDING_APPROVAL").limit(300);
  for (const inv of pend||[]) {
    const hrs = (Date.now()-new Date(inv.created_at).getTime())/3600000;
    if (hrs < 6) continue;
    const isZero = (inv.total || 0) === 0;
    if (isZero) {
      // Invoice Rp 0 (repair gratis/garansi) — auto-PAID tanpa tagih
      await sb.from("invoices").update({status:"PAID",paid_at:new Date().toISOString(),approved_by:"CRON_AUTO",approved_at:new Date().toISOString()}).eq("id",inv.id);
      res.autoapproved++;
      await sendWA(OWNER_PHONE,`ℹ️ Invoice *${inv.id}* (${inv.customer}) Rp 0 — auto-PAID (gratis/garansi).`);
    } else if (/(Cleaning|Install|Repair|Complain)/.test(inv.service||"")) {
      const due = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
      await sb.from("invoices").update({status:"UNPAID",sent:true,due,approved_by:"CRON_AUTO",approved_at:new Date().toISOString()}).eq("id",inv.id);
      res.autoapproved++;
      await sendWA(OWNER_PHONE,`ℹ️ Invoice *${inv.id}* (${inv.customer}) auto-approved setelah ${Math.round(hrs)}j. Total: ${fmt(inv.total)} — kirim manual dari app.`);
    }
  }

  // Update UNPAID lewat due → OVERDUE (Indonesia timezone UTC+7)
  const nowStr = new Date(Date.now() + 7*60*60*1000).toISOString().slice(0,10);
  await sb.from("invoices").update({status:"OVERDUE"}).eq("status","UNPAID").lt("due",nowStr);
  await log("CRON_REMINDER",`r1=${res.reminder1} r2=${res.reminder2} r3=${res.reminder3} esc=${res.escalated} auto=${res.autoapproved}`);
  return res;
}

// ══════════════════════════════════════════════════
// TASK 2: Daily Report
// ══════════════════════════════════════════════════
async function taskDaily() {
  // Cek toggle — prioritas: cron_jobs JSON > key lama daily_report_enabled
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["daily_report_enabled","cron_jobs"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key, s.value]));
  if (!isCronJobEnabled(togMap, "daily_report_enabled")) {
    await log("DAILY_REPORT", "Dilewati — Laporan Harian dinonaktifkan via Settings", "INFO");
    return { skipped: true };
  }
  // Indonesia timezone (UTC+7)
  const today = new Date(Date.now() + 7*60*60*1000).toISOString().slice(0,10);
  const [{ data:orders }, { data:invoices }, { data:laporan }, { data:expenses }] = await Promise.all([
    sb.from("orders").select("id,service,status").eq("date",today),
    sb.from("invoices").select("id,total,status").gte("created_at",today+"T00:00:00"),
    sb.from("service_reports").select("id,status").eq("date",today),
    sb.from("expenses").select("amount").gte("date",today).lte("date",today),
  ]);

  const ordArr = orders||[];
  const invArr = invoices||[];
  const lapArr = laporan||[];

  // Service breakdown
  const svcCount = {};
  ordArr.forEach(o => { const s = o.service||"Lainnya"; svcCount[s]=(svcCount[s]||0)+1; });
  const svcOrder = ["Cleaning","Install","Repair","Complain"];
  const svcLines = svcOrder.filter(s=>svcCount[s]).map(s=>`  • ${s}: ${svcCount[s]}`);
  Object.keys(svcCount).filter(s=>!svcOrder.includes(s)).forEach(s=>svcLines.push(`  • ${s}: ${svcCount[s]}`));

  const totalOrders = ordArr.length;
  const done   = ordArr.filter(o=>o.status==="COMPLETED").length;
  const proses = ordArr.filter(o=>["ON_SITE","WORKING"].includes(o.status)).length;

  // Invoice summary
  const invPaid    = invArr.filter(i=>i.status==="PAID");
  const invUnpaid  = invArr.filter(i=>["UNPAID","OVERDUE"].includes(i.status));
  const masuk  = invPaid.reduce((s,i)=>s+(i.total||0),0);
  const pending = invUnpaid.reduce((s,i)=>s+(i.total||0),0);

  // Expenses
  const totalExp = (expenses||[]).reduce((s,e)=>s+(Number(e.amount)||0),0);
  const nett = masuk - totalExp;

  // Report counts
  const lapVerified  = lapArr.filter(r=>r.status==="VERIFIED").length;
  const lapSubmitted = lapArr.filter(r=>r.status==="SUBMITTED").length;

  const tgl = new Date(Date.now()+7*60*60*1000).toLocaleDateString("id-ID",{weekday:"long",year:"numeric",month:"long",day:"numeric"});

  let msg = `📊 *LAPORAN HARIAN ACLEAN*\n${tgl}\n\n`;
  msg += `🔧 *ORDER HARI INI: ${totalOrders}*\n`;
  msg += svcLines.join("\n");
  msg += `\n  ✅ Selesai: ${done} · 🔄 Proses: ${proses}\n\n`;
  msg += `📝 *LAPORAN TEKNISI: ${lapArr.length}*\n`;
  msg += `  • Terverifikasi: ${lapVerified}\n`;
  msg += `  • Submitted: ${lapSubmitted}\n\n`;
  msg += `💳 *INVOICE: ${invArr.length}*\n`;
  msg += `  • Lunas: ${invPaid.length} (${fmt(masuk)})\n`;
  msg += `  • Belum bayar: ${invUnpaid.length} (${fmt(pending)})\n\n`;
  if (totalExp > 0) {
    msg += `💸 *PENGELUARAN: ${fmt(totalExp)}*\n`;
    msg += `📈 Nett Hari Ini: *${fmt(nett)}*\n\n`;
  } else {
    msg += `📈 Pemasukan Hari Ini: *${fmt(masuk)}*\n\n`;
  }
  msg += `_ARA AClean_`;

  const waSent = await sendWA(OWNER_PHONE, msg);
  await log("DAILY_REPORT",`${totalOrders} order, ${lapArr.length} laporan, ${fmt(masuk)} masuk`);
  return { orders:totalOrders, revenue:masuk, laporanCount:lapArr.length, waSent };
}

// ══════════════════════════════════════════════════
// TASK 3: Stock Alert
// ══════════════════════════════════════════════════
async function taskStock() {
  // Cek toggle — prioritas: cron_jobs JSON > key lama stock_alert_enabled
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["stock_alert_enabled","cron_jobs"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key, s.value]));
  if (!isCronJobEnabled(togMap, "stock_alert_enabled")) {
    await log("STOCK_ALERT", "Dilewati — Stok Alert dinonaktifkan via Settings", "INFO");
    return { skipped: true };
  }
  const { data:items } = await sb.from("inventory").select("*").in("status",["CRITICAL","OUT"]);
  if (!items?.length) return { message:"Semua stok aman" };
  const out  = items.filter(i=>i.status==="OUT");
  const crit = items.filter(i=>i.status==="CRITICAL");
  let msg = `⚠️ *ALERT STOK ACLEAN*\n${new Date().toLocaleDateString("id-ID")}\n\n`;
  if (out.length)  { msg+=`🔴 *HABIS (${out.length}):*\n`;  out.forEach(i=>{msg+=`• ${i.name}: 0 ${i.unit}\n`;}); msg+="\n"; }
  if (crit.length) { msg+=`🟠 *KRITIS (${crit.length}):*\n`; crit.forEach(i=>{msg+=`• ${i.name}: ${i.stock} ${i.unit}\n`;}); }
  msg += "\n_Segera restock. — ARA AClean_";
  await sendWA(OWNER_PHONE, msg);
  await log("STOCK_ALERT",`${out.length} habis, ${crit.length} kritis`,"WARNING");
  return { out:out.length, critical:crit.length };
}

// ──────────────────────────────────────────────────
// AWS Sig V4 Delete for R2 Objects
// ──────────────────────────────────────────────────
async function deleteR2Object(key) {
  const { createHmac, createHash } = await import("crypto");
  const accessKeyId = process.env.R2_ACCESS_KEY;
  const secretAccessKey = process.env.R2_SECRET_KEY;
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME || "aclean-files";

  if (!accessKeyId || !secretAccessKey || !accountId) {
    console.warn("[CLEANUP_R2] R2 credentials not configured, skipping delete");
    return false;
  }

  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0,10).replace(/-/g,"");
    const timeStr = now.toISOString().replace(/[-:\.]/g,"").slice(0,15) + "Z";
    const host = accountId + ".r2.cloudflarestorage.com";
    const region = "auto", service = "s3";

    const canonicalUri = "/" + bucket + "/" + key;
    const payloadHash = createHash("sha256").update("").digest("hex");
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timeStr}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = ["DELETE", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

    const credScope = [dateStr, region, service, "aws4_request"].join("/");
    const strToSign = ["AWS4-HMAC-SHA256", timeStr, credScope,
      createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");

    const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
    const signingKey = hmac(hmac(hmac(hmac("AWS4"+secretAccessKey, dateStr), region), service), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(strToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const r = await fetch("https://" + host + canonicalUri, {
      method: "DELETE",
      headers: {
        "Host": host,
        "x-amz-date": timeStr,
        "x-amz-content-sha256": payloadHash,
        "Authorization": authorization
      }
    });
    return r.ok || r.status === 204 || r.status === 404;
  } catch(e) {
    console.error("[CLEANUP_R2_DELETE_ERROR]", {key, error: e.message});
    return false;
  }
}

// ══════════════════════════════════════════════════
// TASK 4: Cleanup foto lama (>360 hari) dari R2
// ══════════════════════════════════════════════════
async function taskCleanup() {
  const result = { agent_logs: 0, audit_log: 0, dispatch_logs: 0, payment_suggestions: 0 };

  // Cutoffs retensi: agent_logs & audit_log = 30 hari, dispatch_logs = 90 hari
  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const cutoff90 = new Date(Date.now() - 90 * 86400000).toISOString();

  // 1. Cleanup agent_logs > 30 hari (diperpendek dari 90 — kurangi ukuran tabel & beban DB)
  const { error: logDelErr, count: logCount } = await sb.from("agent_logs")
    .delete({ count: "exact" }).lt("created_at", cutoff30);
  if (logDelErr) console.error("[CLEANUP_AGENT_LOGS]", logDelErr.message);
  else result.agent_logs = logCount || 0;

  // 2. Cleanup audit_log > 30 hari (tumbuh paling cepat ~15MB/bulan)
  const { error: auditDelErr, count: auditCount } = await sb.from("audit_log")
    .delete({ count: "exact" }).lt("changed_at", cutoff30);
  if (auditDelErr) console.error("[CLEANUP_AUDIT_LOG]", auditDelErr.message);
  else result.audit_log = auditCount || 0;

  // 3. Cleanup dispatch_logs > 90 hari
  const { error: dispDelErr, count: dispCount } = await sb.from("dispatch_logs")
    .delete({ count: "exact" }).lt("sent_at", cutoff90);
  if (dispDelErr) console.error("[CLEANUP_DISPATCH_LOGS]", dispDelErr.message);
  else result.dispatch_logs = dispCount || 0;

  // 4. Cleanup payment_suggestions RESOLVED/REJECTED > 30 hari
  const { error: suggDelErr, count: suggCount } = await sb.from("payment_suggestions")
    .delete({ count: "exact" })
    .in("status", ["RESOLVED", "REJECTED"])
    .lt("created_at", cutoff30);
  if (suggDelErr) console.error("[CLEANUP_PAYMENT_SUGGESTIONS]", suggDelErr.message);
  else result.payment_suggestions = suggCount || 0;

  const summary = `agent_logs: ${result.agent_logs} | audit_log: ${result.audit_log} | dispatch_logs: ${result.dispatch_logs} | payment_suggestions: ${result.payment_suggestions}`;
  await log("CLEANUP", summary, "SUCCESS");
  return result;
}

// ══════════════════════════════════════════════════

// ══════════════════════════════════════════════════
// TASK 5b: Cleanup R2 mirror untuk image grup WA (>90 hari)
// — Image grup di-mirror ke R2 saat masuk (audit trail Phase 1 WA AI).
//   Setelah 90 hari, hapus dari R2 untuk privacy + cost. Row di wa_group_logs
//   tetap tersimpan (metadata only) dengan r2_purged_at terisi.
// ══════════════════════════════════════════════════
async function taskR2Cleanup90d() {
  const result = { swept: 0, purged: 0, errors: 0 };
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();

  const { data: rows, error } = await sb.from("wa_group_logs")
    .select("id, r2_image_url, r2_uploaded_at")
    .lt("r2_uploaded_at", cutoff)
    .is("r2_purged_at", null)
    .not("r2_image_url", "is", null)
    .limit(500);
  if (error) {
    await log("R2_CLEANUP_90D", "Query gagal: " + error.message, "ERROR");
    return { error: error.message };
  }
  result.swept = (rows || []).length;
  if (result.swept === 0) {
    await log("R2_CLEANUP_90D", "Tidak ada image >90 hari", "INFO");
    return result;
  }

  for (const row of rows) {
    try {
      // Ekstrak key dari URL (format: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>)
      const url = new URL(row.r2_image_url);
      const parts = url.pathname.split("/").filter(Boolean);
      const key = parts.slice(1).join("/"); // skip bucket name
      if (!key) { result.errors++; continue; }
      const ok = await deleteR2Object(key);
      if (ok) {
        await sb.from("wa_group_logs").update({ r2_purged_at: new Date().toISOString() }).eq("id", row.id);
        result.purged++;
      } else {
        result.errors++;
      }
    } catch (e) {
      result.errors++;
      console.warn("[R2_CLEANUP_90D]", row.id, e.message);
    }
  }

  await log("R2_CLEANUP_90D", `swept=${result.swept} purged=${result.purged} errors=${result.errors}`, "SUCCESS");
  return result;
}

// ══════════════════════════════════════════════════
// TASK: Expense Foto Cleanup — hapus foto R2 pengeluaran teknisi >30 hari
// Sumber: ai_extractions source='teknisi_dashboard'. Record expense TETAP (data keuangan),
// hanya foto bukti yang di-purge agar R2 tidak numpuk. r2_url di-null setelah purge.
// ══════════════════════════════════════════════════
async function taskExpenseFotoCleanup30d() {
  // Toggle-gated (default ON kecuali eksplisit "false")
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key", ["expense_foto_cleanup_enabled"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (togMap["expense_foto_cleanup_enabled"] === "false") {
    await log("EXPENSE_FOTO_CLEANUP", "Dilewati — toggle OFF", "INFO");
    return { skipped: true };
  }

  const result = { swept: 0, purged: 0, errors: 0 };
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: rows, error } = await sb.from("ai_extractions")
    .select("id, r2_url")
    .eq("source", "teknisi_dashboard")
    .lt("created_at", cutoff)
    .not("r2_url", "is", null)
    .limit(500);
  if (error) { await log("EXPENSE_FOTO_CLEANUP", "Query gagal: " + error.message, "ERROR"); return { error: error.message }; }
  result.swept = (rows || []).length;
  if (result.swept === 0) { await log("EXPENSE_FOTO_CLEANUP", "Tidak ada foto >30 hari", "INFO"); return result; }

  for (const row of rows) {
    try {
      // r2_url format: "/api/foto?key=<encoded>" → ekstrak key
      let key = null;
      try { key = new URL("http://x" + row.r2_url).searchParams.get("key"); } catch { key = null; }
      if (!key) { result.errors++; continue; }
      const ok = await deleteR2Object(key);
      if (ok) {
        await sb.from("ai_extractions").update({ r2_url: null }).eq("id", row.id);
        result.purged++;
      } else { result.errors++; }
    } catch (e) { result.errors++; console.warn("[EXPENSE_FOTO_CLEANUP]", row.id, e.message); }
  }
  await log("EXPENSE_FOTO_CLEANUP", `swept=${result.swept} purged=${result.purged} errors=${result.errors}`, "SUCCESS");
  return result;
}

// ══════════════════════════════════════════════════
// TASK: WA Daily Snapshot — Phase 2 review window
// Dump seluruh percakapan 3 grup ke R2 JSON tiap hari jam 20:00 WIB
// Window awal: 2026-06-04 → 2026-06-11 (review pattern utk tuning rule)
// ══════════════════════════════════════════════════
async function taskWaSnapshot() {
  if (!hasR2Config()) return { skipped: true, reason: "no_r2_config" };
  // Tanggal target = hari ini WIB (cron jalan 20:00 WIB, ambil snapshot data hari ini)
  const nowUtcMs = Date.now();
  const wibMs = nowUtcMs + 7 * 3600_000;
  const dateStr = new Date(wibMs).toISOString().slice(0, 10);
  // Boundary WIB → UTC ISO untuk query Postgres
  const startWibUtcIso = new Date(Date.parse(dateStr + "T00:00:00+07:00")).toISOString();
  const endWibUtcIso = new Date(Date.parse(dateStr + "T23:59:59.999+07:00")).toISOString();

  // 1) Ambil monitored groups
  const { data: groups } = await sb.from("wa_monitored_groups")
    .select("group_id,group_name,enabled,capture_all,ai_expense_enabled,ai_material_enabled,ai_payment_enabled,ai_selesai_enabled,ai_quotation_enabled,ai_kasbon_enabled");
  const enabledGroups = (groups || []).filter(g => g.enabled);

  // 2) Per-group: ambil semua wa_group_logs hari ini
  const perGroup = [];
  let totalMessages = 0;
  let totalWithImage = 0;
  for (const g of enabledGroups) {
    const { data: logs } = await sb.from("wa_group_logs")
      .select("id,sender_phone,sender_name,type,content,parsed_ok,amount,job_id,image_url,r2_image_url,metadata,forwarded,created_at")
      .eq("group_id", g.group_id)
      .gte("created_at", startWibUtcIso)
      .lte("created_at", endWibUtcIso)
      .order("created_at", { ascending: true });
    const rows = logs || [];
    const withImg = rows.filter(r => !!r.image_url).length;
    totalMessages += rows.length;
    totalWithImage += withImg;
    perGroup.push({
      group_id: g.group_id,
      group_name: g.group_name,
      toggles: {
        capture_all: g.capture_all,
        ai_expense: g.ai_expense_enabled,
        ai_material: g.ai_material_enabled,
        ai_payment: g.ai_payment_enabled,
        ai_selesai: g.ai_selesai_enabled,
        ai_quotation: g.ai_quotation_enabled,
        ai_kasbon: g.ai_kasbon_enabled,
      },
      stats: { total: rows.length, with_image: withImg, parsed_ok: rows.filter(r => r.parsed_ok).length },
      messages: rows.map(r => ({
        id: r.id,
        wib: new Date(new Date(r.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 19),
        sender_phone: r.sender_phone,
        sender_name: r.sender_name,
        type: r.type,
        content: r.content,
        parsed_ok: r.parsed_ok,
        amount: r.amount,
        job_id: r.job_id,
        has_image: !!r.image_url,
        r2_image_url: r.r2_image_url,
        md5: r.metadata?.img_md5 || null,
        dup_of_log_id: r.metadata?.dup_of_log_id || null,
        forwarded: r.forwarded,
      })),
    });
  }

  // 3) AI extractions hari ini (cross-grup)
  const { data: aiRows } = await sb.from("ai_extractions")
    .select("id,group_id,sender_phone,sender_name,intent,confidence,status,extracted,notes,model,cost_usd,linked_table,linked_id,created_at")
    .gte("created_at", startWibUtcIso)
    .lte("created_at", endWibUtcIso)
    .order("created_at", { ascending: true });
  const aiArr = (aiRows || []).map(r => ({
    id: r.id, group_id: r.group_id, sender_name: r.sender_name,
    intent: r.intent, confidence: r.confidence, status: r.status,
    extracted: r.extracted, notes: r.notes, model: r.model, cost_usd: r.cost_usd,
    linked_table: r.linked_table, linked_id: r.linked_id,
    wib: new Date(new Date(r.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 19),
  }));

  // 4) Expenses dari WA grup hari ini
  const { data: expRows } = await sb.from("expenses")
    .select("id,date,subcategory,teknisi_name,amount,description,validation_status,created_by,created_at")
    .eq("date", dateStr)
    .in("created_by", ["wa_group", "wa_group_kasbon", "wa_group_ai"])
    .order("created_at", { ascending: true });
  const expArr = (expRows || []).map(r => ({
    id: r.id, subcategory: r.subcategory, teknisi_name: r.teknisi_name, amount: r.amount,
    description: r.description, validation_status: r.validation_status, created_by: r.created_by,
    wib: new Date(new Date(r.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 19),
  }));

  // 5) Payment suggestions hari ini
  const { data: paySuggRows } = await sb.from("payment_suggestions")
    .select("id,phone,sender_name,amount,bank,transfer_date,invoice_id,status,source,created_at")
    .gte("created_at", startWibUtcIso)
    .lte("created_at", endWibUtcIso)
    .order("created_at", { ascending: true });
  const paySuggArr = (paySuggRows || []).map(r => ({
    id: r.id, sender_name: r.sender_name, amount: r.amount, bank: r.bank,
    invoice_id: r.invoice_id, status: r.status, source: r.source,
    wib: new Date(new Date(r.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 19),
  }));

  const snapshot = {
    snapshot_date: dateStr,
    generated_at_utc: new Date().toISOString(),
    generated_at_wib: new Date(wibMs).toISOString().slice(0, 19) + "+07:00",
    summary: {
      groups: enabledGroups.length,
      total_messages: totalMessages,
      total_with_image: totalWithImage,
      total_ai_classified: aiArr.length,
      total_expenses_inserted: expArr.length,
      total_payment_suggestions: paySuggArr.length,
    },
    groups: perGroup,
    ai_extractions: aiArr,
    expenses_from_wa: expArr,
    payment_suggestions: paySuggArr,
  };

  // 6) Upload ke R2
  const json = JSON.stringify(snapshot, null, 2);
  const buf = Buffer.from(json, "utf8");
  const r2Key = `wa-snapshots/${dateStr}.json`;
  const up = await uploadBufferToR2({ buffer: buf, key: r2Key, mimeType: "application/json" });
  if (!up.ok) {
    await Sentry.captureMessage(`taskWaSnapshot R2 upload failed: ${up.err}`, "warning");
    return { ok: false, error: "r2_upload_failed", detail: up.err };
  }

  // 7) Save manifest di wa_daily_snapshots (UPSERT)
  await sb.from("wa_daily_snapshots").upsert({
    snapshot_date: dateStr,
    r2_key: r2Key,
    r2_url: up.url,
    groups_count: enabledGroups.length,
    total_messages: totalMessages,
    total_with_image: totalWithImage,
    total_ai_classified: aiArr.length,
    total_expenses_inserted: expArr.length,
    size_bytes: buf.length,
    notes: `Auto-snapshot phase 2 review window`,
  }, { onConflict: "snapshot_date" });

  return {
    ok: true,
    date: dateStr,
    r2_url: up.url,
    summary: snapshot.summary,
  };
}

// ══════════════════════════════════════════════════
// TASK: WA Backfill — re-parse wa_group_logs ke expenses Pending AI
// Re-run text-pattern biaya + kasbon parser + approval handler untuk
// pesan yang ketinggalan (e.g. deploy baru, parser improvement).
// AI Vision TIDAK di-re-run (mahal). Idempotent via dedup expense
// (date+teknisi+amount+created_by).
//
// Query: ?task=wa-backfill&from=YYYY-MM-DD&to=YYYY-MM-DD
// Default: hari ini (WIB) saja
// ══════════════════════════════════════════════════
async function taskWaBackfill(opts = {}) {
  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SU || !SK) return { skipped: true, reason: "no_supabase_env" };

  const todayWib = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const fromDate = opts.from || todayWib;
  const toDate = opts.to || fromDate;
  const startIso = new Date(Date.parse(fromDate + "T00:00:00+07:00")).toISOString();
  const endIso = new Date(Date.parse(toDate + "T23:59:59.999+07:00")).toISOString();

  // Cek dup expense — sama date+teknisi_name+amount+created_by berarti sudah ada
  const expenseAlreadyExists = async ({ date, teknisi_name, amount, created_by }) => {
    const url = SU + "/rest/v1/expenses?select=id"
      + "&date=eq." + date
      + "&teknisi_name=eq." + encodeURIComponent(teknisi_name || "")
      + "&amount=eq." + amount
      + "&created_by=eq." + created_by
      + "&limit=1";
    const r = await fetch(url, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  };

  // Ambil grup config (utk filter ai_kasbon_enabled per grup)
  const { data: groupsCfg } = await sb.from("wa_monitored_groups")
    .select("group_id,group_name,ai_kasbon_enabled,ai_expense_enabled");
  const cfgMap = Object.fromEntries((groupsCfg || []).map(g => [g.group_id, g]));

  // Ambil semua logs dalam range
  const { data: logs } = await sb.from("wa_group_logs")
    .select("id,sender_phone,sender_name,group_id,group_name,type,content,parsed_ok,amount,created_at,metadata")
    .gte("created_at", startIso).lte("created_at", endIso)
    .order("created_at", { ascending: true })
    .limit(2000);

  const counters = {
    logs_scanned: (logs || []).length,
    kasbon_single_inserted: 0,
    kasbon_multi_inserted: 0,
    biaya_inserted: 0,
    approval_acked: 0,
    skipped_dup: 0,
    skipped_no_match: 0,
  };

  for (const lg of (logs || [])) {
    const cfg = cfgMap[lg.group_id];
    if (!cfg) continue;
    const date = new Date(new Date(lg.created_at).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const profileName = lg.sender_name || lg.sender_phone;
    const text = lg.content || "";

    // ── KASBON parser ──
    if (cfg.ai_kasbon_enabled) {
      const k = parseKasbonText(text);
      if (k) {
        if (k.multi && Array.isArray(k.items)) {
          for (const it of k.items) {
            const mr = await matchKasbonName({ SU, SK, nameRaw: it.nameRaw });
            if (!mr.matched) { counters.skipped_no_match++; continue; }
            const dup = await expenseAlreadyExists({ date, teknisi_name: mr.matched.name, amount: it.amount, created_by: "wa_group_kasbon" });
            if (dup) { counters.skipped_dup++; continue; }
            await fetch(SU + "/rest/v1/expenses", {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
              body: JSON.stringify({
                date, category: "petty_cash", subcategory: "Kasbon Karyawan",
                teknisi_name: mr.matched.name, amount: it.amount,
                description: `Kasbon ${mr.matched.name} (via WA Finance grup, dari ${profileName}) [BACKFILL]`,
                created_by: "wa_group_kasbon", validation_status: "PENDING_AI",
              }),
            }).catch(e => {
              try { Sentry.captureException(e, { tags: { op: "backfill_kasbon_multi_insert" }, extra: { teknisi: mr.matched.name, amount: it.amount, date } }); } catch (_) {}
            });
            counters.kasbon_multi_inserted++;
          }
        } else if (k.nameRaw) {
          const mr = await matchKasbonName({ SU, SK, nameRaw: k.nameRaw });
          if (!mr.matched) { counters.skipped_no_match++; continue; }
          const dup = await expenseAlreadyExists({ date, teknisi_name: mr.matched.name, amount: k.amount, created_by: "wa_group_kasbon" });
          if (dup) { counters.skipped_dup++; continue; }
          await fetch(SU + "/rest/v1/expenses", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
            body: JSON.stringify({
              date, category: "petty_cash", subcategory: "Kasbon Karyawan",
              teknisi_name: mr.matched.name, amount: k.amount,
              description: `Kasbon ${mr.matched.name} (via WA Finance grup, dari ${profileName}) [BACKFILL]`,
              created_by: "wa_group_kasbon", validation_status: "PENDING_AI",
            }),
          }).catch(e => {
            try { Sentry.captureException(e, { tags: { op: "backfill_kasbon_single_insert" }, extra: { teknisi: mr.matched.name, amount: k.amount, date } }); } catch (_) {}
          });
          counters.kasbon_single_inserted++;
        }
      }
    }

    // ── KASBON APPROVAL (annotate) ──
    if (cfg.ai_kasbon_enabled && isKasbonApprovalMessage(text)) {
      const APPROVERS = ["6281398989837", "6281289898937"];
      if (APPROVERS.includes(lg.sender_phone)) {
        const qUrl = SU + "/rest/v1/expenses?select=id,description"
          + "&validation_status=eq.PENDING_AI&subcategory=eq." + encodeURIComponent("Kasbon Karyawan")
          + "&date=eq." + date + "&created_by=eq.wa_group_kasbon"
          + "&description=not.ilike." + encodeURIComponent("%[ACK by%");
        const qRes = await fetch(qUrl, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
        const pendings = qRes.ok ? await qRes.json() : [];
        if (Array.isArray(pendings) && pendings.length > 0) {
          const hh = new Date(new Date(lg.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 16);
          const ackTag = ` [ACK by ${lg.sender_phone} at ${hh}]`;
          await Promise.all(pendings.map(p =>
            fetch(SU + "/rest/v1/expenses?id=eq." + p.id, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
              body: JSON.stringify({ description: (p.description || "") + ackTag }),
            }).catch(() => {})
          ));
          counters.approval_acked += pendings.length;
        }
      }
    }

    // ── BIAYA text-pattern (bensin/parkir/etc) ──
    if (cfg.ai_expense_enabled) {
      const biayaMatch = text.match(/^(bensin|makan|parkir|tol|belanja|beli|transport|bbm|solar|pertamax|consumable)[\s:]+(.+)/i);
      if (biayaMatch) {
        let nominalStr = biayaMatch[2]
          .replace(/(\d+)\s*(jt|juta)/gi, (_, n) => String(parseInt(n) * 1000000))
          .replace(/(\d+)\s*(rb|ribu|k)/gi, (_, n) => String(parseInt(n) * 1000));
        const nominalMatch = nominalStr.match(/[\d]{4,}/);
        if (nominalMatch) {
          const amt = parseInt(nominalMatch[0]);
          const k = biayaMatch[1].toLowerCase();
          const subcat = ["bensin","bbm","pertamax","solar"].includes(k) ? "Bensin Motor"
            : k === "parkir" ? "Parkir" : "Lain-lain";
          const dup = await expenseAlreadyExists({ date, teknisi_name: profileName, amount: amt, created_by: "wa_group" });
          if (!dup) {
            await fetch(SU + "/rest/v1/expenses", {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
              body: JSON.stringify({
                date, category: "petty_cash", subcategory: subcat,
                description: text + " (via WA grup) [BACKFILL]",
                amount: amt, teknisi_name: profileName,
                created_by: "wa_group", validation_status: "PENDING_AI",
              }),
            }).catch(() => {});
            counters.biaya_inserted++;
          } else {
            counters.skipped_dup++;
          }
        }
      }
    }
  }

  return { ok: true, from: fromDate, to: toDate, counters };
}

// ══════════════════════════════════════════════════
// TASK: Snapshot cleanup — retention 60 hari
// Hapus wa_daily_snapshots + objek R2 yg > 60 hari
// (R2 object cleanup pakai pattern existing taskR2Cleanup90d).
// ══════════════════════════════════════════════════
async function taskSnapshotCleanup() {
  const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
  // Ambil rows yg expired (utk delete R2 objects nanti)
  const { data: stale } = await sb.from("wa_daily_snapshots")
    .select("id,snapshot_date,r2_key")
    .lt("snapshot_date", cutoff);
  const count = (stale || []).length;
  if (count === 0) return { ok: true, deleted: 0, cutoff };
  // Note: R2 object delete via taskR2Cleanup90d (pattern existing); kalau mau lebih cepat
  // tambah delete object di sini — saat ini cukup hapus manifest, R2 di-purge cron 90d.
  await sb.from("wa_daily_snapshots").delete().lt("snapshot_date", cutoff);
  return { ok: true, deleted: count, cutoff, note: "R2 objects akan di-purge cron r2-cleanup-90d" };
}

// ══════════════════════════════════════════════════
// TASK 6: Cleanup WA chat lama (>14 hari)
// ══════════════════════════════════════════════════
async function taskWaCleanup() {
  // Cek toggle — bisa dimatikan via Settings
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["wa_cleanup_enabled"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key, s.value]));
  if (togMap.wa_cleanup_enabled === "false") {
    await log("WA_CLEANUP", "Dilewati — WA Auto-Cleanup dinonaktifkan via Settings", "INFO");
    return { skipped: true };
  }

  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();

  // Hapus wa_messages lama — kecuali yang masih ada payment_suggestions PENDING terkait
  // Ambil phone yang masih punya suggestion aktif agar tidak dihapus dulu
  const { data: pendingSugg } = await sb.from("payment_suggestions")
    .select("phone").eq("status", "PENDING");
  const protectedPhones = [...new Set((pendingSugg || []).map(p => p.phone))];

  // Hapus messages lama — batchkan per phone yang tidak dilindungi
  let msgsDeleted = 0;
  const { data: oldMsgs, error: msgErr } = await sb.from("wa_messages")
    .select("id, phone")
    .lt("created_at", cutoff)
    .limit(500);

  if (!msgErr && oldMsgs?.length > 0) {
    const toDelete = oldMsgs.filter(m => !protectedPhones.includes(m.phone)).map(m => m.id);
    if (toDelete.length > 0) {
      const { error: delMsgErr } = await sb.from("wa_messages").delete().in("id", toDelete);
      if (!delMsgErr) msgsDeleted = toDelete.length;
      else console.error("[WA_CLEANUP_MSG]", delMsgErr.message);
    }
  }

  // Hapus wa_conversations lama — updated_at > 14 hari dan bukan di protected phones
  let convsDeleted = 0;
  const { data: oldConvs, error: convErr } = await sb.from("wa_conversations")
    .select("id, phone")
    .lt("updated_at", cutoff)
    .limit(200);

  if (!convErr && oldConvs?.length > 0) {
    const toDeleteConv = oldConvs.filter(c => !protectedPhones.includes(c.phone)).map(c => c.id);
    if (toDeleteConv.length > 0) {
      const { error: delConvErr } = await sb.from("wa_conversations").delete().in("id", toDeleteConv);
      if (!delConvErr) convsDeleted = toDeleteConv.length;
      else console.error("[WA_CLEANUP_CONV]", delConvErr.message);
    }
  }

  await log("WA_CLEANUP", `${msgsDeleted} pesan & ${convsDeleted} conversations dihapus (>14 hari). ${protectedPhones.length} phone dilindungi (ada payment pending).`);
  return { msgsDeleted, convsDeleted, protectedPhones: protectedPhones.length };
}

// ══════════════════════════════════════════════════
// TASK 6: Scan Bukti Bayar — cocokkan payment_suggestions ke invoice PAID tanpa bukti
// Sumber data: tabel payment_suggestions (lebih reliable dari R2 listing)
// Jalan setiap jam 02:00-11:00 UTC (Mon-Sat) via vercel.json crons
// ══════════════════════════════════════════════════
async function taskScanBuktiBayar() {
  // Ambil invoice PAID tanpa bukti:
  // - Minimum: 2026-05-01 (fungsi baru, data sebelumnya tidak reliable)
  // - Maximum lookback: 90 hari dari sekarang (untuk future-proofing)
  const cutoff90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const cutoffDate = cutoff90 > "2026-05-01T00:00:00+00:00" ? cutoff90 : "2026-05-01T00:00:00+00:00";

  const [invRes, suggRes] = await Promise.all([
    sb.from("invoices")
      .select("id, customer, phone, total, paid_at, created_at")
      .eq("status", "PAID")
      .gt("total", 0)
      .or("payment_proof_url.is.null,payment_proof_url.eq.,payment_proof_url.eq.verified-manual-no-proof")
      .gte("created_at", cutoffDate)
      .order("created_at", { ascending: false })
      .limit(200),
    // Ambil semua payment_suggestions (PENDING dan RESOLVED) dalam 90 hari — jangan filter PENDING saja
    // supaya bukti yang sudah pernah diproses pun bisa dipakai sebagai fallback
    sb.from("payment_suggestions")
      .select("phone, image_url, created_at, amount, status")
      .gte("created_at", cutoffDate)
      .order("created_at", { ascending: true })
      .limit(500),
  ]);

  if (invRes.error) {
    await log("SCAN_BUKTI", "Gagal fetch invoices: " + invRes.error.message, "ERROR");
    return { error: invRes.error.message };
  }
  if (!invRes.data || invRes.data.length === 0) {
    await log("SCAN_BUKTI", "Tidak ada invoice PAID tanpa bukti (≥1 Mei 2026 atau 90 hari terakhir)", "INFO");
    return { checked: 0, updated: 0 };
  }
  if (suggRes.error) {
    await log("SCAN_BUKTI", "Gagal fetch payment_suggestions: " + suggRes.error.message, "ERROR");
    return { error: suggRes.error.message };
  }

  const invs = invRes.data;
  const suggestions = suggRes.data || [];

  // Build phone → suggestions map (sorted oldest→newest, sudah di-sort dari query)
  const phoneMap = {};
  // Suffix-6-digit map: untuk fallback kalau phone customer typo (e.g. 1 digit hilang)
  // Contoh: invoice phone "62856976881" (typo) cocok dengan bukti dari "628567976881"
  // karena last 6 digit sama: "976881"
  const suffixMap = {};
  // All suggestions list (untuk fuzzy amount fallback)
  const allEntries = [];
  for (const s of suggestions) {
    const phone = (s.phone || "").replace(/[^0-9]/g, "");
    if (!phone || phone.length < 8 || !s.image_url) continue;
    const entry = { ...s, phone, ts: new Date(s.created_at).getTime(), amountNum: Number(s.amount) || 0 };
    if (!phoneMap[phone]) phoneMap[phone] = [];
    phoneMap[phone].push(entry);
    if (phone.length >= 9) {
      const suf = phone.slice(-6);
      if (!suffixMap[suf]) suffixMap[suf] = [];
      suffixMap[suf].push(entry);
    }
    allEntries.push(entry);
  }

  let updated = 0;
  let fuzzyMatched = 0;
  const updateLog = [];
  const fuzzyReview = []; // bukti yang match by amount tapi phone beda — perlu owner verify

  const before3d = 3 * 24 * 60 * 60 * 1000;
  const after30d = 30 * 24 * 60 * 60 * 1000;
  const inWindowFn = (entries, invTs) => entries.filter(e => e.ts >= invTs - before3d && e.ts <= invTs + after30d);
  const pickBestFn = (entries, invTs) => {
    const afterInv = entries.filter(e => e.ts >= invTs).sort((a, b) => a.ts - b.ts);
    const beforeInv = entries.filter(e => e.ts < invTs).sort((a, b) => a.ts - b.ts);
    return afterInv.length > 0 ? afterInv[0]
         : beforeInv.length > 0 ? beforeInv[beforeInv.length - 1]
         : null;
  };

  for (const inv of invs) {
    const rawPhone = (inv.phone || "").replace(/[^0-9]/g, "");
    if (!rawPhone || rawPhone.length < 8) continue;
    const invTs = new Date(inv.created_at).getTime();
    const invTotal = Number(inv.total) || 0;

    // ── TIER 1: Exact phone match (existing logic) ──
    let best = null;
    let matchMode = "exact_phone";
    const entries = phoneMap[rawPhone];
    if (entries && entries.length > 0) {
      best = pickBestFn(inWindowFn(entries, invTs), invTs);
    }

    // ── TIER 2: Suffix-6 match (fallback kalau phone typo 1 digit) ──
    // Hanya jika TIER 1 gagal & amount match (toleransi 5% atau Rp 5.000)
    if (!best && rawPhone.length >= 9 && invTotal > 0) {
      const suf = rawPhone.slice(-6);
      const sufCands = suffixMap[suf] || [];
      const inWin = inWindowFn(sufCands, invTs).filter(e => {
        if (!e.amountNum) return false;
        const diff = Math.abs(e.amountNum - invTotal);
        return diff <= Math.max(5000, invTotal * 0.05);
      });
      if (inWin.length > 0) {
        best = pickBestFn(inWin, invTs);
        matchMode = "suffix6_amount";
      }
    }

    // ── TIER 3: Amount-only fuzzy match (toleransi ketat: ≤1% atau Rp 1.000) ──
    // Untuk kasus customer bayar dari rekening keluarga (phone beda total).
    // Tier 3 hanya AUTO-LINK kalau amount exact match (toleransi Rp 1.000) AND ada exactly 1 kandidat.
    // Kalau ambigu (>1 match) → log ke fuzzyReview untuk owner verify, jangan auto-link.
    if (!best && invTotal > 0) {
      const inWin = inWindowFn(allEntries, invTs).filter(e => {
        if (!e.amountNum) return false;
        return Math.abs(e.amountNum - invTotal) <= 1000;
      });
      if (inWin.length === 1) {
        best = inWin[0];
        matchMode = "amount_exact_unique";
      } else if (inWin.length > 1) {
        fuzzyReview.push({
          invoice_id: inv.id,
          customer: inv.customer,
          total: invTotal,
          candidates: inWin.map(e => ({ phone: e.phone, sender: e.sender_name, amount: e.amountNum, ts: e.created_at })),
        });
      }
    }

    if (!best) continue;

    const { error: upErr } = await sb
      .from("invoices")
      .update({ payment_proof_url: best.image_url, updated_at: new Date().toISOString() })
      .eq("id", inv.id);

    if (!upErr) {
      updated++;
      if (matchMode !== "exact_phone") fuzzyMatched++;
      const tag = matchMode === "exact_phone" ? "" : ` [${matchMode}]`;
      updateLog.push(inv.id + " ← " + inv.customer + " (" + (best.amount ? "Rp " + Number(best.amount).toLocaleString("id") : "?") + ")" + tag);
    }
  }

  // Log kandidat ambigu untuk owner review
  if (fuzzyReview.length > 0) {
    await log("SCAN_BUKTI_FUZZY", "Ambiguous matches (amount sama, multi-kandidat — perlu verify owner):\n" +
      fuzzyReview.map(r => `${r.invoice_id} ${r.customer} Rp${r.total.toLocaleString("id")} → ${r.candidates.length} kandidat: ${r.candidates.map(c => c.phone).join(", ")}`).join("\n"),
      "WARNING");
  }

  const summary = `Dicek: ${invs.length} invoice, ${suggestions.length} bukti WA | Diupdate: ${updated} (fuzzy: ${fuzzyMatched}, ambigu: ${fuzzyReview.length})`;
  await log("SCAN_BUKTI", summary + (updateLog.length ? "\n" + updateLog.join("\n") : ""), updated > 0 ? "SUCCESS" : "INFO");

  // Notif owner jika ada yang terupdate
  if (updated > 0) {
    await sendWA(OWNER_PHONE,
      "🧾 *Auto-Scan Bukti Bayar*\n" +
      "Ditemukan " + updated + " bukti transfer dan sudah dilink ke invoice:\n\n" +
      updateLog.slice(0, 10).map(l => "• " + l).join("\n") +
      (updateLog.length > 10 ? "\n...dan " + (updateLog.length - 10) + " lainnya" : "")
    );
  }

  return { checked: invs.length, suggestions: suggestions.length, updated, details: updateLog };
}

// ══════════════════════════════════════════════════
// TASK: Auto-Return Bawa Material Stale
// Jalan tiap hari malam (22:00 WIB / 15:00 UTC)
// Brought yang stuck > 24h → RETURNED (kembali ke stok virtual)
// + Auto-USED kalau orders sudah COMPLETED/PAID tapi brought masih BROUGHT
// ══════════════════════════════════════════════════
async function taskAutoReturnBrought() {
  const cutoff24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const now = new Date().toISOString();

  // Step 1: brought records > 24h yang masih BROUGHT (lupa di-laporan)
  const { data: stale, error: e1 } = await sb.from("job_materials_brought")
    .select("id, job_id, unit_label, brought_by, brought_at")
    .eq("status", "BROUGHT")
    .lt("brought_at", cutoff24h)
    .limit(500);
  if (e1) {
    await log("AUTO_RETURN_BROUGHT", "Fetch error: " + e1.message, "ERROR");
    return { error: e1.message };
  }
  const staleRows = stale || [];

  // Step 2: cross-check orders — kalau order sudah COMPLETED/PAID, lebih relevan tag USED
  // bukan RETURNED. Tapi karena tidak ada qty_used, default ke RETURNED untuk safety.
  let returnedCnt = 0;
  if (staleRows.length > 0) {
    const ids = staleRows.map(r => r.id);
    const { error: e2 } = await sb.from("job_materials_brought")
      .update({ status: "RETURNED", updated_at: now, notes: "auto-returned (>24h tidak ke-laporan)" })
      .in("id", ids);
    if (e2) {
      await log("AUTO_RETURN_BROUGHT", "Update error: " + e2.message, "ERROR");
      return { error: e2.message };
    }
    returnedCnt = ids.length;
  }

  // Step 3: log summary + (kalau ada) alert ke owner
  const summary = `Returned: ${returnedCnt} brought records (>24h stuck)`;
  await log("AUTO_RETURN_BROUGHT", summary, returnedCnt > 0 ? "SUCCESS" : "INFO");

  if (returnedCnt > 0 && OWNER_PHONE) {
    const byTech = {};
    staleRows.forEach(r => {
      if (!byTech[r.brought_by]) byTech[r.brought_by] = [];
      byTech[r.brought_by].push(`${r.unit_label} (${r.job_id})`);
    });
    const lines = Object.entries(byTech).map(([t, list]) =>
      `• ${t}: ${list.slice(0,3).join(", ")}${list.length > 3 ? ` +${list.length-3} lagi` : ""}`).join("\n");
    await sendWA(OWNER_PHONE,
      "📦 *Auto-Return Bawa Material*\n" +
      `${returnedCnt} unit di-return ke stok karena >24h tidak ke-laporan:\n\n${lines}\n\n` +
      "Periksa apakah teknisi lupa input laporan."
    );
  }

  return { returned: returnedCnt, details: staleRows.map(r => r.id) };
}

// ══════════════════════════════════════════════════
// TASK 7: Backup Data Bulanan ke R2
// Jalan tiap tanggal 1 jam 09:00 WIB (02:00 UTC)
// Export invoices, orders, customers, service_reports ke R2
// ══════════════════════════════════════════════════
async function taskBackupData() {
  const r2Key    = process.env.R2_ACCESS_KEY;
  const r2Secret = process.env.R2_SECRET_KEY;
  const r2Account= process.env.R2_ACCOUNT_ID;
  const r2Bucket = process.env.R2_BUCKET_NAME || "aclean-files";

  if (!r2Key || !r2Secret || !r2Account) {
    await log("BACKUP_DATA", "R2 credentials tidak lengkap — skip", "ERROR");
    return { skipped: true };
  }

  function hmac(key, data) { return createHmac("sha256", key).update(data).digest(); }
  function sigV4Put(key, body, contentType) {
    const host = r2Account + ".r2.cloudflarestorage.com";
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const dateStr = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(body).digest("hex");
    const canonicalUri = "/" + r2Bucket + "/" + key;
    const canonicalHeaders = "content-type:" + contentType + "\nhost:" + host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + amzDate + "\n";
    const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = "PUT\n" + canonicalUri + "\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash;
    const credScope = dateStr + "/auto/s3/aws4_request";
    const strToSign = "AWS4-HMAC-SHA256\n" + amzDate + "\n" + credScope + "\n" + createHash("sha256").update(canonicalRequest).digest("hex");
    const signingKey = hmac(hmac(hmac(hmac("AWS4" + r2Secret, dateStr), "auto"), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(strToSign).digest("hex");
    const authorization = "AWS4-HMAC-SHA256 Credential=" + r2Key + "/" + credScope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
    return { url: "https://" + host + canonicalUri, headers: { Authorization: authorization, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, "content-type": contentType, host } };
  }

  const now = new Date(Date.now() + 7 * 3600000); // WIB
  const yearMonth = now.toISOString().slice(0, 7); // "2026-05"
  const tables = ["invoices", "orders", "customers", "service_reports"];
  const results = {};

  for (const table of tables) {
    try {
      const { data, error } = await sb.from(table).select("*").order("created_at", { ascending: false }).limit(5000);
      if (error) { results[table] = "ERROR: " + error.message; continue; }
      const body = JSON.stringify({ exported_at: new Date().toISOString(), table, count: data.length, data });
      const r2Key2 = "backup/" + yearMonth + "/" + table + ".json";
      const { url, headers } = sigV4Put(r2Key2, body, "application/json");
      const putRes = await fetch(url, { method: "PUT", headers, body });
      results[table] = putRes.ok ? data.length + " rows" : "PUT_FAIL:" + putRes.status;
    } catch(e) {
      results[table] = "EXCEPTION: " + e.message;
    }
  }

  // Catat ke backup_log
  const successTables = tables.filter(t => results[t] && !results[t].startsWith("ERROR") && !results[t].startsWith("PUT_FAIL") && !results[t].startsWith("EXCEPTION"));
  try {
    await sb.from("backup_log").insert({
      type: "auto-r2-monthly",
      tables: successTables,           // ARRAY column — jangan join
      row_counts: results,             // jsonb column — pass object langsung
      exported_by: "CRON",
      notes: "Backup bulanan ke R2: backup/" + yearMonth + "/"
    });
  } catch(e) { console.error("[BACKUP_LOG]", e.message); }

  const summary = "Backup " + yearMonth + ": " + Object.entries(results).map(([t, r]) => t + "=" + r).join(", ");
  await log("BACKUP_DATA", summary, successTables.length === tables.length ? "SUCCESS" : "WARNING");
  return { yearMonth, results };
}

// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
// TASK: Morning Dispatch — kirim WA konfirmasi + link portal ke customer hari ini (09:30 WIB)
// Hanya order yang punya teknisi + phone customer + belum dapat WA (portal_wa_sent_at IS NULL)
// ══════════════════════════════════════════════════
async function taskMorningDispatch() {
  const { data: togData } = await sb.from("app_settings").select("key,value")
    .in("key", ["morning_dispatch_enabled", "cron_jobs", "customer_portal_enabled", "customer_portal_url"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));

  if (!isCronJobEnabled(togMap, "morning_dispatch_enabled") || togMap["morning_dispatch_enabled"] !== "true") {
    await log("MORNING_DISPATCH", "Dilewati — morning_dispatch_enabled OFF", "INFO");
    return { skipped: true };
  }
  if (togMap["customer_portal_enabled"] !== "true") {
    await log("MORNING_DISPATCH", "Dilewati — customer_portal_enabled OFF", "INFO");
    return { skipped: true };
  }

  const APP_URL = togMap["customer_portal_url"] || process.env.APP_URL || "https://a-clean-webapp.vercel.app";
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }); // YYYY-MM-DD WIB

  // Ambil order hari ini: ada teknisi, ada phone, belum dapat portal WA
  // maintenance_client_id disertakan untuk kirim link portal B2B yang berbeda
  const { data: orders } = await sb.from("orders")
    .select("id,customer,phone,service,date,time,teknisi,helper,address,maintenance_client_id")
    .eq("date", today)
    .not("teknisi", "is", null)
    .not("phone", "is", null)
    .is("portal_wa_sent_at", null)
    .not("status", "in", "(CANCELLED,REJECTED)")
    .limit(100);

  if (!orders?.length) return { sent: 0, reason: "Tidak ada order hari ini yang perlu dispatch WA" };

  // Cache maintenance clients yang dibutuhkan (batch lookup untuk efisiensi)
  const mcIds = [...new Set(orders.map(o => o.maintenance_client_id).filter(Boolean))];
  const mcMap = {};
  if (mcIds.length > 0) {
    const { data: mcRows } = await sb.from("maintenance_clients")
      .select("id,name,portal_token,token_active")
      .in("id", mcIds);
    (mcRows || []).forEach(mc => { mcMap[mc.id] = mc; });
  }

  let sent = 0, failed = 0;
  for (const order of orders) {
    try {
      // ── Tentukan link portal: B2B (permanen) atau reguler (30 hari) ──
      const mc = order.maintenance_client_id ? mcMap[order.maintenance_client_id] : null;
      const isMaintenance = !!(mc?.portal_token && mc.token_active);

      let link, isMaintenanceLink = false;
      if (isMaintenance) {
        // B2B selalu pakai status.aclean.id — dedicated maintenance domain, tidak bergantung APP_URL setting
        link = `https://status.aclean.id/status/${mc.portal_token}`;
        isMaintenanceLink = true;
      } else {
        // Generate / refresh customer token reguler
        const { data: tokRows } = await sb.from("customer_tokens")
          .select("token,expires_at").eq("phone", order.phone).limit(1);
        let token = tokRows?.[0]?.token;
        const tokExpired = tokRows?.[0]?.expires_at && new Date(tokRows[0].expires_at) < new Date();
        if (!token || tokExpired) {
          const { randomBytes } = await import("crypto");
          token = randomBytes(24).toString("hex");
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          if (tokRows?.length > 0) {
            await sb.from("customer_tokens").update({ token, expires_at: expiresAt, customer_name: order.customer }).eq("phone", order.phone);
          } else {
            await sb.from("customer_tokens").insert({ phone: order.phone, token, expires_at: expiresAt, customer_name: order.customer });
          }
        }
        link = `${APP_URL}/status/${token}`;
      }

      const tgl = new Date(order.date).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
      const team = [order.teknisi, order.helper].filter(Boolean).join(" & ");
      const msg = isMaintenanceLink
        ? `Halo ${order.customer}! 👋\n` +
          `Konfirmasi Jadwal Maintenance Aset AC Anda 😊\n` +
          `Tim AClean sedang menuju lokasi Anda sekarang 🚗\n\n` +
          `📋 Detail Servis:\n` +
          `• Layanan  : ${order.service}\n` +
          `• Jadwal   : ${tgl} · ${order.time || "--:--"}\n` +
          `• Tim      : ${team}\n` +
          `• Lokasi   : ${order.address || "-"}\n\n` +
          `🔗 Portal Maintenance Aset AC Anda:\n${link}\n\n` +
          `Akses laporan, history, dan status aset AC Perusahaan Anda secara lengkap. Jika Ada Pertanyaan? Balas pesan ini.\n— AClean Service`
        : `Halo ${order.customer}! 👋\n` +
          `Ini adalah Pesan Otomatis Konfirmasi Pesanan Anda 😊\n` +
          `Tim AClean sedang menuju lokasi Anda sekarang 🚗\n\n` +
          `📋 Detail Servis:\n` +
          `• Layanan  : ${order.service}\n` +
          `• Jadwal   : ${tgl} · ${order.time || "--:--"}\n` +
          `• Tim      : ${team}\n` +
          `• Lokasi   : ${order.address || "-"}\n\n` +
          `🔗 Pantau status tim secara langsung:\n${link}\n\n` +
          `Link aktif 30 hari sejak Pemesanan Anda. Detail Service, Pembayaran, Complain dan History Pengerjaan Di Lokasi. Jika Ada Pertanyaan? Balas pesan ini.\n— AClean Service`;

      const ok = await sendWA(order.phone, msg);
      if (ok) {
        // Tandai sudah dikirim agar tidak dobel
        await sb.from("orders").update({ portal_wa_sent_at: new Date().toISOString() }).eq("id", order.id);
        sent++;
        const tag = isMaintenanceLink ? "[B2B]" : "[REG]";
        await log("MORNING_DISPATCH_SENT", `WA dispatch ${tag} → ${order.customer} (${order.id})`, "SUCCESS");
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
      await log("MORNING_DISPATCH_ERR", `Gagal dispatch → ${order.id}: ${e.message}`, "ERROR");
    }
  }

  return { sent, failed, total: orders.length };
}

// TASK 9: Rating Prompt H+1 — cek order COMPLETED kemarin, kirim WA minta rating
// ══════════════════════════════════════════════════
async function taskRatingPrompt() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["rating_prompt_enabled","cron_jobs","customer_portal_enabled","voucher_loyalty_enabled","customer_portal_url"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key,s.value]));

  if (!isCronJobEnabled(togMap, "rating_prompt_enabled") || togMap["rating_prompt_enabled"] !== "true") {
    await log("RATING_PROMPT","Dilewati — rating_prompt_enabled OFF","INFO");
    return { skipped: true };
  }
  if (togMap["customer_portal_enabled"] !== "true") {
    await log("RATING_PROMPT","Dilewati — customer_portal_enabled OFF","INFO");
    return { skipped: true };
  }

  const APP_URL = togMap["customer_portal_url"] || process.env.APP_URL || "https://a-clean-webapp.vercel.app";
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);

  // Order COMPLETED/INVOICE_APPROVED kemarin, ada phone, belum dapat rating
  const { data: orders } = await sb.from("orders")
    .select("id,customer,phone,service,teknisi,date")
    .eq("date", yesterday)
    .in("status",["COMPLETED","INVOICE_APPROVED"])
    .not("phone","is",null);

  if (!orders?.length) return { sent: 0, reason: "Tidak ada order selesai kemarin" };

  // Ambil order_id yang sudah punya rating
  const orderIds = orders.map(o => o.id);
  const { data: existing } = await sb.from("customer_feedback").select("order_id").in("order_id", orderIds);
  const ratedSet = new Set((existing||[]).map(r => r.order_id));

  let sent = 0, skipped = 0;
  for (const o of orders) {
    if (ratedSet.has(o.id) || !o.phone) { skipped++; continue; }

    // Get atau buat portal token
    const { data: tokRows } = await sb.from("customer_tokens")
      .select("token,expires_at").eq("phone", o.phone).limit(1);

    let token = tokRows?.[0]?.token;
    const tokExpired = tokRows?.[0]?.expires_at && new Date(tokRows[0].expires_at) < new Date();
    // Buat token baru jika belum ada atau sudah expired
    if (!token || tokExpired) {
      const { randomBytes } = await import("crypto");
      token = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();
      if (tokRows?.length > 0) {
        // Update token yang expired
        await sb.from("customer_tokens").update({ token, expires_at: expiresAt, customer_name: o.customer }).eq("phone", o.phone);
      } else {
        await sb.from("customer_tokens").insert({ phone: o.phone, token, expires_at: expiresAt, customer_name: o.customer });
      }
    }

    const link = `${APP_URL}/status/${token}#rating`;
    const msg =
      `Halo ${o.customer}! 😊\n\n` +
      `Terima kasih telah mempercayakan servis AC ke AClean.\n\n` +
      `Bagaimana pengalaman servis Anda kemarin?\n` +
      `⭐ Beri rating di sini (5 detik):\n${link}\n\n` +
      `Masukan Anda sangat berarti untuk kami 🙏\n— AClean Service`;

    const ok = await sendWA(o.phone, msg);
    if (ok) { sent++; await log("RATING_PROMPT_SENT", `Rating WA → ${o.customer} (${o.phone}) job ${o.id}`, "SUCCESS"); }
    else skipped++;

    // Phase 3B — cek milestone voucher jika fitur aktif
    if (togMap["voucher_loyalty_enabled"] === "true") {
      try {
        const { count } = await sb.from("orders")
          .select("id", { count: "exact", head: true })
          .eq("phone", o.phone)
          .in("status",["COMPLETED","INVOICE_APPROVED"]);

        const MILESTONES = [
          { at: 2,  type: "discount_pct", value: 5,  desc: "Diskon 5% untuk servis berikutnya — terima kasih sudah kembali!" },
          { at: 5,  type: "discount_pct", value: 10, desc: "Diskon 10% untuk servis berikutnya — pelanggan setia ke-5 kali!" },
          { at: 10, type: "free_unit",    value: 1,  desc: "1 unit cuci AC GRATIS — terima kasih sudah setia 10 kali servis!" },
          { at: 15, type: "discount_pct", value: 15, desc: "Diskon 15% untuk servis berikutnya — VIP Member 15x servis!" },
        ];

        const milestone = MILESTONES.find(m => m.at === count);
        if (milestone) {
          const { randomBytes } = await import("crypto");
          const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          const code = "ACL-" + Array.from(randomBytes(6)).map(b => chars[b % chars.length]).join("");
          const expiresAt = new Date(Date.now() + 90*24*60*60*1000).toISOString().slice(0,10);
          const { error: insErr } = await sb.from("customer_vouchers").insert({
            phone: o.phone, customer_name: o.customer,
            code, type: milestone.type, value: milestone.value,
            description: milestone.desc, expires_at: expiresAt,
            trigger: "milestone", milestone_at: milestone.at, is_valid: true,
          });
          if (!insErr) {
            const voucherMsg =
              `🎁 *Voucher Spesial untuk ${o.customer}!*\n\n` +
              `${milestone.desc}\n\n` +
              `Kode voucher Anda: *${code}*\n` +
              `Berlaku hingga: ${expiresAt}\n\n` +
              `Lihat voucher di portal: ${APP_URL}/status/${token}\n\n` +
              `Sebutkan kode ini saat booking berikutnya 😊\n— AClean Service`;
            await sendWA(o.phone, voucherMsg);
            await log("VOUCHER_CREATED", `Voucher ${code} → ${o.customer} (milestone ${milestone.at}x)`, "SUCCESS");
          }
        }
      } catch(e) { /* voucher opsional — tidak blok */ }
    }
  }

  return { sent, skipped };
}

// ══════════════════════════════════════════════════
// TASK 10: Servis Reminder — customer >90 hari tidak servis
// ══════════════════════════════════════════════════
async function taskServisReminder() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["servis_reminder_enabled","cron_jobs","customer_portal_enabled","voucher_winback_enabled","customer_portal_url"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key,s.value]));

  if (!isCronJobEnabled(togMap, "servis_reminder_enabled") || togMap["servis_reminder_enabled"] !== "true") {
    await log("SERVIS_REMINDER","Dilewati — servis_reminder_enabled OFF","INFO");
    return { skipped: true };
  }
  if (togMap["customer_portal_enabled"] !== "true") {
    await log("SERVIS_REMINDER","Dilewati — customer_portal_enabled OFF","INFO");
    return { skipped: true };
  }

  const APP_URL = togMap["customer_portal_url"] || process.env.APP_URL || "https://a-clean-webapp.vercel.app";
  const today = new Date();
  const cutoff = new Date(today.getTime() - 90*24*60*60*1000).toISOString().slice(0,10);

  // Customer dengan last_service < 90 hari lalu, ada phone, aktif
  const { data: customers } = await sb.from("customers")
    .select("id,name,phone,last_service,last_rating_request,last_winback_sent")
    .not("phone","is",null)
    .lt("last_service", cutoff)
    .not("last_service","is",null)
    .limit(50); // max 50 per run agar tidak spam

  if (!customers?.length) return { sent: 0, reason: "Tidak ada customer yang perlu diingatkan" };

  const todayStr = today.toISOString().slice(0,10);
  let sent = 0, skipped = 0;

  for (const c of customers) {
    // Jangan kirimi yang sudah dapat reminder dalam 30 hari terakhir
    if (c.last_rating_request) {
      const daysSinceReminder = Math.floor((Date.now() - new Date(c.last_rating_request).getTime()) / 86400000);
      if (daysSinceReminder < 30) { skipped++; continue; }
    }

    const daysSince = Math.floor((Date.now() - new Date(c.last_service).getTime()) / 86400000);

    // Get portal token
    const { data: tokRows } = await sb.from("customer_tokens")
      .select("token,expires_at").eq("phone", c.phone).limit(1);
    let token = tokRows?.[0]?.token;
    const tokExpired = tokRows?.[0]?.expires_at && new Date(tokRows[0].expires_at) < new Date();
    if (!token || tokExpired) {
      const { randomBytes } = await import("crypto");
      token = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();
      if (tokRows?.length > 0) {
        await sb.from("customer_tokens").update({ token, expires_at: expiresAt, customer_name: c.name }).eq("phone", c.phone);
      } else {
        await sb.from("customer_tokens").insert({ phone: c.phone, token, expires_at: expiresAt, customer_name: c.name });
      }
    }

    const lastServiceFmt = new Date(c.last_service).toLocaleDateString("id-ID",{day:"numeric",month:"long",year:"numeric"});
    const link = `${APP_URL}/status/${token}`;
    const msg =
      `Halo ${c.name}! 👋\n\n` +
      `AC Anda terakhir dirawat ${daysSince} hari lalu (${lastServiceFmt}).\n\n` +
      `Untuk menjaga performa AC tetap optimal, disarankan cuci AC setiap 3 bulan. ❄️\n\n` +
      `Mau jadwalkan servis berikutnya? Balas pesan ini atau:\n${link}\n\n` +
      `— AClean Service`;

    const ok = await sendWA(c.phone, msg);
    if (ok) {
      sent++;
      // Update last_rating_request agar tidak spam
      await sb.from("customers").update({ last_rating_request: todayStr }).eq("id", c.id);
      await log("SERVIS_REMINDER_SENT", `Reminder → ${c.name} (${daysSince} hari sejak servis terakhir)`, "SUCCESS");

      // Win-back voucher jika customer inactive >180 hari dan fitur aktif
      if (togMap["voucher_winback_enabled"] === "true" && daysSince >= 180) {
        try {
          // Cooldown 30 hari per customer untuk winback
          const lastWinback = c.last_winback_sent;
          if (!lastWinback || Math.floor((Date.now()-new Date(lastWinback).getTime())/86400000) >= 30) {
            const { randomBytes } = await import("crypto");
            const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            const wbCode = "ACL-" + Array.from(randomBytes(6)).map(b => chars[b % chars.length]).join("");
            const expiresAt = new Date(Date.now() + 60*24*60*60*1000).toISOString().slice(0,10);
            const { error: wbErr } = await sb.from("customer_vouchers").insert({
              phone: c.phone, customer_name: c.name,
              code: wbCode, type: "discount_pct", value: 10,
              description: "Diskon 10% spesial — kami kangen Anda! Gunakan saat servis berikutnya.",
              expires_at: expiresAt, trigger: "winback", is_valid: true,
            });
            if (!wbErr) {
              const wbMsg =
                `Halo ${c.name}! 💙\n\n` +
                `Sudah lama tidak berjumpa — kami kangen pelanggan setia kami!\n\n` +
                `Sebagai tanda rindu, kami siapkan voucher spesial untuk Anda:\n\n` +
                `🎁 *Diskon 10%* untuk servis berikutnya\n` +
                `Kode: *${wbCode}*\n` +
                `Berlaku hingga: ${expiresAt}\n\n` +
                `Sebutkan kode ini saat booking. Kami siap melayani! ❄️\n— AClean Service`;
              await sendWA(c.phone, wbMsg);
              await sb.from("customers").update({ last_winback_sent: todayStr }).eq("id", c.id);
              await log("WINBACK_VOUCHER", `Win-back ${wbCode} → ${c.name} (${daysSince} hari inactive)`, "SUCCESS");
            }
          }
        } catch(e) { /* winback opsional — tidak blok */ }
      }
    } else skipped++;
  }

  return { sent, skipped };
}

// ══════════════════════════════════════════════════
// TASK 11: Voucher Expiry Reminder — H-3 sebelum expired
// ══════════════════════════════════════════════════
async function taskVoucherExpiryReminder() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["voucher_expiry_reminder_enabled","cron_jobs","customer_portal_enabled","customer_portal_url"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key,s.value]));

  if (!isCronJobEnabled(togMap, "voucher_expiry_reminder_enabled") || togMap["voucher_expiry_reminder_enabled"] !== "true") {
    await log("VOUCHER_EXPIRY","Dilewati — voucher_expiry_reminder_enabled OFF","INFO");
    return { skipped: true };
  }

  const APP_URL = togMap["customer_portal_url"] || process.env.APP_URL || "https://a-clean-webapp.vercel.app";
  const today = new Date();
  const in3days = new Date(today.getTime() + 3*24*60*60*1000).toISOString().slice(0,10);
  const todayStr = today.toISOString().slice(0,10);

  // Cari voucher: expires dalam 3 hari, belum diklaim, valid, reminder belum dikirim
  const { data: vouchers } = await sb.from("customer_vouchers")
    .select("id,phone,customer_name,code,type,value,expires_at")
    .is("claimed_at", null)
    .eq("is_valid", true)
    .eq("reminder_sent", false)
    .gte("expires_at", todayStr)
    .lte("expires_at", in3days)
    .limit(100);

  if (!vouchers?.length) return { sent: 0, reason: "Tidak ada voucher yang akan expired dalam 3 hari" };

  let sent = 0;
  for (const v of vouchers) {
    if (!v.phone) continue;

    const typeLabel = v.type === "discount_pct" ? `Diskon ${v.value}%`
      : v.type === "free_unit" ? `${v.value} Unit Cuci Gratis`
      : "Voucher Servis";

    // Get portal token untuk link
    const { data: tokRows } = await sb.from("customer_tokens")
      .select("token").eq("phone", v.phone).limit(1);
    const token = tokRows?.[0]?.token;
    const portalLine = token
      ? `\n\nLihat voucher di portal Anda:\n${APP_URL}/status/${token}`
      : "";

    const msg =
      `Halo ${v.customer_name || "Pelanggan"}! ⏰\n\n` +
      `Voucher Anda *${typeLabel}* (kode: *${v.code}*) akan habis masa berlakunya pada *${v.expires_at}*.\n\n` +
      `Segera gunakan sebelum expired! Sebutkan kode ini saat booking.${portalLine}\n\n` +
      `— AClean Service`;

    const ok = await sendWA(v.phone, msg);
    if (ok) {
      sent++;
      await sb.from("customer_vouchers").update({ reminder_sent: true }).eq("id", v.id);
      await log("VOUCHER_EXPIRY_SENT", `Reminder → ${v.customer_name} kode ${v.code} exp ${v.expires_at}`, "SUCCESS");
    }
  }

  return { sent, total: vouchers.length };
}

// ══════════════════════════════════════════════════
// TASK 12: Laporan Stale Alert — Notif owner jika laporan >3 hari belum diverifikasi
// ══════════════════════════════════════════════════
async function taskLaporanStaleAlert() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key", ["laporan_stale_alert_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData||[]).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "laporan_stale_alert_enabled")) {
    await log("LAPORAN_STALE", "Dilewati — laporan_stale_alert_enabled OFF", "INFO");
    return { skipped: true };
  }

  // Cari laporan yang submitted > 3 hari lalu dan belum diverifikasi
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: stale } = await sb
    .from("service_reports")
    .select("id,job_id,teknisi,customer,date,submitted_at,status")
    .in("status", ["SUBMITTED", "REVISION"])
    .lte("submitted_at", threeDaysAgo)
    .order("submitted_at", { ascending: true })
    .limit(50);

  if (!stale?.length) {
    await log("LAPORAN_STALE", "Tidak ada laporan tertunda >3 hari", "INFO");
    return { checked: true, staleCount: 0 };
  }

  const tgl = new Date(Date.now() + 7 * 60 * 60 * 1000).toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  let msg = `⚠️ *LAPORAN BELUM DIVERIFIKASI*\n${tgl}\n\n`;
  msg += `${stale.length} laporan sudah lebih dari 3 hari belum diverifikasi:\n\n`;

  stale.forEach((r, i) => {
    const submittedDate = r.submitted_at
      ? new Date(r.submitted_at).toLocaleDateString("id-ID")
      : (r.date || "?");
    const hariLewat = r.submitted_at
      ? Math.floor((Date.now() - new Date(r.submitted_at).getTime()) / (1000 * 60 * 60 * 24))
      : "?";
    msg += `${i + 1}. *${r.teknisi || "?"}* — ${r.customer || "?"}\n`;
    msg += `   Job: ${r.job_id} · Submit: ${submittedDate} (${hariLewat} hari)\n`;
    if (r.status === "REVISION") msg += `   Status: 🔄 Perlu Revisi dari teknisi\n`;
    msg += `\n`;
  });

  msg += `_Segera verifikasi di menu Laporan Tim. — ARA AClean_`;

  const waSent = await sendWA(OWNER_PHONE, msg);
  await log("LAPORAN_STALE", `Alert: ${stale.length} laporan tertunda >3 hari`, waSent ? "SUCCESS" : "WARNING");
  return { staleCount: stale.length, waSent };
}

// TASK 8: Weekly Report — Minggu 09:00 WIB (02:00 UTC)
// Ringkasan 7 hari terakhir: order, revenue, laporan, top teknisi
// ══════════════════════════════════════════════════
async function taskWeeklyReport() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["weekly_report_enabled","cron_jobs"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key, s.value]));
  if (!isCronJobEnabled(togMap, "weekly_report_enabled")) {
    await log("WEEKLY_REPORT", "Dilewati — Laporan Mingguan dinonaktifkan via Settings", "INFO");
    return { skipped: true };
  }

  const nowWib = new Date(Date.now() + 7*60*60*1000);
  const todayStr = nowWib.toISOString().slice(0,10);
  const weekAgo = new Date(nowWib.getTime() - 7*24*60*60*1000).toISOString().slice(0,10);

  const [{ data: orders }, { data: invoices }, { data: expenses }] = await Promise.all([
    sb.from("orders").select("id,service,status,teknisi,date").gte("date", weekAgo).lte("date", todayStr),
    sb.from("invoices").select("id,total,status,teknisi").gte("created_at", weekAgo+"T00:00:00").lte("created_at", todayStr+"T23:59:59"),
    sb.from("expenses").select("amount,category").gte("date", weekAgo).lte("date", todayStr),
  ]);

  const ordArr = orders||[];
  const invArr = invoices||[];
  const expArr = expenses||[];

  const totalOrders = ordArr.length;
  const completed   = ordArr.filter(o=>o.status==="COMPLETED").length;

  // Service breakdown
  const svcCount = {};
  ordArr.forEach(o => { const s = o.service||"Lainnya"; svcCount[s]=(svcCount[s]||0)+1; });
  const svcOrder = ["Cleaning","Install","Repair","Complain"];
  const svcLines = svcOrder.filter(s=>svcCount[s]).map(s=>`  • ${s}: ${svcCount[s]}`);
  Object.keys(svcCount).filter(s=>!svcOrder.includes(s)).forEach(s=>svcLines.push(`  • ${s}: ${svcCount[s]}`));

  // Revenue
  const paid    = invArr.filter(i=>i.status==="PAID");
  const unpaid  = invArr.filter(i=>["UNPAID","OVERDUE"].includes(i.status));
  const revenue = paid.reduce((s,i)=>s+(i.total||0),0);
  const pending = unpaid.reduce((s,i)=>s+(i.total||0),0);

  // Expenses
  const totalExp = expArr.reduce((s,e)=>s+(Number(e.amount)||0),0);
  const nett = revenue - totalExp;

  // Top teknisi by order count
  const tekCount = {};
  ordArr.filter(o=>o.teknisi).forEach(o => { tekCount[o.teknisi]=(tekCount[o.teknisi]||0)+1; });
  const topTek = Object.entries(tekCount).sort((a,b)=>b[1]-a[1]).slice(0,3);

  const tglRange = `${new Date(weekAgo+"T00:00:00+07:00").toLocaleDateString("id-ID",{day:"numeric",month:"short"})} – ${nowWib.toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"})}`;

  let msg = `📅 *LAPORAN MINGGUAN ACLEAN*\n${tglRange}\n\n`;
  msg += `🔧 *ORDER: ${totalOrders}* (selesai: ${completed})\n`;
  msg += svcLines.join("\n") + "\n\n";
  msg += `💳 *INVOICE: ${invArr.length}*\n`;
  msg += `  • Lunas: ${paid.length} (${fmt(revenue)})\n`;
  msg += `  • Belum bayar: ${unpaid.length} (${fmt(pending)})\n\n`;
  if (totalExp > 0) {
    msg += `💸 *PENGELUARAN: ${fmt(totalExp)}*\n`;
    msg += `📈 Nett Minggu Ini: *${fmt(nett)}*\n\n`;
  } else {
    msg += `📈 Pemasukan Minggu Ini: *${fmt(revenue)}*\n\n`;
  }
  if (topTek.length > 0) {
    msg += `🏆 *TOP TEKNISI:*\n`;
    topTek.forEach(([name, count], i) => { msg += `  ${i+1}. ${name}: ${count} order\n`; });
    msg += "\n";
  }
  msg += `_ARA AClean_`;

  const waSent = await sendWA(OWNER_PHONE, msg);
  await log("WEEKLY_REPORT", `${totalOrders} order | rev ${fmt(revenue)} | exp ${fmt(totalExp)}`, "SUCCESS");
  return { orders: totalOrders, revenue, expenses: totalExp, nett, waSent };
}

// ══════════════════════════════════════════════════
// PAYROLL WA — Sabtu 18:00 WIB (11:00 UTC)
// Kirim slip gaji ke semua aktif Teknisi & Helper
// ══════════════════════════════════════════════════
async function taskPayrollWA() {
  const { data: togRows } = await sb.from("app_settings").select("key,value")
    .in("key", ["payroll_wa_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togRows || []).map(r => [r.key, r.value]));
  if (!isCronJobEnabled(togMap, "payroll_wa_enabled") || togMap["payroll_wa_enabled"] !== "true") {
    return { skipped: true, reason: "payroll_wa_enabled=false" };
  }

  // Hitung periode minggu ini (Senin–Sabtu)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now); monday.setDate(now.getDate() + diffToMon);
  const saturday = new Date(monday); saturday.setDate(monday.getDate() + 5);
  const periodStart = monday.toISOString().slice(0, 10);
  const periodEnd   = saturday.toISOString().slice(0, 10);

  // Ambil semua payroll minggu ini yang belum dikirim WA
  const { data: rows } = await sb.from("weekly_payroll")
    .select("*, user_profiles!weekly_payroll_user_id_fkey(phone)")
    .eq("period_start", periodStart)
    .is("wa_sent_at", null);

  if (!rows || rows.length === 0) return { skipped: true, reason: "no_payroll_rows" };

  const fmt = n => Number(n || 0).toLocaleString("id-ID");
  const fmtD = d => d ? new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "-";

  let sent = 0, failed = 0;
  for (const row of rows) {
    const phone = row.user_profiles?.phone;
    if (!phone) { failed++; continue; }

    const fullBonus = row.role === "Helper" ? 75000 : 100000;
    const lateStr   = row.late_days > 0 ? `\nTelat Masuk : ${row.late_days} hr × -Rp 10.000 = -Rp ${fmt(row.late_days * 10000)}` : "";
    const kasbonStr = row.kasbon_total > 0 ? `\nKasbon : -Rp ${fmt(row.kasbon_total)}` : "";
    const fullStr   = row.full_week_bonus ? `\nBonus Full Week : +Rp ${fmt(fullBonus)}` : "";
    const manStr    = row.manual_bonus > 0 ? `\nBonus Manual : +Rp ${fmt(row.manual_bonus)}${row.manual_bonus_note ? " (" + row.manual_bonus_note + ")" : ""}` : "";

    // Ambil bonus PAID periode ini untuk orang ini
    const { data: bonuses } = await sb.from("order_bonuses")
      .select("bonus_type,total_amount,amount_per_person,order_id")
      .eq("status", "PAID")
      .gte("order_date", periodStart)
      .lte("order_date", periodEnd)
      .contains("team_members", [row.user_name]);

    const totalKomisi = (bonuses || []).reduce((s, b) => s + Number(b.amount_per_person || 0), 0);
    const bonusLines  = (bonuses || []).length > 0
      ? (bonuses || []).map(b => `[${b.order_id || "-"}] : +Rp ${fmt(b.amount_per_person)}`).join("\n")
      : "Belum ada komisi dibayar minggu ini";

    const msg = `📋 *SLIP GAJI MINGGUAN*\n━━━━━━━━━━━━━━━━━━━━━\n👷 *${row.user_name}* | ${row.role}\nPeriode: ${fmtD(row.period_start)} – ${fmtD(row.period_end)}\n━━━━━━━━━━━━━━━━━━━━━\n*GAJI POKOK*\nHari Masuk : ${row.days_worked} hari × Rp ${fmt(row.daily_rate)}\n             = Rp ${fmt(row.days_worked * row.daily_rate)}${fullStr}${lateStr}${kasbonStr}${manStr}\n━━━━━━━━━━━━━━━━━━━━━\n*KOMISI (Dibayar Minggu Ini)*\n${bonusLines}\nTotal Komisi: Rp ${fmt(totalKomisi)}\n━━━━━━━━━━━━━━━━━━━━━\n*TOTAL GAJI : Rp ${fmt(row.gross_salary)}*\nStatus : ${row.is_paid ? "✅ SUDAH DIBAYAR" : "⏳ BELUM DIBAYAR"}\n━━━━━━━━━━━━━━━━━━━━━`;

    const ok = await sendWA(phone, msg);
    if (ok) {
      await sb.from("weekly_payroll").update({ wa_sent_at: new Date().toISOString() }).eq("id", row.id);
      sent++;
    } else { failed++; }
  }

  // Auto-update PENDING → ELIGIBLE bonuses yang sudah >30 hari
  await sb.rpc("fn_auto_eligible_bonuses").catch(e => {
    try { Sentry.captureException(e, { tags: { op: "fn_auto_eligible_bonuses" } }); } catch (_) {}
    console.error("[PAYROLL_WA] fn_auto_eligible_bonuses fail:", e.message);
  });

  await log("PAYROLL_WA", `Sent=${sent} Failed=${failed} period=${periodStart}`, sent > 0 ? "SUCCESS" : "WARN");
  return { sent, failed, period: periodStart };
}

// ══════════════════════════════════════════════════
// TASK 14: Log Cleanup — retention agent_logs, cron_runs, ai_usage (90 hari)
// Dipanggil weekly via vercel.json cron (lihat juga task=cleanup untuk audit_log + R2)
// ══════════════════════════════════════════════════
async function taskLogCleanup() {
  try {
    const { data, error } = await sb.rpc("cleanup_observability_logs", { retention_days: 90 });
    if (error) {
      await logStructured(sb, {
        action: "LOG_CLEANUP",
        severity: "error",
        category: "cron",
        detail: "RPC cleanup_observability_logs failed: " + error.message,
      });
      return { error: error.message };
    }
    const summary = (data || []).map(r => `${r.table_name}=${r.deleted_count}`).join(", ");
    await logStructured(sb, {
      action: "LOG_CLEANUP",
      severity: "info",
      category: "cron",
      detail: summary || "Tidak ada log yang perlu dihapus",
      metadata: { deleted: data },
    });
    return { deleted: data, summary };
  } catch (err) {
    await logStructured(sb, {
      action: "LOG_CLEANUP",
      severity: "error",
      category: "cron",
      detail: err.message,
    });
    return { error: err.message };
  }
}

// ══════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════
export default async function handler(req, res) {
  const { setCorsHeaders } = await import("./_auth.js");
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();

  // Auth: terima CRON_SECRET (Bearer) atau INTERNAL_API_SECRET (X-Internal-Token)
  const auth   = req.headers.authorization || "";
  const cronSecret     = process.env.CRON_SECRET;
  const internalSecret = process.env.INTERNAL_API_SECRET;

  let authorized = false;
  // Check CRON_SECRET (Vercel cron / curl)
  if (cronSecret) {
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token.length > 0) {
      const tBuf = Buffer.from(token, "utf-8");
      const sBuf = Buffer.from(cronSecret, "utf-8");
      if (tBuf.length === sBuf.length) authorized = timingSafeEqual(tBuf, sBuf);
    }
  }
  // Check INTERNAL_API_SECRET (manual trigger dari dashboard)
  if (!authorized && internalSecret) {
    const iToken = req.headers["x-internal-token"] || req.headers["x-api-key"] || "";
    if (iToken.length > 0) {
      // Accept App Token (HMAC-signed JWT dari _auth.js signAppToken)
      if (iToken.split(".").length === 3) {
        const claims = verifyAppToken(iToken);
        if (claims) authorized = true;
      } else {
        const tBuf = Buffer.from(iToken, "utf-8");
        const sBuf = Buffer.from(internalSecret, "utf-8");
        if (tBuf.length === sBuf.length) authorized = timingSafeEqual(tBuf, sBuf);
      }
    }
  }

  if (!cronSecret && !internalSecret) return res.status(500).json({error:"Auth not configured"});
  if (!authorized) return res.status(401).json({error:"Unauthorized"});

  const task = req.query.task || "reminder";

  try {
    // Set Sentry context for cron job
    setCronContext(task);

    // Map task name → handler. Pakai runWithCronLogging untuk auto-track cron_runs.
    const taskMap = {
      "daily":            taskDaily,
      "stock":            taskStock,
      "cleanup":          taskCleanup,
      "wa-cleanup":       taskWaCleanup,
      "bukti-bayar":      taskScanBuktiBayar,
      "backup":           taskBackupData,
      "weekly":           taskWeeklyReport,
      "morning-dispatch": taskMorningDispatch,
      "rating-prompt":    taskRatingPrompt,
      "servis-reminder":  taskServisReminder,
      "voucher-expiry":   taskVoucherExpiryReminder,
      "laporan-stale":    taskLaporanStaleAlert,
      "payroll-wa":       taskPayrollWA,
      "log-cleanup":      taskLogCleanup,
      "auto-return-brought": taskAutoReturnBrought,
      "r2-cleanup-90d":   taskR2Cleanup90d,
      "expense-foto-cleanup": taskExpenseFotoCleanup30d,
      "wa-snapshot":      taskWaSnapshot,
      "wa-backfill":      () => taskWaBackfill({ from: req.query.from, to: req.query.to }),
      "snapshot-cleanup": taskSnapshotCleanup,
      "reminder":         taskReminder,
    };
    const handler = taskMap[task] || taskReminder;
    const taskKey = taskMap[task] ? task : "reminder";

    const result = await runWithCronLogging(sb, taskKey, () => handler());

    return res.json({ ok:true, task, timestamp:new Date().toISOString(), ...result });
  } catch(err) {
    await log("CRON_ERROR", `task=${task}: ${err.message}`, "ERROR");

    // Capture cron error to Sentry
    Sentry.captureException(err, {
      tags: {
        type: "cron",
        task: task,
        timestamp: new Date().toISOString(),
      },
    });

    // Return 200 (not 500) so Vercel doesn't retry the cron job
    return res.status(200).json({ ok:false, error:err.message, task });
  }
}
