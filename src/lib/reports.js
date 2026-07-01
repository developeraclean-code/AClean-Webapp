// Export rekap harian ke CSV — diekstrak dari App.jsx (Fase 2).
// Deps di-thread lewat objek `deps` supaya lepas dari closure App.jsx. Ada
// side-effect (buat file + download + log + notif) → bukan fungsi murni, tapi
// self-contained utility. Body dipindah verbatim (whitespace CSV terjaga, mis. BOM).
export function downloadRekapHarian(targetDate, { TODAY, ordersData, invoicesData, currentUser, showNotif, addAgentLog }) {
    const tgl = targetDate || TODAY;
    const fmt2 = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
    const tglLabel = new Date(tgl + "T00:00:00").toLocaleDateString("id-ID",
      { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    // ── Sheet 1: Rekap Pekerjaan ──
    const ordersHariIni = ordersData.filter(o => o.date === tgl);
    const orderHeaders = ["No", "Job ID", "Customer", "No HP", "Layanan", "Unit", "Teknisi", "Helper",
      "Status", "Jam", "Alamat", "Catatan"];
    const orderRows = ordersHariIni.map((o, i) => [
      i + 1,
      o.id || "-",
      `"${(o.customer || "").replace(/"/g, '""')}"`,
      o.phone || "-",
      o.service || "-",
      o.units || 1,
      o.teknisi || "-",
      o.helper || "-",
      o.status || "-",
      o.time || "-",
      `"${(o.address || "").replace(/"/g, '""')}"`,
      `"${(o.notes || "").replace(/"/g, '""')}"`,
    ]);

    // ── Sheet 2: Rekap Invoice ──
    const invoicesHariIni = invoicesData.filter(i =>
      (i.created_at || "").slice(0, 10) === tgl || (i.paid_at || "").slice(0, 10) === tgl
    );
    const invHeaders = ["No", "Invoice ID", "Customer", "No HP", "Layanan", "Total", "Status",
      "Teknisi", "Tgl Dibuat", "Tgl Bayar", "Metode Bayar"];
    const invRows = invoicesHariIni.map((inv, i) => [
      i + 1,
      inv.id || "-",
      `"${(inv.customer || "").replace(/"/g, '""')}"`,
      inv.phone || "-",
      `"${(inv.service || "").replace(/"/g, '""')}"`,
      inv.total || 0,
      inv.status || "-",
      inv.teknisi || "-",
      inv.created_at ? new Date(inv.created_at).toLocaleDateString("id-ID") : "-",
      inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("id-ID") : "-",
      inv.paid_method || "-",
    ]);

    // ── Hitung summary ──
    const totalOrder = ordersHariIni.length;
    const totalSelesai = ordersHariIni.filter(o => ["COMPLETED", "REPORT_SUBMITTED", "VERIFIED"].includes(o.status)).length;
    const totalOmset = invoicesHariIni.filter(i => i.status === "PAID").reduce((s, i) => s + (i.total || 0), 0);
    const totalInvBaru = invoicesHariIni.filter(i => i.created_at?.slice(0, 10) === tgl).length;

    // ── Build CSV ──
    const bom = "﻿";
    const sep = "\n";
    const rows = [];

    // Header dokumen
    rows.push(`"REKAP HARIAN ACLEAN SERVICE AC"`);
    rows.push(`"Tanggal: ${tglLabel}"`);
    rows.push(`"Digenerate: ${new Date().toLocaleString("id-ID")}"`);
    rows.push("");

    // Summary
    rows.push(`"=== RINGKASAN ==="`);
    rows.push(`"Total Order Hari Ini","${totalOrder}"`);
    rows.push(`"Order Selesai","${totalSelesai}"`);
    rows.push(`"Invoice Dibuat Hari Ini","${totalInvBaru}"`);
    rows.push(`"Total Omset Terbayar","${fmt2(totalOmset)}"`);
    rows.push("");

    // Rekap pekerjaan
    rows.push(`"=== REKAP PEKERJAAN (${ordersHariIni.length} order) ==="`);
    rows.push(orderHeaders.join(","));
    orderRows.forEach(r => rows.push(r.join(",")));
    rows.push("");

    // Rekap invoice
    rows.push(`"=== REKAP INVOICE (${invoicesHariIni.length} invoice) ==="`);
    rows.push(invHeaders.join(","));
    invRows.forEach(r => rows.push(r.join(",")));
    rows.push("");

    // Per teknisi
    const perTek = {};
    ordersHariIni.forEach(o => {
      if (o.teknisi) {
        if (!perTek[o.teknisi]) perTek[o.teknisi] = { order: 0, selesai: 0, omset: 0 };
        perTek[o.teknisi].order++;
        if (["COMPLETED", "REPORT_SUBMITTED", "VERIFIED"].includes(o.status))
          perTek[o.teknisi].selesai++;
      }
    });
    invoicesHariIni.filter(i => i.status === "PAID").forEach(i => {
      if (i.teknisi && perTek[i.teknisi])
        perTek[i.teknisi].omset += (i.total || 0);
    });
    if (Object.keys(perTek).length > 0) {
      rows.push(`"=== REKAP PER TEKNISI ==="`);
      rows.push(`"Teknisi","Total Order","Selesai","Omset Terbayar"`);
      Object.entries(perTek).sort((a, b) => b[1].omset - a[1].omset).forEach(([name, d]) => {
        rows.push(`"${name}",${d.order},${d.selesai},"${fmt2(d.omset)}"`);
      });
    }

    const blob = new Blob([bom + rows.join(sep)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Rekap_Harian_AClean_${tgl}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addAgentLog("EXPORT_REKAP", `Rekap harian ${tgl} didownload oleh ${currentUser?.name || "Owner"}`, "SUCCESS");
    showNotif(`✅ Rekap ${tglLabel} berhasil didownload!`);
}
