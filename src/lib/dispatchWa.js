// sendDispatchWA — kirim WA dispatch ke teknisi/helper untuk sebuah order.
// Diekstrak dari App.jsx (Fase 3, pola ctx).
export async function sendDispatchWA(order, {
  _apiHeaders, addAgentLog, appSettings, currentUser, sendWA, showNotif, supabase, teknisiData,
} = {}) {
    const tek = teknisiData.find(t => t.name === order.teknisi);
    if (!tek?.phone) return showNotif("⚠️ No. HP teknisi tidak ditemukan");
    const msg =
      "DISPATCH JOB " + order.id + "\n"
      + "Customer: " + order.customer + "\n"
      + "Alamat: " + order.address + "\n"
      + "Service: " + order.service + " - " + order.units + " unit\n"
      + "Jadwal: " + order.date + " jam " + order.time + (order.time_end ? " - " + order.time_end : "") + "\n\n"
      + `Segera konfirmasi kehadiran. — ${appSettings.app_name || "AClean"}`;
    const ok = await sendWA(tek.phone, msg);
    if (order.helper) {
      const helperData = teknisiData.find(t => t.name === order.helper);
      if (helperData?.phone) {
        const helperMsg =
          "ASSIST JOB " + order.id + "\n"
          + "Customer: " + order.customer + "\n"
          + "Alamat: " + order.address + "\n"
          + "Service: " + order.service + " - " + order.units + " unit\n"
          + "Jadwal: " + order.date + " jam " + order.time + "\n"
          + "Teknisi: " + order.teknisi + "\n\n"
          + `Kamu ditugaskan sebagai Helper. — ${appSettings.app_name || "AClean"}`;
        await sendWA(helperData.phone, helperMsg);
      }
    }
    if (ok) {
      try {
        await supabase.from("dispatch_logs").insert({
          order_id: order.id, teknisi: order.teknisi,
          assigned_by_name: currentUser?.name || "",
          wa_message: msg, status: "SENT"
        });
      } catch (e) { /* dispatch_logs opsional */ }
      addAgentLog("DISPATCH_WA_SENT", `WA dispatch ke ${order.teknisi} untuk ${order.id}`, "SUCCESS");
      showNotif(`✅ WA Dispatch terkirim ke ${order.teknisi}${order.helper ? " + " + order.helper : ""}`);

      // Kirim link portal ke customer jika fitur aktif
      if (appSettings?.customer_portal_enabled === "true" && order.phone) {
        try {
          const hdrs = await _apiHeaders();
          const tokRes = await fetch("/api/generate-customer-token", {
            method: "POST", headers: hdrs,
            body: JSON.stringify({
              phone: order.phone,
              customer_name: order.customer,
              // Kirim maintenance_client_id agar API return link portal permanen (B2B)
              maintenance_client_id: order.maintenance_client_id || null,
            }),
          });
          if (tokRes.ok) {
            const { link, is_maintenance } = await tokRes.json();
            const tgl = new Date(order.date).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
            const team = [order.teknisi, order.helper].filter(Boolean).join(" & ");
            const appName = appSettings.app_name || "AClean";
            const portalMsg = is_maintenance
              ? `Halo ${order.customer}! 👋\n` +
                `Konfirmasi Jadwal Maintenance Aset AC Anda 😊\n` +
                `Tim ${appName} sedang menuju lokasi Anda sekarang 🚗\n\n` +
                `📋 Detail Servis:\n` +
                `• Layanan  : ${order.service}\n` +
                `• Jadwal   : ${tgl} · ${order.time || "--:--"}\n` +
                `• Tim      : ${team || order.teknisi}\n` +
                `• Lokasi   : ${order.address || "-"}\n\n` +
                `🔗 Portal Maintenance Aset AC Anda:\n${link}\n\n` +
                `Akses laporan, history, dan status aset AC Perusahaan Anda secara lengkap. Jika Ada Pertanyaan? Balas pesan ini.\n— ${appName} Service`
              : `Halo ${order.customer}! 👋\n` +
                `Ini adalah Pesan Otomatis Konfirmasi Pesanan Anda 😊\n` +
                `Tim ${appName} sedang menuju lokasi Anda sekarang 🚗\n\n` +
                `📋 Detail Servis:\n` +
                `• Layanan  : ${order.service}\n` +
                `• Jadwal   : ${tgl} · ${order.time || "--:--"}\n` +
                `• Tim      : ${team || order.teknisi}\n` +
                `• Lokasi   : ${order.address || "-"}\n\n` +
                `🔗 Pantau status tim secara langsung:\n${link}\n\n` +
                `Link aktif 30 hari sejak Pemesanan Anda. Detail Service, Pembayaran, Complain dan History Pengerjaan Di Lokasi. Jika Ada Pertanyaan? Balas pesan ini.\n— ${appName} Service`;
            await sendWA(order.phone, portalMsg);
            // Tandai portal WA sudah dikirim agar cron morning-dispatch tidak kirim dobel
            await supabase.from("orders").update({ portal_wa_sent_at: new Date().toISOString() }).eq("id", order.id);
            const logLabel = is_maintenance ? "MAINTENANCE_PORTAL_LINK_SENT" : "PORTAL_LINK_SENT";
            addAgentLog(logLabel, `Link portal ${is_maintenance ? "B2B permanen" : "customer"} terkirim ke ${order.customer} (${order.phone})`, "SUCCESS");
          }
        } catch (e) { /* portal link opsional — tidak blok dispatch */ }
      }
    } else {
      showNotif("📱 WA dibuka manual di browser");
    }
}
