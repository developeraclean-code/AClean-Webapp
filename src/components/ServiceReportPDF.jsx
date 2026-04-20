import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

const fmtDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }); }
  catch { return d; }
};

const s = StyleSheet.create({
  page:       { padding: "28 32", fontFamily: "Helvetica", fontSize: 9, color: "#1e293b", backgroundColor: "#fff" },
  // Header
  header:     { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 8, borderBottom: "2.5px solid #1e3a5f", marginBottom: 10 },
  brand:      { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#1e3a5f" },
  brandSub:   { fontSize: 7, color: "#64748b", marginTop: 2 },
  docTitle:   { fontSize: 13, fontFamily: "Helvetica-Bold", color: "#1e3a5f", textAlign: "right" },
  docSub:     { fontSize: 7, color: "#64748b", textAlign: "right", marginTop: 2 },
  // Section
  section:    { marginBottom: 8 },
  secTitle:   { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#475569", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4, paddingBottom: 2, borderBottom: "1px solid #e2e8f0" },
  // Info grid 2 col
  infoGrid:   { flexDirection: "row", flexWrap: "wrap" },
  infoRow:    { flexDirection: "row", width: "50%", marginBottom: 3 },
  infoRowFull:{ flexDirection: "row", width: "100%", marginBottom: 3 },
  infoLabel:  { color: "#64748b", width: 75, fontSize: 8.5 },
  infoVal:    { color: "#1e293b", fontFamily: "Helvetica-Bold", fontSize: 8.5, flex: 1 },
  infoAccent: { color: "#1e40af", fontFamily: "Helvetica-Bold", fontSize: 8.5, flex: 1 },
  // Table
  thead:      { flexDirection: "row", backgroundColor: "#1e3a5f" },
  theadMat:   { flexDirection: "row", backgroundColor: "#334155" },
  th:         { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 7.5, padding: "5 5", textTransform: "uppercase" },
  tr:         { flexDirection: "row", borderBottom: "1px solid #f1f5f9" },
  trEven:     { backgroundColor: "#f8fafc" },
  td:         { fontSize: 8.5, padding: "5 5", color: "#1e293b" },
  badge:      { backgroundColor: "#eff6ff", color: "#1d4ed8", fontSize: 7, padding: "1 4", borderRadius: 99, marginRight: 2, marginBottom: 1 },
  badgeYellow:{ backgroundColor: "#fefce8", color: "#854d0e", fontSize: 7, padding: "1 4", borderRadius: 99, marginRight: 2, marginBottom: 1 },
  badgeGreen: { backgroundColor: "#f0fdf4", color: "#166534", fontSize: 7, padding: "1 4", borderRadius: 99, marginRight: 2, marginBottom: 1 },
  // Catatan
  catatanBox: { backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 4, padding: "6 8", fontSize: 8.5, color: "#334155", minHeight: 22 },
  // Signature
  sigRow:     { flexDirection: "row", gap: 16, marginTop: 6 },
  sigBox:     { flex: 1, border: "1px solid #cbd5e1", borderRadius: 4, padding: "6 8" },
  sigLabel:   { fontSize: 7.5, color: "#64748b", marginBottom: 22 },
  sigName:    { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: "#1e293b", marginTop: 4, paddingTop: 4, borderTop: "1px solid #cbd5e1" },
  sigDate:    { fontSize: 7.5, color: "#64748b" },
  // Footer
  footer:     { marginTop: 8, paddingTop: 5, borderTop: "1px solid #e2e8f0", flexDirection: "row", justifyContent: "space-between" },
  footerL:    { fontSize: 7.5, color: "#94a3b8" },
  footerR:    { fontSize: 7, color: "#cbd5e1", fontStyle: "italic" },
  // Photo page
  photoHeader:{ backgroundColor: "#1e3a5f", padding: "6 10", marginBottom: 8, borderRadius: 3 },
  photoTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#fff" },
  photoSub:   { fontSize: 7, color: "#93c5fd", marginTop: 1 },
  photoGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  photoCell:  { width: "23.5%", border: "1px solid #e2e8f0", borderRadius: 3, overflow: "hidden" },
  photoImg:   { width: "100%", height: 90, objectFit: "cover" },
  photoNum:   { position: "absolute", bottom: 2, right: 3, backgroundColor: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 6, padding: "1 3", borderRadius: 3 },
});

// ── Sub-components ──

function InfoRow({ label, value, accent, full }) {
  return (
    <View style={full ? s.infoRowFull : s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={accent ? s.infoAccent : s.infoVal}>{value || "—"}</Text>
    </View>
  );
}

function BadgeList({ items, style }) {
  if (!items || items.length === 0) return <Text style={s.td}>—</Text>;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", padding: "5 5" }}>
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
        <Text style={[s.th, { width: 20, textAlign: "center" }]}>No</Text>
        <Text style={[s.th, { flex: 1.2 }]}>Tipe / Merk</Text>
        <Text style={[s.th, { flex: 1 }]}>Kondisi Sebelum</Text>
        <Text style={[s.th, { flex: 1 }]}>Pekerjaan Dilakukan</Text>
        <Text style={[s.th, { flex: 1 }]}>Kondisi Sesudah</Text>
        <Text style={[s.th, { width: 48 }]}>Freon/Ampere</Text>
      </View>
      {units.map((u, i) => (
        <View key={i}>
          <View style={[s.tr, i % 2 === 1 ? s.trEven : {}]}>
            <Text style={[s.td, { width: 20, textAlign: "center", fontFamily: "Helvetica-Bold" }]}>{u.unit_no || i + 1}</Text>
            <View style={[{ flex: 1.2, padding: "5 5" }]}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 8.5 }}>{u.tipe || "—"}</Text>
              {u.merk ? <Text style={{ color: "#64748b", fontSize: 7.5 }}>{u.merk}{u.model ? " · " + u.model : ""}</Text> : null}
            </View>
            <BadgeList items={u.kondisi_sebelum} style={s.badgeYellow} />
            <BadgeList items={u.pekerjaan} style={s.badge} />
            <BadgeList items={u.kondisi_setelah} style={s.badgeGreen} />
            <View style={{ width: 48, padding: "5 5" }}>
              {parseFloat(u.freon_ditambah) > 0 ? <Text style={{ fontSize: 8 }}>{u.freon_ditambah} psi</Text> : null}
              {u.ampere_akhir ? <Text style={{ fontSize: 8 }}>{u.ampere_akhir} A</Text> : null}
              {!parseFloat(u.freon_ditambah) && !u.ampere_akhir ? <Text style={{ fontSize: 8, color: "#94a3b8" }}>—</Text> : null}
            </View>
          </View>
          {u.catatan_unit ? (
            <View style={[s.tr, { backgroundColor: "#fffbeb" }]}>
              <Text style={{ width: 20 }} />
              <Text style={[s.td, { flex: 1, color: "#64748b", fontStyle: "italic", fontSize: 8 }]}>📝 {u.catatan_unit}</Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function MatTable({ items, title, darkHeader }) {
  if (!items || items.length === 0) return null;
  return (
    <View style={s.section}>
      <Text style={s.secTitle}>{title}</Text>
      <View style={darkHeader ? s.theadMat : s.thead}>
        <Text style={[s.th, { flex: 2 }]}>Nama</Text>
        <Text style={[s.th, { width: 50, textAlign: "right" }]}>Jumlah</Text>
        <Text style={[s.th, { width: 50 }]}>Satuan</Text>
      </View>
      {items.map((m, i) => (
        <View key={i} style={[s.tr, i % 2 === 1 ? s.trEven : {}]}>
          <Text style={[s.td, { flex: 2 }]}>{m.nama || "—"}</Text>
          <Text style={[s.td, { width: 50, textAlign: "right" }]}>{m.jumlah || "—"}</Text>
          <Text style={[s.td, { width: 50 }]}>{m.satuan || "pcs"}</Text>
        </View>
      ))}
    </View>
  );
}

function PhotoPage({ photos, pageNum, jobId, customer }) {
  return (
    <Page size="A4" style={s.page}>
      <View style={s.photoHeader}>
        <Text style={s.photoTitle}>DOKUMENTASI FOTO — Lembar {pageNum}</Text>
        <Text style={s.photoSub}>{jobId} · {customer}</Text>
      </View>
      <View style={s.photoGrid}>
        {photos.map((dataUrl, i) => (
          <View key={i} style={s.photoCell}>
            {dataUrl
              ? <Image src={dataUrl} style={s.photoImg} />
              : <View style={[s.photoImg, { backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center" }]}>
                  <Text style={{ color: "#94a3b8", fontSize: 8 }}>Tidak tersedia</Text>
                </View>
            }
            <Text style={s.photoNum}>{(pageNum - 2) * 8 + i + 1}</Text>
          </View>
        ))}
      </View>
    </Page>
  );
}

// ── Main Component ──
export default function ServiceReportPDF({ laporan, inv, logoUrl, photoDataUrls = {}, appSettings = {}, ord = {} }) {
  const units     = laporan.units || [];
  const materials = (laporan.materials || []).filter(m => m.nama && m.keterangan !== "jasa");
  const jasaItems = (laporan.materials || []).filter(m => m.keterangan === "jasa");
  const fotos     = (laporan.foto_urls || []).filter(Boolean);
  const printDate = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  const svcDate   = laporan.date || (laporan.submitted_at || "").slice(0, 10);

  // Chunk photos 8 per page
  const photoChunks = [];
  for (let i = 0; i < fotos.length; i += 8) photoChunks.push(fotos.slice(i, i + 8));

  const teknisiLine = [laporan.teknisi, laporan.helper, laporan.teknisi2].filter(Boolean).join(" · ") || "—";

  return (
    <Document>
      {/* ── Page 1: Data Pekerjaan ── */}
      <Page size="A4" style={s.page}>

        {/* Header */}
        <View style={s.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {logoUrl
              ? <Image src={logoUrl} style={{ width: 52, height: 52, objectFit: "contain" }} />
              : null}
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

        {/* Informasi Pekerjaan */}
        <View style={s.section}>
          <Text style={s.secTitle}>Informasi Pekerjaan</Text>
          <View style={s.infoGrid}>
            <InfoRow label="Job ID"         value={laporan.job_id}  accent />
            <InfoRow label="Tanggal Service" value={svcDate} />
            <InfoRow label="Jenis Layanan"   value={laporan.service} />
            <InfoRow label="Jumlah Unit"     value={String(laporan.total_units || units.length || "—")} />
            <InfoRow label="Teknisi"         value={teknisiLine} />
            <InfoRow label="Status"          value={laporan.status} />
          </View>
        </View>

        {/* Informasi Customer */}
        <View style={s.section}>
          <Text style={s.secTitle}>Informasi Customer</Text>
          <View style={s.infoGrid}>
            <InfoRow label="Nama"  value={laporan.customer} />
            <InfoRow label="No. HP" value={laporan.phone || ord.phone} />
            {ord.address ? <InfoRow label="Alamat" value={(ord.address || "") + (ord.area ? ", " + ord.area : "")} full /> : null}
          </View>
        </View>

        {/* Detail Unit */}
        <UnitTable units={units} />

        {/* Material */}
        <MatTable items={materials} title="Material Terpakai" darkHeader />

        {/* Jasa */}
        <MatTable items={jasaItems} title="Jasa / Layanan Dilakukan" darkHeader />

        {/* Catatan & Rekomendasi */}
        <View style={[s.section, { flexDirection: "row", gap: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.secTitle}>Catatan Teknisi</Text>
            <View style={s.catatanBox}>
              <Text>{laporan.catatan || "—"}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.secTitle}>Rekomendasi</Text>
            <View style={s.catatanBox}>
              <Text>{laporan.rekomendasi || "—"}</Text>
            </View>
          </View>
        </View>

        {/* Persetujuan / Tanda Tangan */}
        <View style={s.section}>
          <Text style={s.secTitle}>Persetujuan</Text>
          <View style={s.sigRow}>
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

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerL}>{appSettings.company_name || "AClean Service"} · Jasa Servis AC Profesional · {appSettings.company_addr || ""}</Text>
          <Text style={s.footerR}>Dokumen ini dicetak otomatis oleh sistem AClean</Text>
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
