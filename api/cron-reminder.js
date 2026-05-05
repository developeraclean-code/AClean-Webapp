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
    let msg = null;
    if (daysOverdue>=1  && daysOverdue<=7)  { msg=`Halo ${inv.customer} 🙏\n\nPengingat invoice *${inv.id}* — ${fmt(inv.total)}, jatuh tempo ${inv.due}.\n\nTransfer ke: *${BANK_NAME} ${BANK_NUMBER}* a.n. ${BANK_HOLDER}\nTerima kasih! — AClean`; res.reminder1++; }
    else if (daysOverdue>=8  && daysOverdue<=14) { msg=`Halo ${inv.customer},\n\nInvoice *${inv.id}* belum dibayar (${daysOverdue} hari). Total: ${fmt(inv.total)}.\n\nTransfer ke *${BANK_NAME} ${BANK_NUMBER}* a.n. ${BANK_HOLDER}.\n\n— AClean`; res.reminder2++; }
    else if (daysOverdue>=15 && daysOverdue<=21) { msg=`Halo ${inv.customer},\n\nInvoice *${inv.id}* sudah ${daysOverdue} hari lewat jatuh tempo (${fmt(inv.total)}).\n\nAda kendala? Balas pesan ini. — AClean`; res.reminder3++; await sendWA(OWNER_PHONE,`⚠️ OVERDUE ${inv.id} — ${inv.customer} — ${daysOverdue}h — ${fmt(inv.total)}`); }
    else if (daysOverdue>=22) { res.escalated++; await sendWA(OWNER_PHONE,`🚨 ESKALASI ${inv.id} — ${inv.customer} — ${daysOverdue}h — ${fmt(inv.total)}`); continue; }
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

  // 1. Cleanup agent_logs > 90 hari
  const cutoff90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const { error: logDelErr, count: logCount } = await sb.from("agent_logs")
    .delete({ count: "exact" }).lt("created_at", cutoff90);
  if (logDelErr) console.error("[CLEANUP_AGENT_LOGS]", logDelErr.message);
  else result.agent_logs = logCount || 0;

  // 2. Cleanup audit_log > 30 hari (tumbuh paling cepat ~15MB/bulan)
  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
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
// TASK 6: Scan Bukti Bayar — cocokkan R2 ke invoice PAID tanpa bukti
// Jalan setiap hari jam 09:00 WIB (02:00 UTC)
// Hanya proses invoice PAID setelah 2026-05-01 (fokus aktif)
// ══════════════════════════════════════════════════
async function taskScanBuktiBayar() {
  const r2Key    = process.env.R2_ACCESS_KEY;
  const r2Secret = process.env.R2_SECRET_KEY;
  const r2Account= process.env.R2_ACCOUNT_ID;
  const r2Bucket = process.env.R2_BUCKET_NAME || "aclean-files";

  if (!r2Key || !r2Secret || !r2Account) {
    await log("SCAN_BUKTI", "R2 credentials tidak lengkap — skip", "ERROR");
    return { skipped: true, reason: "R2 credentials missing" };
  }

  // SigV4 helper
  const { createHmac, createHash } = await import("crypto");
  const hmacFn = (key, data) => createHmac("sha256", key).update(data).digest();
  const hashHex = (data) => createHash("sha256").update(data).digest("hex");

  async function listR2Prefix(prefix) {
    const host = r2Account + ".r2.cloudflarestorage.com";
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0,15) + "Z";
    const dateStr = amzDate.slice(0,8);
    const payloadHash = hashHex("");
    const qs = "list-type=2&max-keys=1000&prefix=" + encodeURIComponent(prefix).replace(/%2F/g, "/");
    const canonHeaders = "host:" + host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + amzDate + "\n";
    const signedH = "host;x-amz-content-sha256;x-amz-date";
    const canonReq = "GET\n/" + r2Bucket + "\n" + qs + "\n" + canonHeaders + "\n" + signedH + "\n" + payloadHash;
    const credScope = dateStr + "/auto/s3/aws4_request";
    const strToSign = "AWS4-HMAC-SHA256\n" + amzDate + "\n" + credScope + "\n" + hashHex(canonReq);
    const sigKey = hmacFn(hmacFn(hmacFn(hmacFn("AWS4" + r2Secret, dateStr), "auto"), "s3"), "aws4_request");
    const sig = createHmac("sha256", sigKey).update(strToSign).digest("hex");
    const auth = "AWS4-HMAC-SHA256 Credential=" + r2Key + "/" + credScope + ", SignedHeaders=" + signedH + ", Signature=" + sig;
    const url = "https://" + host + "/" + r2Bucket + "?" + qs;
    const xml = await fetch(url, { headers: { Authorization: auth, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, host } }).then(r => r.text());
    const keys  = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
    const dates = [...xml.matchAll(/<LastModified>([^<]+)<\/LastModified>/g)].map(m => m[1]);
    return keys.map((k, i) => {
      const fname = k.split("/").pop();
      const m = fname.match(/^(\d+)_(\d+)\./);
      if (!m) return null;
      return { key: k, ts: parseInt(m[1]), phone: m[2], date: new Date(dates[i]) };
    }).filter(Boolean);
  }

  // Ambil invoice PAID tanpa bukti, fokus setelah 2026-05-01
  const { data: invs, error: invErr } = await sb
    .from("invoices")
    .select("id, customer, phone, total, paid_at, created_at")
    .eq("status", "PAID")
    .gt("total", 0)
    .or("payment_proof_url.is.null,payment_proof_url.eq.,payment_proof_url.eq.verified-manual-no-proof")
    .gte("created_at", "2026-05-01T00:00:00+00:00")
    .order("created_at", { ascending: false })
    .limit(200);

  if (invErr) {
    await log("SCAN_BUKTI", "Gagal fetch invoices: " + invErr.message, "ERROR");
    return { error: invErr.message };
  }
  if (!invs || invs.length === 0) {
    await log("SCAN_BUKTI", "Tidak ada invoice PAID tanpa bukti (≥1 Mei 2026)", "INFO");
    return { checked: 0, updated: 0 };
  }

  // List semua file R2 bukti_transfer
  const r2Files = await listR2Prefix("wa-images/bukti_transfer/");

  // Build phone → files map (sorted oldest→newest)
  const phoneMap = {};
  for (const f of r2Files) {
    if (!phoneMap[f.phone]) phoneMap[f.phone] = [];
    phoneMap[f.phone].push(f);
  }
  for (const p of Object.keys(phoneMap)) phoneMap[p].sort((a,b) => a.ts - b.ts);

  let updated = 0;
  const updateLog = [];

  for (const inv of invs) {
    // Strip semua karakter non-digit: unicode tersembunyi, tanda hubung, spasi, dll
    const rawPhone = (inv.phone || "").replace(/[^0-9]/g, "").trim();
    if (!rawPhone || rawPhone.length < 8) continue;

    const files = phoneMap[rawPhone];
    if (!files || files.length === 0) continue;

    // Cari file terdekat setelah invoice created_at dalam 14 hari
    const invTs = new Date(inv.created_at).getTime();
    const window14 = 14 * 24 * 60 * 60 * 1000;
    const afterInv = files.filter(f => f.ts >= invTs && f.ts <= invTs + window14);
    const best = afterInv.length > 0 ? afterInv[0] : files[files.length - 1];

    const proofUrl = "/api/foto?key=" + encodeURIComponent(best.key);
    const { error: upErr } = await sb
      .from("invoices")
      .update({ payment_proof_url: proofUrl, updated_at: new Date().toISOString() })
      .eq("id", inv.id);

    if (!upErr) {
      updated++;
      updateLog.push(inv.id + " ← " + best.key.split("/").pop());
    }
  }

  const summary = `Dicek: ${invs.length} invoice | Diupdate: ${updated} bukti bayar dari R2`;
  await log("SCAN_BUKTI", summary + (updateLog.length ? "\n" + updateLog.join("\n") : ""), updated > 0 ? "SUCCESS" : "INFO");

  // Notif owner jika ada yang terupdate
  if (updated > 0) {
    await sendWA(OWNER_PHONE,
      "🧾 *Auto-Scan Bukti Bayar*\n" +
      "Ditemukan " + updated + " bukti transfer baru di R2 dan sudah dilink ke invoice:\n\n" +
      updateLog.slice(0, 10).map(l => "• " + l).join("\n") +
      (updateLog.length > 10 ? "\n...dan " + (updateLog.length - 10) + " lainnya" : "")
    );
  }

  return { checked: invs.length, r2Files: r2Files.length, updated, details: updateLog };
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

  const crypto = require("crypto");
  function hmac(key, data) { return crypto.createHmac("sha256", key).update(data).digest(); }
  function sigV4Put(key, body, contentType) {
    const host = r2Account + ".r2.cloudflarestorage.com";
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const dateStr = amzDate.slice(0, 8);
    const payloadHash = crypto.createHash("sha256").update(body).digest("hex");
    const canonicalUri = "/" + r2Bucket + "/" + key;
    const canonicalHeaders = "content-type:" + contentType + "\nhost:" + host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + amzDate + "\n";
    const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = "PUT\n" + canonicalUri + "\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash;
    const credScope = dateStr + "/auto/s3/aws4_request";
    const strToSign = "AWS4-HMAC-SHA256\n" + amzDate + "\n" + credScope + "\n" + crypto.createHash("sha256").update(canonicalRequest).digest("hex");
    const signingKey = hmac(hmac(hmac(hmac("AWS4" + r2Secret, dateStr), "auto"), "s3"), "aws4_request");
    const signature = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");
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
  await sb.from("backup_log").insert({
    type: "auto-r2-monthly",
    tables: successTables.join(","),
    row_counts: JSON.stringify(results),
    exported_by: "CRON",
    notes: "Backup bulanan ke R2: backup/" + yearMonth + "/"
  }).catch(e => console.error("[BACKUP_LOG]", e.message));

  const summary = "Backup " + yearMonth + ": " + Object.entries(results).map(([t, r]) => t + "=" + r).join(", ");
  await log("BACKUP_DATA", summary, successTables.length === tables.length ? "SUCCESS" : "WARNING");
  return { yearMonth, results };
}

// ══════════════════════════════════════════════════
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
  try {
    const { timingSafeEqual } = require("crypto");
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
        const tBuf = Buffer.from(iToken, "utf-8");
        const sBuf = Buffer.from(internalSecret, "utf-8");
        if (tBuf.length === sBuf.length) authorized = timingSafeEqual(tBuf, sBuf);
      }
    }
  } catch {
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    authorized = (cronSecret && token === cronSecret) ||
                 (internalSecret && (req.headers["x-internal-token"] || req.headers["x-api-key"]) === internalSecret);
  }

  if (!cronSecret && !internalSecret) return res.status(500).json({error:"Auth not configured"});
  if (!authorized) return res.status(401).json({error:"Unauthorized"});

  const task = req.query.task || "reminder";

  try {
    let result;
    if (task === "daily")           result = await taskDaily();
    else if (task === "stock")      result = await taskStock();
    else if (task === "cleanup")    result = await taskCleanup();
    else if (task === "wa-cleanup") result = await taskWaCleanup();
    else if (task === "bukti-bayar") result = await taskScanBuktiBayar();
    else if (task === "backup")     result = await taskBackupData();
    else if (task === "weekly")     result = await taskWeeklyReport();
    else                            result = await taskReminder();

    return res.json({ ok:true, task, timestamp:new Date().toISOString(), ...result });
  } catch(err) {
    await log("CRON_ERROR", `task=${task}: ${err.message}`, "ERROR");
    return res.status(500).json({ ok:false, error:err.message });
  }
}
