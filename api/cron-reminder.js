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
      action, detail, status, actor:"CRON",
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

  // Auto-approve PENDING_APPROVAL > 6 jam (limit to prevent timeout)
  const { data: pend } = await sb.from("invoices").select("*").eq("status","PENDING_APPROVAL").limit(300);
  for (const inv of pend||[]) {
    const hrs = (Date.now()-new Date(inv.created_at).getTime())/3600000;
    if (hrs>=6 && /(Cleaning|Install)/.test(inv.service||"")) {
      const due = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
      await sb.from("invoices").update({status:"UNPAID",sent:true,due,approved_by:"CRON_AUTO",approved_at:new Date().toISOString()}).eq("id",inv.id);
      res.autoapproved++;
      // Hanya notif owner — pengiriman invoice ke customer = manual via frontend
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
  const [{ data:orders }, { data:invoices }, { data:laporan }] = await Promise.all([
    sb.from("orders").select("*").eq("date",today),
    sb.from("invoices").select("*").gte("created_at",today+"T00:00:00"),
    sb.from("service_reports").select("*").eq("date",today),
  ]);
  const done    = (orders||[]).filter(o=>o.status==="COMPLETED").length;
  const proses  = (orders||[]).filter(o=>["ON_SITE","WORKING"].includes(o.status)).length;
  const masuk   = (invoices||[]).filter(i=>i.status==="PAID").reduce((s,i)=>s+(i.total||0),0);
  const pending = (invoices||[]).filter(i=>["UNPAID","OVERDUE"].includes(i.status)).reduce((s,i)=>s+(i.total||0),0);
  const tgl = new Date().toLocaleDateString("id-ID",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const msg = `📊 *LAPORAN HARIAN ACLEAN*\n${tgl}\n\n🔧 Order: ✅${done} selesai · 🔄${proses} proses · 📝${(laporan||[]).length} laporan\n\n💰 Lunas: ${fmt(masuk)}\n⏳ Pending: ${fmt(pending)}\n\n_ARA AClean_`;
  const waSent = await sendWA(OWNER_PHONE, msg);
  await log("DAILY_REPORT",`${done} selesai, ${fmt(masuk)} masuk`);
  return { orders:orders?.length, revenue:masuk, waSent };
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
  // Ambil laporan > 360 hari lalu
  const cutoff = new Date(Date.now()-360*86400000).toISOString();
  const { data: old } = await sb.from("service_reports").select("id,fotos").lt("created_at",cutoff).limit(100);
  let deleted = 0, r2deleted = 0;
  for (const rep of old||[]) {
    const fotos = rep.fotos||[];
    if (!fotos.length) continue;

    // Delete actual R2 objects
    for (const url of fotos) {
      try {
        // Extract key from URL: either after bucket/ or after .r2.dev
        const match = url.match(/(?:r2\.cloudflarestorage\.com\/[^/]+\/|\.r2\.dev\/)(.+)/);
        if (match) {
          const ok = await deleteR2Object(match[1]);
          if (ok) r2deleted++;
        }
      } catch(e) { console.error("[CLEANUP_R2_EXTRACT_ERROR]", {url, error: e.message}); }
    }

    // Clear URL references from DB
    const { error: updErr } = await sb.from("service_reports").update({fotos:[]}).eq("id",rep.id);
    if (updErr) console.error("[CLEANUP_FOTOS_UPDATE_ERROR]", {reportId: rep.id, fotosCount: fotos.length, error: updErr.message});
    deleted += fotos.length;
  }
  await log("CLEANUP_FOTOS",`${deleted} foto ref dihapus, ${r2deleted} file R2 deleted dari ${old?.length||0} laporan`);

  // Cleanup agent_logs > 90 hari (dipindah dari frontend ke sini setelah RLS fix)
  const cutoff90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const { error: logDelErr } = await sb.from("agent_logs").delete().lt("created_at", cutoff90);
  if (logDelErr) console.error("[CLEANUP_AGENT_LOGS]", logDelErr.message);

  return { deleted, r2deleted, reports: old?.length||0 };
}

// ══════════════════════════════════════════════════
// TASK 5: Cleanup WA chat lama (>14 hari)
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
    if (task === "daily")        result = await taskDaily();
    else if (task === "stock")   result = await taskStock();
    else if (task === "cleanup") result = await taskCleanup();
    else if (task === "wa-cleanup") result = await taskWaCleanup();
    else                         result = await taskReminder();

    return res.json({ ok:true, task, timestamp:new Date().toISOString(), ...result });
  } catch(err) {
    await log("CRON_ERROR", `task=${task}: ${err.message}`, "ERROR");
    return res.status(500).json({ ok:false, error:err.message });
  }
}
