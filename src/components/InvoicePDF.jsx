import { Document, Page, Text, View, StyleSheet, Image, Font } from "@react-pdf/renderer";

// ── Helpers ──
const fmt = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");

const detectKat = (m) => {
  if (m.keterangan === "jasa") return "jasa";
  if (m.keterangan === "repair") return "repair";
  if (m.keterangan === "freon") return "freon";
  const n = (m.nama || "").toLowerCase();
  if (["freon", "kuras vacum", "r32", "r410", "r22"].some(k => n.includes(k))) return "freon";
  const repairNames = ["repair", "perbaikan", "kapasitor", "kompresor", "sparepart", "pcb", "modul", "ganti"];
  if (repairNames.some(k => n.includes(k))) return "repair";
  const jasaNames = ["cleaning", "jasa", "service", "servis", "pemasangan", "bongkar", "instalasi"];
  if (jasaNames.some(k => n.includes(k))) return "jasa";
  return "jasa";
};

const fmtDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
};

// ── Styles ──
const s = StyleSheet.create({
  page:       { padding: 36, fontFamily: "Helvetica", fontSize: 10, color: "#1e293b", backgroundColor: "#fff" },
  // Header
  header:     { borderRadius: 6, border: "2px solid #1E5BA8", marginBottom: 14, overflow: "hidden" },
  headerTop:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: "16 20" },
  brand:      { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#1E5BA8" },
  brandSub:   { fontSize: 8, color: "#6b7280", marginTop: 2 },
  invLabel:   { fontSize: 7, color: "#1E5BA8", fontFamily: "Helvetica-Bold", textAlign: "right", marginBottom: 3, textTransform: "uppercase" },
  invBadge:   { backgroundColor: "#1E5BA8", color: "#fff", padding: "6 12", borderRadius: 4, fontSize: 11, fontFamily: "Helvetica-Bold" },
  headerSub:  { backgroundColor: "#f0f4f8", padding: "8 20", flexDirection: "row", gap: 20, borderTop: "1px solid #e2e8f0" },
  headerSubTxt: { fontSize: 8, color: "#1e293b" },
  // Grid 2 col
  grid2:      { flexDirection: "row", gap: 10, marginBottom: 12 },
  box:        { flex: 1, borderRadius: 6, padding: "10 12" },
  boxBlue:    { backgroundColor: "#e3f2fd", border: "1px solid #90caf9" },
  boxWhite:   { backgroundColor: "#fff", border: "1px solid #e2e8f0" },
  boxTitle:   { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#1E5BA8", textTransform: "uppercase", marginBottom: 8, letterSpacing: 0.5 },
  rowInfo:    { flexDirection: "row", marginBottom: 3 },
  rowLabel:   { color: "#64748b", width: 72, fontSize: 9 },
  rowVal:     { color: "#1e293b", fontFamily: "Helvetica-Bold", fontSize: 9, flex: 1 },
  // Table
  table:      { marginBottom: 12 },
  thead:      { flexDirection: "row", backgroundColor: "#1E5BA8", borderRadius: "4 4 0 0" },
  th:         { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, padding: "8 8", textTransform: "uppercase" },
  tr:         { flexDirection: "row", borderBottom: "1px solid #f1f5f9" },
  trEven:     { backgroundColor: "#f8fafc" },
  td:         { fontSize: 9, padding: "7 8", color: "#1e293b" },
  totalRow:   { flexDirection: "row", backgroundColor: "#1E5BA8", borderRadius: "0 0 4 4" },
  totalTd:    { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 11, padding: "10 8" },
  sectionHdr: { padding: "4 8", fontSize: 8, fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  // Footer grid
  footerGrid: { flexDirection: "row", gap: 10, marginBottom: 16 },
  bankBox:    { flex: 1, backgroundColor: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 6, padding: "10 12" },
  bankNum:    { fontFamily: "Helvetica-Bold", fontSize: 13, color: "#1e293b", marginTop: 2, marginBottom: 2 },
  statusPaid:   { flex: 1, backgroundColor: "#F0FDF4", border: "1px solid #86efac", borderRadius: 6, padding: "10 12" },
  statusUnpaid: { flex: 1, backgroundColor: "#FFFBEB", border: "1px solid #fde68a", borderRadius: 6, padding: "10 12" },
  statusOverdue:{ flex: 1, backgroundColor: "#FEF2F2", border: "1px solid #fca5a5", borderRadius: 6, padding: "10 12" },
  garansiBox: { backgroundColor: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "8 12", marginBottom: 12, fontSize: 9, color: "#166534" },
  footerNote: { borderTop: "1px solid #e2e8f0", paddingTop: 12, textAlign: "center", color: "#64748b", fontSize: 9 },
});

// ── Sub-components ──

function InfoRow({ label, value, bold }) {
  return (
    <View style={s.rowInfo}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowVal, bold ? { color: "#1e40af" } : {}]}>{value || "—"}</Text>
    </View>
  );
}

function SectionHeader({ label, color }) {
  return (
    <View style={[s.thead, { backgroundColor: color + "18", borderRadius: 0 }]}>
      <Text style={[s.sectionHdr, { color }]}>{label}</Text>
    </View>
  );
}

function MatRow({ m, idx }) {
  const hSat = m.harga_satuan > 0 ? m.harga_satuan
    : (m.subtotal > 0 && m.jumlah > 0 ? Math.round(m.subtotal / m.jumlah) : 0);
  const sub = m.subtotal > 0 ? m.subtotal
    : (hSat > 0 && m.jumlah > 0 ? hSat * m.jumlah : 0);
  return (
    <View style={[s.tr, idx % 2 === 1 ? s.trEven : {}]}>
      <Text style={[s.td, { flex: 1 }]}>{m.nama || ""}</Text>
      <Text style={[s.td, { width: 60, textAlign: "right" }]}>{m.jumlah} {m.satuan || ""}</Text>
      <Text style={[s.td, { width: 80, textAlign: "right", fontFamily: "Courier" }]}>{hSat > 0 ? hSat.toLocaleString("id-ID") : "—"}</Text>
      <Text style={[s.td, { width: 80, textAlign: "right", fontFamily: "Courier-Bold" }]}>{sub > 0 ? sub.toLocaleString("id-ID") : "—"}</Text>
    </View>
  );
}

// ── Main Component ──
export default function InvoicePDF({ inv, logoUrl, appSettings = {} }) {
  const matDetails = (() => {
    const md = inv.materials_detail;
    if (!md) return [];
    if (Array.isArray(md)) return md;
    try { return JSON.parse(md); } catch { return []; }
  })();

  const jasaRows   = matDetails.filter(m => detectKat(m) === "jasa");
  const repairRows = matDetails.filter(m => detectKat(m) === "repair");
  const freonRows  = matDetails.filter(m => detectKat(m) === "freon");
  const matRows    = matDetails.filter(m => detectKat(m) === "mat");
  const unitCount  = Array.isArray(inv.units) ? inv.units.length : (Number(inv.units) || 1);
  const perUnit    = unitCount > 0 ? Math.round((inv.labor || 0) / unitCount) : (inv.labor || 0);

  // Material remainder (invoice lama)
  const matDetailTotal = matDetails.reduce((s, m) => s + (m.subtotal || 0), 0);
  const hasRemainMat = (inv.material || 0) > 0 && matDetailTotal < (inv.material || 0) - 1000;
  const remainMat = hasRemainMat
    ? (inv.material || 0) - matDetails.filter(m => detectKat(m) !== "jasa" && detectKat(m) !== "repair").reduce((s, m) => s + (m.subtotal || 0), 0)
    : 0;

  const statusBox = inv.status === "PAID" ? s.statusPaid
    : inv.status === "OVERDUE" ? s.statusOverdue : s.statusUnpaid;
  const statusText = inv.status === "PAID" ? "LUNAS"
    : inv.status === "OVERDUE" ? "JATUH TEMPO" : "MENUNGGU PEMBAYARAN";

  let rowIdx = 0;

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── Header ── */}
        <View style={s.header}>
          <View style={s.headerTop}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {logoUrl ? (
                <Image src={logoUrl} style={{ width: 48, height: 48, objectFit: "contain" }} />
              ) : null}
              <View>
                <Text style={s.brand}>AClean Service</Text>
                <Text style={s.brandSub}>Jasa Servis & Perawatan AC Profesional</Text>
              </View>
            </View>
            <View>
              <Text style={s.invLabel}>INVOICE</Text>
              <View style={s.invBadge}>
                <Text>{inv.id}</Text>
              </View>
            </View>
          </View>
          <View style={s.headerSub}>
            <Text style={s.headerSubTxt}>📍 {appSettings.company_addr || ""}</Text>
            <Text style={s.headerSubTxt}>📞 {appSettings.wa_number || ""}</Text>
            <Text style={s.headerSubTxt}>🏦 {appSettings.bank_name} {appSettings.bank_number} a.n. {appSettings.bank_holder}</Text>
          </View>
        </View>

        {/* ── Detail Grid ── */}
        <View style={s.grid2}>
          <View style={[s.box, s.boxBlue]}>
            <Text style={s.boxTitle}>Detail Invoice</Text>
            <InfoRow label="Tgl Invoice" value={fmtDate(inv.created_at)} />
            <InfoRow label="Issued"      value={fmtDate(new Date())} bold />
            <InfoRow label="No. Invoice" value={inv.id} />
            <InfoRow label="No. Order"   value={inv.job_id} />
            <InfoRow label="Jatuh Tempo" value={inv.due} />
          </View>
          <View style={[s.box, s.boxWhite]}>
            <Text style={s.boxTitle}>Tagihan Kepada</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 4 }}>{inv.customer || ""}</Text>
            <Text style={{ color: "#64748b", fontSize: 9 }}>📱 {inv.phone || "—"}</Text>
            <Text style={{ color: "#64748b", fontSize: 9, marginTop: 3 }}>🔧 {inv.service || "—"}</Text>
          </View>
        </View>

        {/* ── Table ── */}
        <View style={s.table}>
          <View style={s.thead}>
            <Text style={[s.th, { flex: 1 }]}>Deskripsi</Text>
            <Text style={[s.th, { width: 60, textAlign: "right" }]}>Jml Unit</Text>
            <Text style={[s.th, { width: 80, textAlign: "right" }]}>Harga/Unit</Text>
            <Text style={[s.th, { width: 80, textAlign: "right" }]}>Subtotal</Text>
          </View>

          {/* Fallback: invoice lama tanpa matDetails */}
          {inv.labor > 0 && matDetails.length === 0 && (
            <View style={[s.tr]}>
              <Text style={[s.td, { flex: 1 }]}>{inv.service || "Jasa Servis AC"}</Text>
              <Text style={[s.td, { width: 60, textAlign: "right" }]}>{unitCount}</Text>
              <Text style={[s.td, { width: 80, textAlign: "right", fontFamily: "Courier" }]}>{perUnit.toLocaleString("id-ID")}</Text>
              <Text style={[s.td, { width: 80, textAlign: "right", fontFamily: "Courier-Bold" }]}>{(inv.labor || 0).toLocaleString("id-ID")}</Text>
            </View>
          )}

          {jasaRows.length > 0 && (
            <>
              <SectionHeader label="Jasa / Layanan" color="#3b82f6" />
              {jasaRows.map((m, i) => <MatRow key={i} m={m} idx={rowIdx++} />)}
            </>
          )}
          {repairRows.length > 0 && (
            <>
              <SectionHeader label="Repair / Perbaikan" color="#f59e0b" />
              {repairRows.map((m, i) => <MatRow key={i} m={m} idx={rowIdx++} />)}
            </>
          )}
          {matRows.length > 0 && (
            <>
              <SectionHeader label="Material / Sparepart" color="#10b981" />
              {matRows.map((m, i) => <MatRow key={i} m={m} idx={rowIdx++} />)}
            </>
          )}
          {freonRows.length > 0 && (
            <>
              <SectionHeader label="Freon / Kuras Vacum" color="#06b6d4" />
              {freonRows.map((m, i) => <MatRow key={i} m={m} idx={rowIdx++} />)}
            </>
          )}
          {matDetails.length === 0 && (inv.material || 0) > 0 && (
            <>
              <SectionHeader label="Material / Freon" color="#06b6d4" />
              <View style={s.tr}>
                <Text style={[s.td, { flex: 1, color: "#475569", fontStyle: "italic" }]}>Material & Freon (total)</Text>
                <Text style={[s.td, { width: 60, textAlign: "right", color: "#94a3b8" }]}>—</Text>
                <Text style={[s.td, { width: 80, textAlign: "right", color: "#94a3b8" }]}>—</Text>
                <Text style={[s.td, { width: 80, textAlign: "right", fontFamily: "Courier-Bold" }]}>{(inv.material || 0).toLocaleString("id-ID")}</Text>
              </View>
            </>
          )}
          {hasRemainMat && remainMat > 0 && (
            <View style={s.tr}>
              <Text style={[s.td, { flex: 1, color: "#475569", fontStyle: "italic" }]}>Material & Freon</Text>
              <Text style={[s.td, { width: 60, color: "#94a3b8" }]}>—</Text>
              <Text style={[s.td, { width: 80, color: "#94a3b8" }]}>—</Text>
              <Text style={[s.td, { width: 80, textAlign: "right", fontFamily: "Courier-Bold" }]}>{remainMat.toLocaleString("id-ID")}</Text>
            </View>
          )}
          {(inv.discount || 0) > 0 && (
            <View style={[s.tr, { backgroundColor: "#fff1f2" }]}>
              <Text style={[s.td, { flex: 1, color: "#be123c", fontStyle: "italic" }]}>Discount</Text>
              <Text style={[s.td, { width: 60, textAlign: "right", color: "#be123c" }]}>—</Text>
              <Text style={[s.td, { width: 80, textAlign: "right", color: "#be123c" }]}>—</Text>
              <Text style={[s.td, { width: 80, textAlign: "right", fontFamily: "Courier-Bold", color: "#be123c" }]}>-{(inv.discount || 0).toLocaleString("id-ID")}</Text>
            </View>
          )}
          {inv.trade_in && (inv.trade_in_amount || 0) > 0 && (
            <View style={[s.tr, { backgroundColor: "#fff1f2" }]}>
              <Text style={[s.td, { flex: 1, color: "#be123c", fontStyle: "italic" }]}>Trade-In AC Lama</Text>
              <Text style={[s.td, { width: 60, textAlign: "right", color: "#be123c" }]}>—</Text>
              <Text style={[s.td, { width: 80, textAlign: "right", color: "#be123c" }]}>—</Text>
              <Text style={[s.td, { width: 80, textAlign: "right", fontFamily: "Courier-Bold", color: "#be123c" }]}>-{(inv.trade_in_amount || 0).toLocaleString("id-ID")}</Text>
            </View>
          )}

          <View style={s.totalRow}>
            <Text style={[s.totalTd, { flex: 1 }]}>TOTAL TAGIHAN</Text>
            <Text style={[s.totalTd, { width: 80, textAlign: "right", fontFamily: "Courier-Bold" }]}>Rp {(inv.total || 0).toLocaleString("id-ID")}</Text>
          </View>
        </View>

        {/* ── Garansi ── */}
        {inv.garansi_expires ? (
          <View style={s.garansiBox}>
            <Text>Garansi Servis {inv.garansi_days || 30} Hari — berlaku sampai {inv.garansi_expires}. Jika AC bermasalah dalam masa garansi, hubungi kami tanpa biaya tambahan.</Text>
          </View>
        ) : null}

        {/* ── Footer Grid ── */}
        <View style={s.footerGrid}>
          <View style={s.bankBox}>
            <Text style={s.boxTitle}>Informasi Pembayaran</Text>
            <Text style={{ color: "#475569", fontSize: 9 }}>Transfer Bank {appSettings.bank_name || "BCA"}</Text>
            <Text style={s.bankNum}>{appSettings.bank_number || ""}</Text>
            <Text style={{ color: "#475569", fontSize: 9 }}>a.n. {appSettings.bank_holder || ""}</Text>
            <Text style={{ marginTop: 6, fontSize: 9, color: "#64748b" }}>Kirim bukti transfer via WhatsApp ke nomor di atas</Text>
          </View>
          <View style={statusBox}>
            <Text style={s.boxTitle}>Status Pembayaran</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 3 }}>{statusText}</Text>
            <Text style={{ fontSize: 9, color: "#64748b" }}>Jatuh tempo: {inv.due || "—"}</Text>
            {inv.paid_at ? <Text style={{ fontSize: 9, color: "#16a34a", marginTop: 3 }}>Dibayar: {fmtDate(inv.paid_at)}</Text> : null}
          </View>
        </View>

        {/* ── Footer Note ── */}
        <View style={s.footerNote}>
          <Text>Pertanyaan? Hubungi kami via WhatsApp: {appSettings.wa_number || ""}</Text>
          <Text style={{ fontStyle: "italic", marginTop: 3, color: "#94a3b8" }}>
            Terima kasih telah mempercayakan perawatan AC Anda kepada {appSettings.company_name || "AClean"}
          </Text>
        </View>

      </Page>
    </Document>
  );
}
