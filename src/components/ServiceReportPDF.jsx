import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

const fmtDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }); }
  catch { return String(d); }
};

const s = StyleSheet.create({
  page:        { padding: "24 28", fontFamily: "Helvetica", fontSize: 9, color: "#1e293b", backgroundColor: "#fff" },
  // Header
  header:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 8, borderBottom: "2px solid #1e3a5f", marginBottom: 10 },
  logoRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  brand:       { fontSize: 14, fontFamily: "Helvetica-Bold", color: "#1e3a5f" },
  brandSub:    { fontSize: 7, color: "#64748b", marginTop: 1 },
  docTitle:    { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#1e3a5f", textAlign: "right" },
  docSub:      { fontSize: 7, color: "#64748b", textAlign: "right", marginTop: 2 },
  // Info cards row
  cardRow:     { flexDirection: "row", gap: 8, marginBottom: 8 },
  card:        { flex: 1, backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 4, padding: "7 9" },
  cardTitle:   { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#1e3a5f", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5, borderBottom: "1px solid #e2e8f0", paddingBottom: 3 },
  infoRow:     { flexDirection: "row", marginBottom: 3 },
  infoLabel:   { fontSize: 8, color: "#64748b", width: 72 },
  infoVal:     { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#1e293b", flex: 1 },
  infoAccent:  { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#1e40af", flex: 1 },
  // Section
  section:     { marginBottom: 8 },
  secTitle:    { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#475569", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4, paddingBottom: 2, borderBottom: "1px solid #e2e8f0" },
  // Table
  thead:       { flexDirection: "row", backgroundColor: "#1e3a5f", borderRadius: "3 3 0 0" },
  theadAlt:    { flexDirection: "row", backgroundColor: "#334155", borderRadius: "3 3 0 0" },
  th:          { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 7, padding: "5 6", textTransform: "uppercase" },
  tr:          { flexDirection: "row", borderBottom: "1px solid #f1f5f9" },
  trEven:      { backgroundColor: "#f8fafc" },
  td:          { fontSize: 8, padding: "5 6", color: "#1e293b" },
  badge:       { backgroundColor: "#eff6ff", color: "#1d4ed8", fontSize: 6.5, padding: "1 4", borderRadius: 99, marginRight: 2, marginBottom: 1 },
  badgeYellow: { backgroundColor: "#fefce8", color: "#854d0e", fontSize: 6.5, padding: "1 4", borderRadius: 99, marginRight: 2, marginBottom: 1 },
  badgeGreen:  { backgroundColor: "#f0fdf4", color: "#166534", fontSize: 6.5, padding: "1 4", borderRadius: 99, marginRight: 2, marginBottom: 1 },
  // Bottom row: catatan + tanda tangan
  bottomRow:   { flexDirection: "row", gap: 8, marginBottom: 8 },
  catatanBox:  { backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 4, padding: "6 8", fontSize: 8, color: "#334155", minHeight: 30, flex: 1 },
  sigBox:      { flex: 1, border: "1px solid #cbd5e1", borderRadius: 4, padding: "6 8" },
  sigLabel:    { fontSize: 7, color: "#64748b", marginBottom: 18 },
  sigName:     { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#1e293b", paddingTop: 4, borderTop: "1px solid #cbd5e1" },
  sigDate:     { fontSize: 7, color: "#64748b", marginTop: 1 },
  // Footer
  footer:      { paddingTop: 5, borderTop: "1px solid #e2e8f0", flexDirection: "row", justifyContent: "space-between" },
  footerL:     { fontSize: 7, color: "#94a3b8" },
  footerR:     { fontSize: 6.5, color: "#cbd5e1", fontStyle: "italic" },
  // Photo page
  photoHeader: { backgroundColor: "#1e3a5f", padding: "6 10", marginBottom: 8, borderRadius: 3 },
  photoTitle:  { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#fff" },
  photoSub:    { fontSize: 7, color: "#93c5fd", marginTop: 1 },
  photoGrid:   { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photoCell:   { width: "23%", border: "1px solid #e2e8f0", borderRadius: 3, overflow: "hidden", position: "relative" },
  photoImg:    { width: "100%", height: 85, objectFit: "cover" },
  photoNum:    { fontSize: 6, color: "#94a3b8", textAlign: "right", marginTop: 2, paddingRight: 3 },
});

function InfoRow({ label, value, accent }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={accent ? s.infoAccent : s.infoVal}>{value || "—"}</Text>
    </View>
  );
}

function BadgeList({ items, style }) {
  if (!items || items.length === 0) return <Text style={[s.td, { color: "#94a3b8" }]}>—</Text>;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", padding: "4 5" }}>
      {items.map((item, i) => <Text key={i} style={style}>{item}</Text>)}
    </View>
  );
}

function UnitTable({ units }) {
  if (!units || units.length === 0) return null;
  return (
    <View style={s.section}>
      <Text style={s.secTitle}>Detail Unit AC</Text>
      <View style={s.thead}>
        <Text style={[s.th, { width: 18, textAlign: "center" }]}>No</Text>
        <Text style={[s.th, { flex: 1.2 }]}>Tipe / Merk</Text>
        <Text style={[s.th, { flex: 1 }]}>Kondisi Sebelum</Text>
        <Text style={[s.th, { flex: 1 }]}>Pekerjaan</Text>
        <Text style={[s.th, { flex: 1 }]}>Kondisi Sesudah</Text>
        <Text style={[s.th, { width: 46 }]}>Freon/A</Text>
      </View>
      {units.map((u, i) => (
        <View key={i}>
          <View style={[s.tr, i % 2 === 1 ? s.trEven : {}]}>
            <Text style={[s.td, { width: 18, textAlign: "center", fontFamily: "Helvetica-Bold" }]}>{u.unit_no || i + 1}</Text>
            <View style={{ flex: 1.2, padding: "4 5" }}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 8 }}>{u.tipe || "—"}</Text>
              {u.merk ? <Text style={{ color: "#64748b", fontSize: 7 }}>{u.merk}{u.model ? " · " + u.model : ""}</Text> : null}
            </View>
            <BadgeList items={u.kondisi_sebelum} style={s.badgeYellow} />
            <BadgeList items={u.pekerjaan} style={s.badge} />
            <BadgeList items={u.kondisi_setelah} style={s.badgeGreen} />
            <View style={{ width: 46, padding: "4 5" }}>
              {parseFloat(u.freon_ditambah) > 0 ? <Text style={{ fontSize: 7.5 }}>{u.freon_ditambah} psi</Text> : null}
              {u.ampere_akhir ? <Text style={{ fontSize: 7.5 }}>{u.ampere_akhir} A</Text> : null}
              {!parseFloat(u.freon_ditambah) && !u.ampere_akhir ? <Text style={{ fontSize: 7.5, color: "#94a3b8" }}>—</Text> : null}
            </View>
          </View>
          {u.catatan_unit ? (
            <View style={[s.tr, { backgroundColor: "#fffbeb" }]}>
              <Text style={{ width: 18 }} />
              <Text style={[s.td, { flex: 1, color: "#64748b", fontStyle: "italic", fontSize: 7.5 }]}>📝 {u.catatan_unit}</Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function MatTable({ items, title }) {
  if (!items || items.length === 0) return null;
  return (
    <View style={s.section}>
      <Text style={s.secTitle}>{title}</Text>
      <View style={s.theadAlt}>
        <Text style={[s.th, { flex: 2 }]}>Nama</Text>
        <Text style={[s.th, { width: 48, textAlign: "right" }]}>Jumlah</Text>
        <Text style={[s.th, { width: 48 }]}>Satuan</Text>
      </View>
      {items.map((m, i) => (
        <View key={i} style={[s.tr, i % 2 === 1 ? s.trEven : {}]}>
          <Text style={[s.td, { flex: 2 }]}>{m.nama || "—"}</Text>
          <Text style={[s.td, { width: 48, textAlign: "right" }]}>{m.jumlah || "—"}</Text>
          <Text style={[s.td, { width: 48 }]}>{m.satuan || "pcs"}</Text>
        </View>
      ))}
    </View>
  );
}

function PhotoPage({ photos, pageNum, jobId, customer }) {
  return (
    <Page size="A4" style={s.page}>
      <View style={s.photoHeader}>
        <Text style={s.photoTitle}>Dokumentasi Foto — Halaman {pageNum}</Text>
        <Text style={s.photoSub}>{jobId} · {customer}</Text>
      </View>
      <View style={s.photoGrid}>
        {photos.map((dataUrl, i) => (
          <View key={i} style={s.photoCell}>
            {dataUrl
              ? <Image src={dataUrl} style={s.photoImg} />
              : <View style={[s.photoImg, { backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" }]}>
                  <Text style={{ color: "#94a3b8", fontSize: 7 }}>Tidak tersedia</Text>
                </View>
            }
            <Text style={s.photoNum}>{(pageNum - 2) * 8 + i + 1}</Text>
          </View>
        ))}
      </View>
    </Page>
  );
}

export default function ServiceReportPDF({ laporan, inv, logoUrl, photoDataUrls = {}, appSettings = {}, ord = {} }) {
  const units     = laporan.units || [];
  const materials = (laporan.materials || []).filter(m => m.nama && m.keterangan !== "jasa");
  const jasaItems = (laporan.materials || []).filter(m => m.keterangan === "jasa");
  const fotos     = (laporan.foto_urls || []).filter(Boolean);
  const printDate = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  const svcDate   = laporan.date || (laporan.submitted_at || "").slice(0, 10);
  const teknisiLine = [laporan.teknisi, laporan.helper, laporan.teknisi2].filter(Boolean).join(" · ") || "—";

  const photoChunks = [];
  for (let i = 0; i < fotos.length; i += 8) photoChunks.push(fotos.slice(i, i + 8));

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── Header ── */}
        <View style={s.header}>
          <View style={s.logoRow}>
            {logoUrl ? <Image src={logoUrl} style={{ width: 44, height: 44, objectFit: "contain" }} /> : null}
            <View>
              <Text style={s.brand}>AClean Service</Text>
              <Text style={s.brandSub}>Jasa Servis & Perawatan AC Profesional</Text>
            </View>
          </View>
          <View>
            <Text style={s.docTitle}>SERVICE REPORT CARD</Text>
            <Text style={s.docSub}>Dicetak: {printDate}</Text>
            <Text style={[s.docSub, { fontFamily: "Helvetica-Bold", color: "#1e3a5f" }]}>{laporan.job_id}</Text>
          </View>
        </View>

        {/* ── Info Cards (2 kolom) ── */}
        <View style={s.cardRow}>
          <View style={s.card}>
            <Text style={s.cardTitle}>Informasi Pekerjaan</Text>
            <InfoRow label="Job ID"       value={laporan.job_id} accent />
            <InfoRow label="Tgl Service"  value={svcDate} />
            <InfoRow label="Jenis Layanan" value={laporan.service} />
            <InfoRow label="Jumlah Unit"  value={String(laporan.total_units || units.length || "—")} />
            <InfoRow label="Teknisi"      value={teknisiLine} />
            <InfoRow label="Status"       value={laporan.status} />
          </View>
          <View style={s.card}>
            <Text style={s.cardTitle}>Informasi Customer</Text>
            <InfoRow label="Nama"   value={laporan.customer} />
            <InfoRow label="No. HP" value={laporan.phone || ord.phone} />
            {ord.address ? <InfoRow label="Alamat" value={(ord.address || "") + (ord.area ? ", " + ord.area : "")} /> : null}
          </View>
        </View>

        {/* ── Unit Table ── */}
        <UnitTable units={units} />

        {/* ── Material & Jasa (side by side kalau keduanya ada) ── */}
        {materials.length > 0 && jasaItems.length > 0 ? (
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
            <View style={{ flex: 1 }}><MatTable items={materials} title="Material Terpakai" /></View>
            <View style={{ flex: 1 }}><MatTable items={jasaItems} title="Jasa Dilakukan" /></View>
          </View>
        ) : (
          <>
            <MatTable items={materials} title="Material Terpakai" />
            <MatTable items={jasaItems} title="Jasa / Layanan Dilakukan" />
          </>
        )}

        {/* ── Catatan & Rekomendasi ── */}
        <View style={[s.section]}>
          <Text style={s.secTitle}>Catatan & Rekomendasi</Text>
          <View style={s.bottomRow}>
            <View style={{ flex: 1 }}>
              <Text style={[s.secTitle, { marginBottom: 3, border: "none" }]}>Catatan Teknisi</Text>
              <View style={s.catatanBox}><Text>{laporan.catatan || "—"}</Text></View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.secTitle, { marginBottom: 3 }]}>Rekomendasi</Text>
              <View style={s.catatanBox}><Text>{laporan.rekomendasi || "—"}</Text></View>
            </View>
          </View>
        </View>

        {/* ── Tanda Tangan ── */}
        <View style={s.section}>
          <Text style={s.secTitle}>Persetujuan</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={s.sigBox}>
              <Text style={s.sigLabel}>Tanda Tangan Customer</Text>
              <Text style={s.sigName}>{laporan.customer || "—"}</Text>
              <Text style={s.sigDate}>Tanggal: {svcDate}</Text>
            </View>
            <View style={s.sigBox}>
              <Text style={s.sigLabel}>Tanda Tangan Teknisi</Text>
              <Text style={s.sigName}>{laporan.teknisi || "—"}</Text>
              <Text style={s.sigDate}>Tanggal: {svcDate}</Text>
            </View>
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={s.footer}>
          <Text style={s.footerL}>{appSettings.company_name || "AClean Service"} · {appSettings.company_addr || ""}</Text>
          <Text style={s.footerR}>Dokumen dicetak otomatis oleh sistem AClean</Text>
        </View>

      </Page>

      {/* ── Photo Pages ── */}
      {photoChunks.map((chunk, pi) => (
        <PhotoPage
          key={pi}
          photos={chunk.map(url => photoDataUrls[url] || null)}
          pageNum={pi + 2}
          jobId={laporan.job_id}
          customer={laporan.customer}
        />
      ))}
    </Document>
  );
}
