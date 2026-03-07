// api/cron-reminder.js
// Vercel Cron Function — otomatis jalan setiap hari
// Konfigurasi di vercel.json: crons array
//
// Tugas:
//   1. Tandai invoice UNPAID melewati due date → OVERDUE
//   2. Kirim reminder WA ke customer yang belum bayar
//   3. Kirim laporan harian ke Owner (jam 18:00)
//   4. Kirim rekap mingguan ke Owner (Sabtu 20:00)

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const FONNTE_TOKEN  = process.env.FONNTE_TOKEN;
const OWNER_PHONE   = process.env.OWNER_PHONE;  // format: 628xxxxxxxxxx

// ── Kirim WA via Fonnte ──────────────────────────────────────────────────────
async function sendWA(phone, message) {
  if (!FONNTE_TOKEN || !phone) return false;
  try {
    const r = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { "Authorization": FONNTE_TOKEN },
      body: new URLSearchParams({ target: phone, message, countryCode: "62" })
    });
    const d = await r.json();
    return d.status === true;
  } catch (_) { return false; }
}

// ── Format rupiah ────────────────────────────────────────────────────────────
function fmt(n) {
  return "Rp " + (parseInt(n) || 0).toLocaleString("id-ID");
}

export default async function handler(req, res) {
  // Vercel Cron mengirim header Authorization untuk keamanan
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now    = new Date();
  const today  = now.toISOString().slice(0, 10);
  const hour   = now.getHours(); // WIB = UTC+7, Vercel pakai UTC
  // Vercel cron pakai UTC. WIB = UTC+7.
  // Jam 17:00 WIB = 10:00 UTC → set cron di vercel.json: "0 10 * * *"
  // Jam 18:00 WIB = 11:00 UTC → "0 11 * * *"
  // Jam 20:00 WIB sabtu = 13:00 UTC sabtu → "0 13 * * 6"

  const tasks = [];

  // ════════════════════════════════════════════════════════
  // TASK 1: Tandai invoice OVERDUE
  // ════════════════════════════════════════════════════════
  try {
    const { data: unpaidInvs, error } = await supabase
      .from("invoices")
      .select("id,customer,phone,total,due")
      .eq("status", "UNPAID")
      .lt("due", today);

    if (!error && unpaidInvs?.length > 0) {
      const ids = unpaidInvs.map(i => i.id);
      await supabase.from("invoices").update({ status: "OVERDUE" }).in("id", ids);
      tasks.push({ task: "overdue_detection", count: ids.length, ids });

      // Log ke agent_logs
      await supabase.from("agent_logs").insert({
        action: "CRON_OVERDUE",
        detail: `${ids.length} invoice ditandai OVERDUE: ${ids.join(", ")}`,
        status: "WARNING"
      });
    }
  } catch (e) {
    tasks.push({ task: "overdue_detection", error: e.message });
  }

  // ════════════════════════════════════════════════════════
  // TASK 2: Kirim reminder WA ke invoice UNPAID & OVERDUE
  // Jalan jam 17:00 WIB (10:00 UTC)
  // ════════════════════════════════════════════════════════
  if (hour === 10) {
    try {
      const { data: needReminder } = await supabase
        .from("invoices")
        .select("id,customer,phone,total,due,status")
        .in("status", ["UNPAID", "OVERDUE"])
        .not("phone", "is", null);

      let sent = 0;
      for (const inv of needReminder || []) {
        if (!inv.phone) continue;
        const isOverdue = inv.status === "OVERDUE";
        const msg = isOverdue
          ? `⚠️ *Tagihan Overdue*\n\nYth. ${inv.customer},\n\nTagihan *${inv.id}* senilai *${fmt(inv.total)}* sudah melewati jatuh tempo (${inv.due}).\n\nMohon segera lakukan pembayaran. Hubungi kami jika ada pertanyaan.\n\nTerima kasih\n*AClean Service*`
          : `📋 *Pengingat Pembayaran*\n\nYth. ${inv.customer},\n\nTagihan *${inv.id}* senilai *${fmt(inv.total)}* jatuh tempo pada *${inv.due}*.\n\nMohon segera lakukan pembayaran.\n\nTerima kasih\n*AClean Service*`;

        const ok = await sendWA(inv.phone, msg);
        if (ok) {
          sent++;
          await supabase.from("agent_logs").insert({
            action: "CRON_REMINDER_SENT",
            detail: `Reminder ${isOverdue?"OVERDUE":"UNPAID"} terkirim ke ${inv.customer} (${inv.phone}) — ${inv.id}`,
            status: "SUCCESS"
          });
        }
      }
      tasks.push({ task: "payment_reminder", sent, total: needReminder?.length || 0 });
    } catch (e) {
      tasks.push({ task: "payment_reminder", error: e.message });
    }
  }

  // ════════════════════════════════════════════════════════
  // TASK 3: Laporan harian ke Owner (jam 18:00 WIB = 11:00 UTC)
  // ════════════════════════════════════════════════════════
  if (hour === 11 && OWNER_PHONE) {
    try {
      const [ordRes, invRes] = await Promise.all([
        supabase.from("orders").select("id,status,service,customer,teknisi").eq("date", today),
        supabase.from("invoices").select("id,status,total,customer").eq("created_at::date", today)
      ]);

      const orders = ordRes.data || [];
      const invoices = invRes.data || [];
      const selesai  = orders.filter(o => o.status === "COMPLETED").length;
      const progress = orders.filter(o => o.status === "IN_PROGRESS").length;
      const pending  = orders.filter(o => o.status === "PENDING").length;
      const revenue  = invoices.filter(i => i.status === "PAID").reduce((a, b) => a + (b.total || 0), 0);
      const unpaid   = invoices.filter(i => ["UNPAID","OVERDUE"].includes(i.status)).reduce((a, b) => a + (b.total || 0), 0);

      const msg = `📊 *Laporan Harian AClean*\n${today}\n\n` +
        `🔧 Order Hari Ini: ${orders.length}\n` +
        `  ✅ Selesai: ${selesai}\n` +
        `  🔄 Proses: ${progress}\n` +
        `  ⏳ Pending: ${pending}\n\n` +
        `💰 Keuangan:\n` +
        `  ✅ Terbayar: ${fmt(revenue)}\n` +
        `  ⏳ Belum Bayar: ${fmt(unpaid)}\n\n` +
        `Dilihat dari AClean App 🔗`;

      await sendWA(OWNER_PHONE, msg);
      await supabase.from("agent_logs").insert({
        action: "CRON_DAILY_REPORT",
        detail: `Laporan harian terkirim ke Owner — ${orders.length} order, revenue ${fmt(revenue)}`,
        status: "SUCCESS"
      });
      tasks.push({ task: "daily_report", orders: orders.length, revenue });
    } catch (e) {
      tasks.push({ task: "daily_report", error: e.message });
    }
  }

  // ════════════════════════════════════════════════════════
  // TASK 4: Rekap mingguan ke Owner (Sabtu jam 20:00 WIB = 13:00 UTC)
  // ════════════════════════════════════════════════════════
  if (hour === 13 && now.getDay() === 6 && OWNER_PHONE) {
    try {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const [wOrd, wInv] = await Promise.all([
        supabase.from("orders").select("id,status,service,teknisi").gte("date", weekAgo).lte("date", today),
        supabase.from("invoices").select("id,status,total").gte("created_at", weekAgo + "T00:00:00")
      ]);

      const wo = wOrd.data || [];
      const wi = wInv.data || [];
      const weekRev = wi.filter(i => i.status === "PAID").reduce((a, b) => a + (b.total || 0), 0);
      const cleaning = wo.filter(o => o.service === "Cleaning").length;
      const install  = wo.filter(o => o.service === "Install").length;
      const repair   = wo.filter(o => o.service === "Repair").length;

      const msg = `📈 *Rekap Mingguan AClean*\n${weekAgo} s/d ${today}\n\n` +
        `🔧 Total Order: ${wo.length}\n` +
        `  🧹 Cleaning: ${cleaning}\n` +
        `  🔌 Install: ${install}\n` +
        `  🔨 Repair: ${repair}\n\n` +
        `💰 Pendapatan Minggu Ini: *${fmt(weekRev)}*\n\n` +
        `Pantau detail di AClean App 🔗`;

      await sendWA(OWNER_PHONE, msg);
      tasks.push({ task: "weekly_report", totalOrders: wo.length, weekRevenue: weekRev });
    } catch (e) {
      tasks.push({ task: "weekly_report", error: e.message });
    }
  }

  return res.status(200).json({ ok: true, date: today, hour, tasks });
}
