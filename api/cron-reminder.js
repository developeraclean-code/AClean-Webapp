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
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const OWNER_PHONE  = process.env.OWNER_PHONE  || "6281299898937";
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

function fmt(n) { return "Rp" + (Number(n)||0).toLocaleString("id-ID"); }
function daysSince(d) { return d ? Math.floor((Date.now()-new Date(d).getTime())/86400000) : 0; }

async function log(action, detail, status="SUCCESS") {
  await sb.from("agent_logs").insert({
    action, detail, status, actor:"CRON",
    time: new Date().toISOString()
  }).catch(()=>{});
}

// ══════════════════════════════════════════════════
// TASK 1: Invoice Reminder (default)
// ══════════════════════════════════════════════════
async function taskReminder() {
  const today = new Date().toISOString().slice(0,10);
  const res = { reminder1:0, reminder2:0, reminder3:0, escalated:0, autoapproved:0 };

  const { data: invs } = await sb.from("invoices").select("*").in("status",["UNPAID","OVERDUE"]);
  for (const inv of invs||[]) {
    const daysOverdue = daysSince(inv.due || inv.sent);
    if (inv.status==="UNPAID" && inv.due && inv.due<today) {
      await sb.from("invoices").update({status:"OVERDUE"}).eq("id",inv.id);
    }
    if (!inv.phone) continue;
    let msg = null;
    if (daysOverdue>=1  && daysOverdue<=7)  { msg=`Halo ${inv.customer} 🙏\n\nPengingat invoice *${inv.id}* — ${fmt(inv.total)}, jatuh tempo ${inv.due}.\n\nTransfer ke: *BCA 8830883011* a.n. Malda Retta\nTerima kasih! — AClean`; res.reminder1++; }
    else if (daysOverdue>=8  && daysOverdue<=14) { msg=`Halo ${inv.customer},\n\nInvoice *${inv.id}* belum dibayar (${daysOverdue} hari). Total: ${fmt(inv.total)}.\n\nTransfer ke *BCA 8830883011* a.n. Malda Retta.\n\n— AClean`; res.reminder2++; }
    else if (daysOverdue>=15 && daysOverdue<=21) { msg=`Halo ${inv.customer},\n\nInvoice *${inv.id}* sudah ${daysOverdue} hari lewat jatuh tempo (${fmt(inv.total)}).\n\nAda kendala? Balas pesan ini. — AClean`; res.reminder3++; await sendWA(OWNER_PHONE,`⚠️ OVERDUE ${inv.id} — ${inv.customer} — ${daysOverdue}h — ${fmt(inv.total)}`); }
    else if (daysOverdue>=22) { res.escalated++; await sendWA(OWNER_PHONE,`🚨 ESKALASI ${inv.id} — ${inv.customer} — ${daysOverdue}h — ${fmt(inv.total)}`); continue; }
    if (msg) { await sendWA(inv.phone, msg); await log("REMINDER_SENT",`${inv.id} — ${daysOverdue}d`); }
  }

  // Auto-approve PENDING_APPROVAL > 6 jam
  const { data: pend } = await sb.from("invoices").select("*").eq("status","PENDING_APPROVAL");
  for (const inv of pend||[]) {
    const hrs = (Date.now()-new Date(inv.created_at).getTime())/3600000;
    if (hrs>=6 && /(Cleaning|Install)/.test(inv.service||"")) {
      const due = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
      await sb.from("invoices").update({status:"UNPAID",sent:true,due,approved_by:"CRON_AUTO",approved_at:new Date().toISOString()}).eq("id",inv.id);
      res.autoapproved++;
      await sendWA(OWNER_PHONE,`ℹ️ Invoice *${inv.id}* (${inv.customer}) auto-approved setelah ${Math.round(hrs)}j. Total: ${fmt(inv.total)}`);
      if (inv.phone) await sendWA(inv.phone,`Halo ${inv.customer} 😊\n\nInvoice *${inv.id}* — ${fmt(inv.total)} sudah dikirim.\nJatuh tempo: ${due}\nTransfer ke *BCA 8830883011* a.n. Malda Retta 🙏`);
    }
  }

  // Update UNPAID lewat due → OVERDUE
  await sb.from("invoices").update({status:"OVERDUE"}).eq("status","UNPAID").lt("due",new Date().toISOString().slice(0,10));
  await log("CRON_REMINDER",`r1=${res.reminder1} r2=${res.reminder2} r3=${res.reminder3} esc=${res.escalated} auto=${res.autoapproved}`);
  return res;
}

// ══════════════════════════════════════════════════
// TASK 2: Daily Report
// ══════════════════════════════════════════════════
async function taskDaily() {
  const today = new Date().toISOString().slice(0,10);
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
  await sendWA(OWNER_PHONE, msg);
  await log("DAILY_REPORT",`${done} selesai, ${fmt(masuk)} masuk`);
  return { orders:orders?.length, revenue:masuk };
}

// ══════════════════════════════════════════════════
// TASK 3: Stock Alert
// ══════════════════════════════════════════════════
async function taskStock() {
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

// ══════════════════════════════════════════════════
// TASK 4: Cleanup foto lama (>12 bulan) dari R2
// ══════════════════════════════════════════════════
async function taskCleanup() {
  // Ambil laporan > 12 bulan lalu
  const cutoff = new Date(Date.now()-365*86400000).toISOString();
  const { data: old } = await sb.from("service_reports").select("id,fotos").lt("created_at",cutoff);
  let deleted = 0;
  for (const rep of old||[]) {
    const fotos = rep.fotos||[];
    if (!fotos.length) continue;
    // Update record: hapus URL foto (foto sudah lama, hemat storage)
    await sb.from("service_reports").update({fotos:[]}).eq("id",rep.id).catch(()=>{});
    deleted += fotos.length;
  }
  await log("CLEANUP_FOTOS",`${deleted} foto lama dihapus dari ${old?.length||0} laporan`);
  return { deleted, reports: old?.length||0 };
}

// ══════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();

  const auth   = req.headers.authorization || "";
  const secret = process.env.CRON_SECRET   || "";
  if (secret && auth !== `Bearer ${secret}`) return res.status(401).json({error:"Unauthorized"});

  const task = req.query.task || "reminder";

  try {
    let result;
    if (task === "daily")   result = await taskDaily();
    else if (task === "stock")   result = await taskStock();
    else if (task === "cleanup") result = await taskCleanup();
    else                         result = await taskReminder();

    return res.json({ ok:true, task, timestamp:new Date().toISOString(), ...result });
  } catch(err) {
    await log("CRON_ERROR", `task=${task}: ${err.message}`, "ERROR").catch(()=>{});
    return res.status(500).json({ ok:false, error:err.message });
  }
}
