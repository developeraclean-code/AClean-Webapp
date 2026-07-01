// Builder HTML Service Report Card — untuk cetak/preview PDF & lampiran WA.
// Diekstrak dari App.jsx (Fase 2). Fungsi MURNI: semua data lewat argumen.
// `appSettings` & `ordersData` ditambahkan sebagai parameter (dulu closure App.jsx).
// Indentasi body sengaja dipertahankan apa adanya supaya whitespace di dalam
// template literal (yang ikut ke output HTML) tidak berubah.
export function buildServiceReportHTML(laporan, inv, logoUrl, origin, photoDataUrls = {}, forWA = false, appSettings = {}, ordersData = []) {
    const escH = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ord = ordersData.find(o => o.id === laporan.job_id) || {};
    const units = laporan.units || [];
    const materials = (laporan.materials || []).filter(m => m.nama && m.keterangan !== "jasa");
    const jasaItems = (laporan.materials || []).filter(m => m.keterangan === "jasa");
    const fotos = (laporan.foto_urls || []).filter(Boolean);
    const printDate = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    const svcDate = laporan.date || (laporan.submitted_at || "").slice(0, 10);

    // ── Photo pages ──
    // Jika foto sudah di-tag per unit (laporan.fotos[].unit_no) → kelompokkan per unit.
    // Kalau tidak (laporan lama) → galeri datar seperti sebelumnya.
    const fotoMeta = Array.isArray(laporan.fotos) ? laporan.fotos.filter(m => m && m.url) : [];
    const hasUnitTags = fotoMeta.some(m => m.unit_no);

    const cellHTML = (url, label) => {
      const dataUrl = photoDataUrls[url] || "";
      const cap = label ? `<div class="photo-num" style="position:static;display:block;text-align:center;margin-top:2px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escH(label)}</div>` : "";
      return dataUrl
        ? `<div class="photo-cell"><img src="${dataUrl}" alt="${escH(label || "Foto")}" />${cap}</div>`
        : `<div class="photo-cell" style="background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px">Foto tidak tersedia</div>`;
    };
    const pageHTML = (title, items) => {
      const pages = [];
      for (let i = 0; i < items.length; i += 6) pages.push(items.slice(i, i + 6));
      return pages.map((chunk, pi) => `
        <div class="photo-page" style="page-break-before:always">
          <div class="photo-page-header">
            <div class="photo-page-title">${escH(title)}${pages.length > 1 ? ` (${pi + 1}/${pages.length})` : ""}</div>
            <div class="photo-page-sub">${escH(laporan.job_id)} · ${escH(laporan.customer)}</div>
          </div>
          <div class="photo-grid">
            ${chunk.map(it => cellHTML(it.url, it.label)).join("")}
          </div>
        </div>`).join("");
    };

    let photoPageHTML;
    if (hasUnitTags) {
      const unitLabel = (no) => {
        const un = units.find(u => Number(u.unit_no) === Number(no));
        return un ? `FOTO UNIT ${no}${un.tipe ? " — " + un.tipe : ""}${un.label ? " (" + un.label + ")" : ""}` : `FOTO UNIT ${no}`;
      };
      const byUnit = {};
      fotoMeta.forEach(m => { const k = m.unit_no ? String(m.unit_no) : "_umum"; (byUnit[k] = byUnit[k] || []).push({ url: m.url, label: m.label }); });
      // Foto flat yg tak ada di meta (safety) → grup umum
      const tagged = new Set(fotoMeta.map(m => m.url));
      fotos.forEach(url => { if (!tagged.has(url)) (byUnit["_umum"] = byUnit["_umum"] || []).push({ url, label: "" }); });
      const unitKeys = Object.keys(byUnit).filter(k => k !== "_umum").sort((a, b) => Number(a) - Number(b));
      photoPageHTML = [
        ...unitKeys.map(k => pageHTML(unitLabel(k), byUnit[k])),
        ...(byUnit["_umum"] ? [pageHTML("DOKUMENTASI FOTO — UMUM", byUnit["_umum"])] : []),
      ].join("");
    } else {
      photoPageHTML = pageHTML("DOKUMENTASI FOTO", fotos.map((url, i) => ({ url, label: "" })));
    }

    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Service Report Card — ${escH(laporan.job_id)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1e293b; background: #fff; }
  @page { size: A4; margin: 10mm 12mm; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }

  /* ── HEADER ── */
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 10px; border-bottom: 2.5px solid #1e3a5f; margin-bottom: 12px; }
  .header-left { display: flex; align-items: center; gap: 10px; }
  .logo-wrap { background: #fff; display: flex; align-items: center; justify-content: center; height: 70px; }
  .logo-wrap img { height: 66px; max-width: 200px; width: auto; object-fit: contain; }
  .brand-text { font-size: 18px; font-weight: 800; color: #1e3a5f; letter-spacing: -0.5px; }
  .brand-sub { font-size: 9px; color: #64748b; margin-top: 2px; }
  .header-right { text-align: right; }
  .doc-title { font-size: 16px; font-weight: 800; color: #1e3a5f; letter-spacing: 0.5px; }
  .doc-sub { font-size: 9px; color: #64748b; margin-top: 2px; }

  /* ── INFO GRID ── */
  .section { margin-bottom: 10px; }
  .section-title { font-size: 9px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; padding-bottom: 3px; border-bottom: 1px solid #e2e8f0; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; }
  .info-row { display: flex; gap: 4px; }
  .info-label { color: #64748b; min-width: 85px; font-size: 10px; }
  .info-val { color: #1e293b; font-weight: 600; font-size: 10px; }
  .info-val.accent { color: #1e40af; }
  .info-val.full { grid-column: span 2; }

  /* ── UNIT TABLE ── */
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { background: #1e3a5f; color: #fff; font-size: 9px; font-weight: 700; padding: 5px 6px; text-align: left; }
  td { font-size: 9.5px; padding: 5px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; color: #1e293b; }
  tr:nth-child(even) td { background: #f8fafc; }
  .badge { display: inline-block; background: #eff6ff; color: #1d4ed8; font-size: 8px; padding: 1px 5px; border-radius: 99px; margin: 1px 1px 1px 0; }
  .badge.yellow { background: #fefce8; color: #854d0e; }
  .badge.green { background: #f0fdf4; color: #166534; }

  /* ── MATERIALS ── */
  .mat-table th { background: #334155; }
  .mat-row { display: grid; grid-template-columns: 2fr 1fr 1fr; }

  /* ── CATATAN ── */
  .catatan-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; font-size: 10px; color: #334155; min-height: 28px; }

  /* ── SIGNATURE ── */
  .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 8px; }
  .sig-box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
  .sig-label { font-size: 9px; color: #64748b; margin-bottom: 32px; }
  .sig-name { font-size: 10px; font-weight: 700; color: #1e293b; margin-top: 6px; padding-top: 6px; border-top: 1px solid #cbd5e1; }
  .sig-date { font-size: 9px; color: #64748b; }

  /* ── FOOTER ── */
  .footer { margin-top: 10px; padding-top: 6px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
  .footer-left { font-size: 8.5px; color: #94a3b8; }
  .footer-right { font-size: 8px; color: #cbd5e1; font-style: italic; }

  /* ── PHOTO PAGE ── */
  .photo-page { padding: 0; }
  .photo-page-header { background: #1e3a5f; color: #fff; padding: 8px 12px; margin-bottom: 10px; border-radius: 4px; }
  .photo-page-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; }
  .photo-page-sub { font-size: 9px; color: #93c5fd; margin-top: 2px; }
  .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .photo-cell { border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; position: relative; background: #f8fafc; aspect-ratio: 3/4; }
  .photo-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .photo-num { position: absolute; bottom: 3px; right: 5px; background: rgba(0,0,0,0.55); color: #fff; font-size: 8px; font-weight: 700; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
${forWA ? "" : "<script>window.onload = () => { window.print(); }</script>"}

<!-- ═══════ HALAMAN 1 — DATA PEKERJAAN ═══════ -->
<div class="header">
  <div class="header-left">
    ${logoUrl
      ? `<div class="logo-wrap"><img src="${logoUrl}" alt="${appSettings.app_name || "AClean"}"/></div>`
      : `<div style="font-size:22px;font-weight:900;color:#1e3a5f;line-height:1">AC<span style="color:#3b82f6">lean</span><div style="font-size:9px;font-weight:400;color:#64748b;margin-top:2px">We clean with heart</div></div>`}
  </div>
  <div class="header-right">
    <div class="doc-title">SERVICE REPORT CARD</div>
    <div class="doc-sub">Dicetak: ${printDate}</div>
    <div class="doc-sub" style="margin-top:2px;font-weight:700;color:#1e3a5f">${escH(laporan.job_id)}</div>
  </div>
</div>

<!-- INFO PEKERJAAN -->
<div class="section">
  <div class="section-title">Informasi Pekerjaan</div>
  <div class="info-grid">
    <div class="info-row"><span class="info-label">Job ID</span><span class="info-val accent">${escH(laporan.job_id)}</span></div>
    <div class="info-row"><span class="info-label">Tanggal Service</span><span class="info-val">${escH(svcDate)}</span></div>
    <div class="info-row"><span class="info-label">Jenis Layanan</span><span class="info-val">${escH(laporan.service)}</span></div>
    <div class="info-row"><span class="info-label">Jumlah Unit</span><span class="info-val">${escH(laporan.total_units || units.length || "-")}</span></div>
    <div class="info-row"><span class="info-label">Teknisi</span><span class="info-val">${escH(laporan.teknisi)}${laporan.helper ? " · " + escH(laporan.helper) : ""}${laporan.teknisi2 ? " · " + escH(laporan.teknisi2) : ""}</span></div>
    <div class="info-row"><span class="info-label">Status</span><span class="info-val">${escH(laporan.status)}</span></div>
  </div>
</div>

<!-- INFO CUSTOMER -->
<div class="section">
  <div class="section-title">Informasi Customer</div>
  <div class="info-grid">
    <div class="info-row"><span class="info-label">Nama</span><span class="info-val">${escH(laporan.customer)}</span></div>
    <div class="info-row"><span class="info-label">No. HP</span><span class="info-val">${escH(laporan.phone || ord.phone || "-")}</span></div>
    ${ord.address ? `<div class="info-row" style="grid-column:span 2"><span class="info-label">Alamat</span><span class="info-val">${escH(ord.address)}${ord.area ? ", " + escH(ord.area) : ""}</span></div>` : ""}
  </div>
</div>

<!-- DETAIL UNIT -->
${units.length > 0 ? `
<div class="section">
  <div class="section-title">Detail Unit AC</div>
  <table>
    <thead>
      <tr>
        <th style="width:24px">No</th>
        <th>Tipe / Merk</th>
        <th>Kondisi Sebelum</th>
        <th>Pekerjaan Dilakukan</th>
        <th>Kondisi Sesudah</th>
        <th style="width:52px">Freon / Ampere</th>
      </tr>
    </thead>
    <tbody>
      ${units.map((u, ui) => `
        <tr>
          <td style="text-align:center;font-weight:700">${u.unit_no || ui + 1}</td>
          <td>
            <div style="font-weight:700">${escH(u.tipe || "-")}</div>
            ${u.merk ? `<div style="color:#64748b;font-size:8.5px">${escH(u.merk)}${u.model ? " · " + escH(u.model) : ""}</div>` : ""}
          </td>
          <td>${(u.kondisi_sebelum || []).map(k => `<span class="badge yellow">${escH(k)}</span>`).join("") || "-"}</td>
          <td>${(u.pekerjaan || []).map(p => `<span class="badge">${escH(p)}</span>`).join("") || "-"}</td>
          <td>${(u.kondisi_setelah || []).map(k => `<span class="badge green">${escH(k)}</span>`).join("") || "-"}</td>
          <td style="font-size:8.5px">
            ${parseFloat(u.freon_ditambah) > 0 ? `<div>${u.freon_ditambah} psi</div>` : ""}
            ${u.ampere_akhir ? `<div>${u.ampere_akhir} A</div>` : ""}
            ${!parseFloat(u.freon_ditambah) && !u.ampere_akhir ? "—" : ""}
          </td>
        </tr>
        ${u.catatan_unit ? `<tr><td></td><td colspan="5" style="color:#64748b;font-size:8.5px;font-style:italic">📝 ${escH(u.catatan_unit)}</td></tr>` : ""}
      `).join("")}
    </tbody>
  </table>
</div>
` : ""}

<!-- MATERIAL TERPAKAI -->
${materials.length > 0 ? `
<div class="section">
  <div class="section-title">Material Terpakai</div>
  <table class="mat-table">
    <thead><tr><th>Nama Material</th><th>Jumlah</th><th>Satuan</th></tr></thead>
    <tbody>
      ${materials.map(m => `<tr><td>${escH(m.nama)}</td><td>${escH(m.jumlah)}</td><td>${escH(m.satuan || "pcs")}</td></tr>`).join("")}
    </tbody>
  </table>
</div>
` : ""}

<!-- JASA DILAKUKAN -->
${jasaItems.length > 0 ? `
<div class="section">
  <div class="section-title">Jasa / Layanan Dilakukan</div>
  <table class="mat-table">
    <thead><tr><th>Jasa</th><th>Jumlah</th><th>Satuan</th></tr></thead>
    <tbody>
      ${jasaItems.map(j => `<tr><td>${escH(j.nama)}</td><td>${escH(j.jumlah)}</td><td>${escH(j.satuan || "unit")}</td></tr>`).join("")}
    </tbody>
  </table>
</div>
` : ""}

<!-- CATATAN & REKOMENDASI / SURVEY -->
${laporan.service === "Survey" ? `
<div class="section">
  <div class="section-title">Laporan Hasil Survey</div>
  <div style="margin-bottom:8px">
    <div style="font-size:9px;color:#64748b;margin-bottom:3px;font-weight:700">Hasil Survey</div>
    <div class="catatan-box" style="min-height:60px;white-space:pre-wrap">${escH(laporan.hasil_survey || "—")}</div>
  </div>
  ${laporan.catatan_rekomendasi ? `
  <div>
    <div style="font-size:9px;color:#64748b;margin-bottom:3px;font-weight:700">Rekomendasi</div>
    <div class="catatan-box" style="min-height:40px;white-space:pre-wrap">${escH(laporan.catatan_rekomendasi)}</div>
  </div>` : ""}
</div>
` : `
<div class="section">
  <div class="section-title">Catatan & Rekomendasi</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <div>
      <div style="font-size:9px;color:#64748b;margin-bottom:3px">Catatan Teknisi</div>
      <div class="catatan-box">${escH(laporan.catatan_global || laporan.catatan || "—")}</div>
    </div>
    <div>
      <div style="font-size:9px;color:#64748b;margin-bottom:3px">Rekomendasi</div>
      <div class="catatan-box">${escH(laporan.rekomendasi || "—")}</div>
    </div>
  </div>
</div>
`}

<!-- TANDA TANGAN -->
<div class="section">
  <div class="section-title">Persetujuan</div>
  <div class="sig-row">
    <div class="sig-box">
      <div class="sig-label">Tanda Tangan Customer</div>
      <div class="sig-name">${escH(laporan.customer)}</div>
      <div class="sig-date">Tanggal: ${escH(svcDate)}</div>
    </div>
    <div class="sig-box">
      <div class="sig-label">Tanda Tangan Teknisi</div>
      <div class="sig-name">${escH(laporan.teknisi)}</div>
      <div class="sig-date">Tanggal: ${escH(svcDate)}</div>
    </div>
  </div>
</div>

<!-- FOOTER -->
<div class="footer">
  <div class="footer-left">${appSettings.company_name || "AClean Service"} · ${appSettings.company_addr || "Jasa Servis AC Profesional"}</div>
  <div class="footer-right">Dokumen ini dicetak otomatis oleh sistem ${appSettings.app_name || "AClean"}</div>
</div>

<!-- ═══════ HALAMAN FOTO ═══════ -->
${photoPageHTML}

</body>
</html>`;
}
