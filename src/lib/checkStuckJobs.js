// checkStuckJobs — cek order stuck / laporan telat + kirim reminder WA (SLA check).
// Diekstrak dari App.jsx (Fase 3, pola ctx).
export async function checkStuckJobs({
  TODAY, addAgentLog, agentLogs, appSettings, laporanReports, ordersData, sendWA,
  showNotif, teknisiData, userAccounts,
} = {}) {
    // ── SLA CHECK: alert jika teknisi belum ON_SITE 30 menit setelah jam booking ──
    const now2 = new Date();
    const slaAlerts = ordersData.filter(o => {
      if (o.status !== "DISPATCHED" && o.status !== "CONFIRMED") return false;
      if (!o.date || !o.time || o.date > TODAY) return false;
      const bookingMs = (o.date && o.time ? new Date(o.date + "T" + o.time + ":00").getTime() : 0);
      const menit30 = 30 * 60 * 1000;
      // Sudah lebih dari 30 menit dari jam booking tapi belum ON_SITE
      return (now2.getTime() > bookingMs + menit30) && o.date === TODAY;
    });
    if (slaAlerts.length > 0) {
      slaAlerts.forEach(o => {
        const alreadyAlerted = agentLogs.some(l =>
          l.action === "SLA_ALERT" && (l.detail || "").includes(o.id)
          && (Date.now() - new Date(l.created_at || 0).getTime()) < 2 * 60 * 60 * 1000
        );
        if (!alreadyAlerted) {
          addAgentLog("SLA_ALERT",
            `⚠️ SLA: ${o.teknisi} belum konfirmasi tiba — ${o.id} ${o.customer} jam ${o.time}`,
            "WARNING"
          );
          showNotif(`⚠️ SLA: ${o.teknisi} belum di lokasi ${o.customer} (booking ${o.time})`, true);
          // Kirim WA Owner
          const owners = [...(teknisiData || []), ...(userAccounts || [])].filter(u => u.role === "Owner" && u.phone);
          const slaMsg = `⚠️ *SLA ALERT*\n📋 ${o.id}\n👤 ${o.customer}\n👷 ${o.teknisi || "-"}\n⏰ Booking: ${o.time} — belum konfirmasi tiba`;
          owners.forEach(ow => sendWA(ow.phone, slaMsg));
        }
      });
    }
    const nowMs = Date.now();
    const stuckOrders = ordersData.filter(o => {
      if (!["DISPATCHED", "ON_SITE"].includes(o.status)) return false;
      if (!o.date || !o.time_end) return false;
      // Sudah lewat tanggal job
      if (o.date > TODAY) return false;
      // Hitung estimasi selesai
      const [h, m] = (o.time_end || "17:00").split(":").map(Number);
      const jobEndMs = (o.date && o.time_end ? new Date(o.date + "T" + o.time_end + ":00").getTime() : 0);
      const satu_jam = 60 * 60 * 1000;
      // Sudah lebih dari 1 jam setelah selesai
      return nowMs > (jobEndMs + satu_jam);
    });

    for (const o of stuckOrders) {
      // Cek apakah sudah ada laporan
      const sudahAda = laporanReports.find(r => r.job_id === o.id);
      if (sudahAda) continue;
      // Cek apakah reminder sudah dikirim (pakai agent_logs)
      const sudahReminder = agentLogs.find(l =>
        l.action === "LAPORAN_REMINDER" && l.detail?.includes(o.id)
      );
      if (sudahReminder) continue;

      // Kirim WA reminder ke teknisi
      const tek = teknisiData.find(t => t.name === o.teknisi);
      if (tek?.phone) {
        const msg = `⏰ *Reminder Laporan*

Halo ${o.teknisi}, job *${o.id}* (${o.customer} — ${o.service}) sudah selesai lebih dari 1 jam.

Mohon segera submit laporan di aplikasi ${appSettings.app_name || "AClean"} ya! 🙏`;
        if (tek?.phone) sendWA(tek.phone, msg);
      }
      addAgentLog("LAPORAN_REMINDER", `Reminder laporan dikirim ke ${o.teknisi} — ${o.id}`, "WARNING");
    }
}
