// api/cron/cleanup-fotos.js
// Jalan setiap tanggal 1, jam 02:00 WIB (19:00 UTC bulan sebelumnya)
// Hapus foto laporan yang sudah lebih dari 12 bulan dari Supabase Storage
// Laporan & data tetap ada — hanya file foto yang dihapus untuk hemat storage

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const startTime = Date.now();

  try {
    // Ambil setting retention period (default 12 bulan, bisa diubah di system_settings)
    const { data: setting } = await sb
      .from("system_settings")
      .select("value")
      .eq("key", "foto_retention_months")
      .single();

    const retentionMonths = parseInt(setting?.value || "12");
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);
    const cutoffISO = cutoffDate.toISOString().slice(0, 10);

    console.log(`🗑️  Cleanup fotos sebelum: ${cutoffISO} (retention: ${retentionMonths} bulan)`);

    // ── Cari laporan yang lebih tua dari cutoff ──
    const { data: oldReports, error: reportErr } = await sb
      .from("service_reports")
      .select("id, date, foto_urls, customer, teknisi")
      .lt("date", cutoffISO)
      .not("foto_urls", "eq", "{}");

    if (reportErr) throw reportErr;
    if (!oldReports || oldReports.length === 0) {
      return res.json({
        success: true,
        message: `Tidak ada foto yang perlu dihapus (belum ada laporan lebih dari ${retentionMonths} bulan)`,
        deleted: 0,
      });
    }

    let totalDeleted  = 0;
    let totalFailures = 0;
    let storageSavedKB = 0;
    const deletedReports = [];

    for (const report of oldReports) {
      if (!report.foto_urls || report.foto_urls.length === 0) continue;

      // ── Hapus dari Supabase Storage ──
      // Rekonstruksi path dari URL: reports/{reportId}/{filename}
      const pathsToDelete = [];
      for (const url of report.foto_urls) {
        if (!url) continue;
        try {
          // Extract storage path dari public URL
          // Format: https://xxx.supabase.co/storage/v1/object/public/laporan-fotos/reports/LPR_xxx/123.jpg
          const match = url.match(/laporan-fotos\/(.+)$/);
          if (match) {
            pathsToDelete.push(match[1]);
          } else {
            // Fallback: coba hapus via path langsung reports/{id}/
            pathsToDelete.push(`reports/${report.id}`);
          }
        } catch (_) {}
      }

      if (pathsToDelete.length > 0) {
        const { data: delData, error: delErr } = await sb.storage
          .from("laporan-fotos")
          .remove(pathsToDelete);

        if (delErr) {
          console.warn(`⚠️  Gagal hapus foto report ${report.id}:`, delErr.message);
          totalFailures++;
        } else {
          totalDeleted += pathsToDelete.length;
          storageSavedKB += pathsToDelete.length * 80; // estimasi 80KB/foto
          deletedReports.push(report.id);

          // Update service_reports — kosongkan foto_urls (data laporan tetap ada)
          await sb
            .from("service_reports")
            .update({ foto_urls: [], edited_at: new Date().toISOString() })
            .eq("id", report.id);
        }
      }
    }

    // ── Cek sisa kapasitas storage ──
    const { data: allFiles } = await sb.storage.from("laporan-fotos").list("reports", {
      limit: 1000,
      offset: 0,
    });
    const remainingFiles = allFiles?.length || 0;

    // ── Log ke agent_logs ──
    const now = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    const logDetail = `Cleanup foto: ${totalDeleted} file dihapus dari ${deletedReports.length} laporan (>12 bulan). Hemat ~${(storageSavedKB/1024).toFixed(1)}MB. ${totalFailures} gagal.`;

    await sb.from("agent_logs").insert({
      time:   now,
      action: "FOTO_CLEANUP",
      detail: logDetail,
      status: totalFailures === 0 ? "SUCCESS" : "WARNING",
    });

    // ── Notif ke Owner jika ada yang dihapus ──
    if (totalDeleted > 0 && process.env.FONNTE_TOKEN && process.env.OWNER_PHONE) {
      const msg =
        `🗑️ *Auto-Cleanup Foto AClean*\n\n` +
        `📅 Foto laporan >12 bulan telah dibersihkan\n` +
        `🗂️  Laporan diproses: ${deletedReports.length}\n` +
        `🖼️  Foto dihapus: ${totalDeleted}\n` +
        `💾 Estimasi hemat: ~${(storageSavedKB/1024).toFixed(1)} MB\n` +
        `📋 Data laporan tetap tersimpan lengkap\n\n` +
        `_ARA AClean — Storage Manager_`;

      await fetch("https://api.fonnte.com/send", {
        method:  "POST",
        headers: { "Authorization": process.env.FONNTE_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ target: process.env.OWNER_PHONE, message: msg, countryCode: "62" }),
      });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return res.json({
      success:          true,
      reports_cleaned:  deletedReports.length,
      files_deleted:    totalDeleted,
      failures:         totalFailures,
      storage_saved_mb: (storageSavedKB / 1024).toFixed(1),
      cutoff_date:      cutoffISO,
      retention_months: retentionMonths,
      elapsed_sec:      elapsed,
    });

  } catch (err) {
    console.error("cleanup-fotos error:", err);

    await sb.from("agent_logs").insert({
      time:   new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      action: "FOTO_CLEANUP",
      detail: "ERROR: " + err.message.slice(0, 100),
      status: "ERROR",
    }).catch(() => {});

    return res.status(500).json({ error: err.message });
  }
}
