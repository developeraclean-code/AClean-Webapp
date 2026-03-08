/**
 * /api/cron-reminder.js
 * ══════════════════════════════════════════════════════════
 * AClean — GAP-01 FIX: Invoice Overdue Reminder via Cron
 * ══════════════════════════════════════════════════════════
 *
 * Dipanggil otomatis oleh Vercel Cron setiap hari jam 17:00 WIB (10:00 UTC).
 * Logika:
 *   - 1–7  hari overdue → Reminder 1 (sopan)
 *   - 8–14 hari overdue → Reminder 2 (lebih tegas)
 *   - 15–21 hari overdue → Reminder 3 (eskalasi CS)
 *   - 22+  hari overdue → Eskalasi ke Owner
 *   - Invoice PENDING_APPROVAL > 6 jam → Auto-approve Cleaning/Install
 *
 * Cara aktifkan di Vercel:
 *   1. Tambahkan ke vercel.json:
 *      { "crons": [{ "path": "/api/cron-reminder", "schedule": "0 10 * * *" }] }
 *   2. Set env var: CRON_SECRET=<random_string_panjang>
 *
 * Cara test manual:
 *   curl -X POST https://a-clean-webapp.vercel.app/api/cron-reminder \
 *     -H "Authorization: Bearer <CRON_SECRET>"
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service key — bisa bypass RLS
);

const OWNER_PHONE  = process.env.OWNER_PHONE  || "6281299898937";
const FONNTE_TOKEN = process.env.FONNTE_TOKEN  || "";

// ── Send WA via Fonnte ──────────────────────────────────────
async function sendWA(phone, message) {
  if (!FONNTE_TOKEN || !phone) return false;
  try {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        "Authorization": FONNTE_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target: phone, message, countryCode: "62" }),
    });
    const data = await res.json();
    return data.status === true;
  } catch (e) {
    console.error("sendWA error:", e.message);
    return false;
  }
}

// ── Format Rupiah ───────────────────────────────────────────
function fmt(n) {
  return "Rp" + (Number(n)||0).toLocaleString("id-ID");
}

// ── Hitung hari dari tanggal ────────────────────────────────
function daysSince(dateStr) {
  if (!dateStr) return 0;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// ── Log ke agent_logs ───────────────────────────────────────
async function logAction(action, detail, status = "SUCCESS") {
  await supabase.from("agent_logs").insert({
    action,
    detail,
    status,
    time: new Date().toISOString(),
    actor: "CRON",
  }).catch(() => {});
}

// ════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  // Auth check
  const auth = req.headers.authorization || "";
  const secret = process.env.CRON_SECRET || "";
  if (secret && auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Hanya POST atau GET dari Vercel Cron
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const results = {
    reminder1: 0, reminder2: 0, reminder3: 0, escalated: 0,
    autoapproved: 0, errors: [],
  };

  try {
    const today = new Date().toISOString().slice(0, 10);

    // ── 1. Load semua invoice UNPAID & OVERDUE ──────────────
    const { data: invoices, error: invErr } = await supabase
      .from("invoices")
      .select("id,customer,phone,total,status,sent,due,service")
      .in("status", ["UNPAID", "OVERDUE"]);

    if (invErr) throw new Error("Load invoices: " + invErr.message);

    for (const inv of invoices || []) {
      const daysOverdue = daysSince(inv.due || inv.sent);

      // Tandai OVERDUE jika belum
      if (inv.status === "UNPAID" && inv.due && inv.due < today) {
        await supabase.from("invoices").update({ status: "OVERDUE" }).eq("id", inv.id);
        inv.status = "OVERDUE";
      }

      if (!inv.phone) continue;

      let msg = null;

      if (daysOverdue >= 1 && daysOverdue <= 7) {
        // Reminder 1 — sopan
        msg = `Halo ${inv.customer} 🙏\n\nIni pengingat untuk invoice jasa servis AC dari *AClean Service*:\n\n📋 Invoice: *${inv.id}*\n🔧 Layanan: ${inv.service||"-"}\n💰 Total: *${fmt(inv.total)}*\n📅 Jatuh tempo: ${inv.due||"-"}\n\nMohon segera diselesaikan pembayarannya ya, Kak 😊\nTransfer ke: *BCA 8830883011* a.n. Malda Retta\n\nTerima kasih! — AClean Service`;
        results.reminder1++;
      } else if (daysOverdue >= 8 && daysOverdue <= 14) {
        // Reminder 2 — lebih tegas
        msg = `Halo ${inv.customer},\n\nKami menghubungi kembali terkait invoice *${inv.id}* yang belum dibayar (${daysOverdue} hari).\n\n💰 Total: *${fmt(inv.total)}*\n\nMohon segera lakukan pembayaran ke:\n🏦 *BCA 8830883011* a.n. Malda Retta\n\nJika ada kendala, balas pesan ini dan kami siap bantu.\n\n— AClean Service`;
        results.reminder2++;
      } else if (daysOverdue >= 15 && daysOverdue <= 21) {
        // Reminder 3 — eskalasi ke CS
        msg = `Halo ${inv.customer},\n\nInvoice *${inv.id}* sudah melewati jatuh tempo *${daysOverdue} hari*.\n\n💰 Total: *${fmt(inv.total)}*\n\nApakah ada kendala dengan pembayaran? Kami ingin membantu menyelesaikannya. Balas pesan ini atau hubungi CS kami.\n\nTerima kasih atas perhatiannya.\n— AClean Service`;
        results.reminder3++;
        // Notif CS
        await sendWA(OWNER_PHONE, `⚠️ *OVERDUE ALERT*\nInvoice ${inv.id} — ${inv.customer}\nTotal: ${fmt(inv.total)}\nSudah ${daysOverdue} hari belum dibayar.\nPerlu follow-up manual.`);
      } else if (daysOverdue >= 22) {
        // Eskalasi ke Owner
        results.escalated++;
        await sendWA(OWNER_PHONE, `🚨 *ESKALASI OVERDUE*\nInvoice: ${inv.id}\nCustomer: ${inv.customer}\nTotal: ${fmt(inv.total)}\nOverdue: ${daysOverdue} hari\n\nMohon keputusan Owner — write-off atau tindak lanjut hukum?`);
        await logAction("INVOICE_ESCALATED", `${inv.id} — ${daysOverdue} hari overdue`, "WARNING");
        continue; // tidak kirim reminder ke customer, langsung eskalasi owner
      }

      if (msg) {
        await sendWA(inv.phone, msg);
        await logAction("REMINDER_SENT", `${inv.id} — ${inv.customer} — ${daysOverdue}d overdue`, "SUCCESS");
      }
    }

    // ── 2. Auto-approve PENDING_APPROVAL > 6 jam (Cleaning/Install) ──
    const { data: pending, error: pendErr } = await supabase
      .from("invoices")
      .select("id,customer,phone,total,service,created_at")
      .eq("status", "PENDING_APPROVAL");

    if (!pendErr) {
      for (const inv of pending || []) {
        const hoursWaiting = (Date.now() - new Date(inv.created_at).getTime()) / (1000 * 60 * 60);
        const isAutoApprovable = (inv.service || "").includes("Cleaning") || (inv.service || "").includes("Install");

        if (hoursWaiting >= 6 && isAutoApprovable) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 7);
          const due = dueDate.toISOString().slice(0, 10);

          await supabase.from("invoices").update({
            status: "UNPAID",
            sent: today,
            due,
            approved_by: "CRON_AUTO",
            approved_at: new Date().toISOString(),
          }).eq("id", inv.id);

          results.autoapproved++;
          await logAction("AUTO_APPROVED", `${inv.id} auto-approved setelah ${Math.round(hoursWaiting)}j (Owner tidak reply)`, "SUCCESS");

          // Notif Owner bahwa invoice auto-approved
          await sendWA(OWNER_PHONE, `ℹ️ Invoice *${inv.id}* (${inv.customer}) auto-approved setelah ${Math.round(hoursWaiting)} jam.\nTotal: ${fmt(inv.total)}\nStatus → UNPAID. Kirim ke customer otomatis.`);

          // Notif customer
          if (inv.phone) {
            await sendWA(inv.phone, `Halo ${inv.customer} 😊\n\nInvoice jasa servis AC Anda telah disiapkan:\n\n📋 Invoice: *${inv.id}*\n💰 Total: *${fmt(inv.total)}*\n📅 Jatuh tempo: *${due}*\n\nSilakan transfer ke:\n🏦 *BCA 8830883011* a.n. Malda Retta\n\nKirim bukti transfer ke nomor ini ya, Kak 🙏\n— AClean Service`);
          }
        }
      }
    }

    // ── 3. Update status OVERDUE untuk semua UNPAID yang sudah lewat due ──
    const { error: overdueErr } = await supabase
      .from("invoices")
      .update({ status: "OVERDUE" })
      .eq("status", "UNPAID")
      .lt("due", today);

    if (overdueErr) results.errors.push("mark overdue: " + overdueErr.message);

    await logAction("CRON_RUN", `reminder1=${results.reminder1} reminder2=${results.reminder2} reminder3=${results.reminder3} escalated=${results.escalated} autoapproved=${results.autoapproved}`, "SUCCESS");

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...results,
    });

  } catch (err) {
    console.error("cron-reminder error:", err);
    await logAction("CRON_ERROR", err.message, "ERROR").catch(() => {});
    return res.status(500).json({ ok: false, error: err.message });
  }
}
