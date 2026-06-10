import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

const fmt = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const fmtDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
};

// T&C standar — selalu tampil di PDF tanpa perlu klik preset
const TERMS_PEKERJAAN = [
  "Jasa Kami tidak termasuk Jasa Perapian Tembok / Plafon / Dan Sebagainya.",
  "Penambahan Material / Jasa diluar Pekerjaan Quotation ini.",
  "Apabila ditemukan kerusakan Sparepart lain / Pekerjaan lain Maka akan diberikan penawaran tambahan.",
];
const TERMS_PAYMENT = [
  "Payment : Cash / Bank Transfer 100%",
  "Instalation : 1~14 Days, After Payment",
  "Price Include Shipment",
  "Validation : 15 Days",
  "Transfer BCA : 8830-8830-11 ( Malda Retta )",
];

// Normalisasi untuk deteksi apakah quo.notes hanya berisi preset (hindari duplikat di PDF)
const _norm = (t) => (t || "").replace(/\s+/g, " ").trim().toLowerCase();
const _PRESET_SIGNATURE = _norm(TERMS_PEKERJAAN.join(" ") + TERMS_PAYMENT.join(" "));

// Spacing dibuat dinamis: saat `compact` (≤5 item) semua margin/padding/font
// dirapatkan agar muat 1 halaman; selain itu pakai spacing normal (boleh 2 hal).
function buildStyles(compact) {
  const PAD   = compact ? 26 : 36;   // page padding
  const MB    = compact ? 7  : 12;   // jarak antar-block
  const CELLV = compact ? 4  : 7;    // padding vertikal sel tabel
  const BOXP  = compact ? "7 11" : "10 12"; // padding kotak info
  const HTOP  = compact ? "10 20" : "16 20"; // padding header atas
  return StyleSheet.create({
    page:       { padding: PAD, fontFamily: "Helvetica", fontSize: 10, color: "#1e293b", backgroundColor: "#fff" },
    header:     { borderRadius: 6, border: "2px solid #1E5BA8", marginBottom: compact ? 9 : 14, overflow: "hidden" },
    headerTop:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: HTOP },
    brand:      { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#1E5BA8" },
    brandSub:   { fontSize: 8, color: "#6b7280", marginTop: 2 },
    quoLabel:   { fontSize: 7, color: "#1E5BA8", fontFamily: "Helvetica-Bold", textAlign: "right", marginBottom: 3, textTransform: "uppercase" },
    quoBadge:   { backgroundColor: "#1E5BA8", color: "#fff", padding: "6 12", borderRadius: 4, fontSize: 11, fontFamily: "Helvetica-Bold" },
    headerSub:  { backgroundColor: "#f0f4f8", padding: "8 20", flexDirection: "row", gap: 20, borderTop: "1px solid #e2e8f0" },
    headerSubTxt: { fontSize: 8, color: "#1e293b" },
    grid2:      { flexDirection: "row", gap: 10, marginBottom: MB },
    box:        { flex: 1, borderRadius: 6, padding: BOXP },
    boxBlue:    { backgroundColor: "#e3f2fd", border: "1px solid #90caf9" },
    boxWhite:   { backgroundColor: "#fff", border: "1px solid #e2e8f0" },
    boxTitle:   { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#1E5BA8", textTransform: "uppercase", marginBottom: compact ? 5 : 8, letterSpacing: 0.5 },
    rowInfo:    { flexDirection: "row", marginBottom: compact ? 2 : 3 },
    rowLabel:   { color: "#64748b", width: 80, fontSize: 9 },
    rowVal:     { color: "#1e293b", fontFamily: "Helvetica-Bold", fontSize: 9, flex: 1 },
    table:      { marginBottom: MB },
    thead:      { flexDirection: "row", backgroundColor: "#1E5BA8", borderRadius: "4 4 0 0" },
    th:         { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8, padding: "8 8", textTransform: "uppercase" },
    tr:         { flexDirection: "row", borderBottom: "1px solid #f1f5f9" },
    trEven:     { backgroundColor: "#f8fafc" },
    td:         { fontSize: 9, padding: `${CELLV} 8`, color: "#1e293b" },
    tdMuted:    { fontSize: 9, padding: `${CELLV} 8`, color: "#64748b" },
    secTitle:   { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#1E5BA8", textTransform: "uppercase", letterSpacing: 0.5, padding: "5 8", backgroundColor: "#e3f2fd" },
    totalBox:   { backgroundColor: "#1E5BA8", borderRadius: 6, padding: "10 14", marginTop: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    totalLabel: { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 11 },
    totalVal:   { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 14 },
    subRow:     { flexDirection: "row", justifyContent: "space-between", padding: compact ? "3 14" : "4 14", borderBottom: "1px solid #f1f5f9" },
    subLabel:   { fontSize: 9, color: "#64748b" },
    subVal:     { fontSize: 9, color: "#1e293b", fontFamily: "Helvetica-Bold" },
    noteBox:    { border: "1px solid #e2e8f0", borderRadius: 6, padding: BOXP, marginBottom: MB },
    noteTitle:  { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#64748b", marginBottom: 4, textTransform: "uppercase" },
    noteText:   { fontSize: 9, color: "#1e293b", lineHeight: 1.5 },
    termsBox:   { border: "1px solid #e2e8f0", borderRadius: 6, padding: BOXP, marginBottom: MB },
    termsTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#1E5BA8", marginBottom: compact ? 3 : 5, textTransform: "uppercase", letterSpacing: 0.5 },
    termsItem:  { fontSize: 8.5, color: "#1e293b", lineHeight: compact ? 1.25 : 1.4, marginBottom: compact ? 1 : 2, flexDirection: "row" },
    termsNum:   { width: 14, color: "#64748b", fontFamily: "Helvetica-Bold" },
    validBox:   { backgroundColor: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6, padding: compact ? "6 12" : "8 12", marginBottom: MB },
    validText:  { fontSize: 9, color: "#c2410c" },
    footer:     { borderTop: "1px solid #e2e8f0", paddingTop: compact ? 7 : 10, marginTop: compact ? 4 : 8 },
    footerText: { fontSize: 8, color: "#94a3b8", textAlign: "center" },
  });
}

export default function QuotationPDF({ quo, appSettings, logoUrl }) {
  if (!quo) return null;

  const items      = quo.items || [];
  const unitItems  = items.filter(i => i.item_type === "unit_ac");
  const paketItems = items.filter(i => i.item_type === "paket");
  const jasaItems  = items.filter(i => i.item_type === "jasa");
  const addonItems = items.filter(i => i.item_type === "addon");

  // ≤5 baris item → mode compact agar muat 1 halaman (hindari halaman ke-2 nanggung).
  // >5 baris → spacing normal, boleh mengalir ke 2 halaman.
  const totalRows = unitItems.length + paketItems.length + jasaItems.length + addonItems.length;
  const compact   = totalRows <= 5;
  const s = buildStyles(compact);

  const companyName  = appSettings?.company_name  || "AClean Service";
  const _rawPhone    = appSettings?.wa_number || appSettings?.company_phone || "6281289898937";
  const companyPhone = String(_rawPhone).replace(/[^\d]/g, "") || "6281289898937";
  const companyAddr  = appSettings?.company_addr || appSettings?.company_address || "Jakarta";
  const bankInfo     = (appSettings?.bank_name || appSettings?.bank_number)
    ? `Transfer ${appSettings.bank_name || ""} ${appSettings.bank_number || ""}${appSettings.bank_holder ? " a.n " + appSettings.bank_holder : ""}`.trim()
    : (appSettings?.bank_info || "Transfer Bank BCA 8330883011 a.n Malda Retta");

  const STATUS_LABEL = {
    DRAFT:     "DRAFT",
    SENT:      "PENAWARAN",
    APPROVED:  "DISETUJUI",
    EXPIRED:   "KADALUARSA",
    CANCELLED: "DIBATALKAN",
  };

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* Header */}
        <View style={s.header}>
          <View style={s.headerTop}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {logoUrl ? (
                <Image src={logoUrl} style={{ width: 46, height: 46, objectFit: "contain" }} />
              ) : null}
              <View>
                <Text style={s.brand}>{companyName}</Text>
                <Text style={s.brandSub}>AC Installation & Service Professional</Text>
                <Text style={s.brandSub}>{companyAddr} · {companyPhone}</Text>
              </View>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={s.quoLabel}>SURAT PENAWARAN HARGA</Text>
              <Text style={s.quoBadge}>{quo.id}</Text>
            </View>
          </View>
          <View style={s.headerSub}>
            <Text style={s.headerSubTxt}>Tgl Buat: {fmtDate(quo.created_at)}</Text>
            <Text style={s.headerSubTxt}>Valid s.d: {fmtDate(quo.valid_until)}</Text>
            <Text style={s.headerSubTxt}>Status: {STATUS_LABEL[quo.status] || quo.status}</Text>
          </View>
        </View>

        {/* Customer & Detail */}
        <View style={s.grid2}>
          <View style={[s.box, s.boxBlue]}>
            <Text style={s.boxTitle}>Ditujukan Kepada</Text>
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>Nama</Text>
              <Text style={s.rowVal}>{quo.customer || "—"}</Text>
            </View>
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>No. HP</Text>
              <Text style={s.rowVal}>{quo.phone || "—"}</Text>
            </View>
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>Area</Text>
              <Text style={s.rowVal}>{quo.area || "—"}</Text>
            </View>
            {quo.address && (
              <View style={s.rowInfo}>
                <Text style={s.rowLabel}>Alamat</Text>
                <Text style={s.rowVal}>{quo.address}</Text>
              </View>
            )}
          </View>
          <View style={[s.box, s.boxWhite]}>
            <Text style={s.boxTitle}>Informasi Penawaran</Text>
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>No. Quotation</Text>
              <Text style={s.rowVal}>{quo.id}</Text>
            </View>
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>Tanggal</Text>
              <Text style={s.rowVal}>{fmtDate(quo.created_at)}</Text>
            </View>
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>Berlaku s.d</Text>
              <Text style={s.rowVal}>{fmtDate(quo.valid_until)}</Text>
            </View>
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>Pembayaran</Text>
              <Text style={s.rowVal}>{bankInfo}</Text>
            </View>
          </View>
        </View>

        {/* Unit AC section */}
        {unitItems.length > 0 && (
          <View style={s.table}>
            <Text style={s.secTitle}>Unit AC (Harga Satuan — Informasi)</Text>
            <View style={s.thead}>
              <Text style={[s.th, { flex: 4 }]}>Deskripsi</Text>
              <Text style={[s.th, { flex: 1, textAlign: "center" }]}>Qty</Text>
              <Text style={[s.th, { flex: 2, textAlign: "right" }]}>Harga</Text>
              <Text style={[s.th, { flex: 2, textAlign: "right" }]}>Subtotal</Text>
            </View>
            {unitItems.map((item, i) => (
              <View key={i} style={[s.tr, i % 2 === 1 ? s.trEven : {}]}>
                <Text style={[s.tdMuted, { flex: 4 }]}>{item.description?.trim() || "Unit AC"}</Text>
                <Text style={[s.tdMuted, { flex: 1, textAlign: "center" }]}>{item.qty}</Text>
                <Text style={[s.tdMuted, { flex: 2, textAlign: "right" }]}>{fmt(item.unit_price)}</Text>
                <Text style={[s.tdMuted, { flex: 2, textAlign: "right" }]}>{fmt(item.subtotal)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Paket & Jasa */}
        {(paketItems.length > 0 || jasaItems.length > 0) && (
          <View style={s.table}>
            <Text style={s.secTitle}>Paket Pemasangan & Jasa</Text>
            <View style={s.thead}>
              <Text style={[s.th, { flex: 4 }]}>Deskripsi</Text>
              <Text style={[s.th, { flex: 1, textAlign: "center" }]}>Qty</Text>
              <Text style={[s.th, { flex: 2, textAlign: "right" }]}>Harga</Text>
              <Text style={[s.th, { flex: 2, textAlign: "right" }]}>Subtotal</Text>
            </View>
            {[...paketItems, ...jasaItems].map((item, i) => (
              <View key={i} style={[s.tr, i % 2 === 1 ? s.trEven : {}]}>
                <View style={[{ flex: 4 }]}>
                  <Text style={s.td}>{item.description}</Text>
                  {(item.include || []).map((inc, j) => (
                    <Text key={j} style={{ fontSize: 8, color: "#64748b", padding: "1 8 1 16" }}>✓ {inc.nama} {inc.qty} {inc.satuan}</Text>
                  ))}
                </View>
                <Text style={[s.td, { flex: 1, textAlign: "center" }]}>{item.qty}</Text>
                <Text style={[s.td, { flex: 2, textAlign: "right" }]}>{fmt(item.unit_price)}</Text>
                <Text style={[s.td, { flex: 2, textAlign: "right", fontFamily: "Helvetica-Bold" }]}>{fmt(item.subtotal)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Material */}
        {addonItems.length > 0 && (
          <View style={s.table}>
            <Text style={s.secTitle}>Material Tambahan</Text>
            <View style={s.thead}>
              <Text style={[s.th, { flex: 4 }]}>Material</Text>
              <Text style={[s.th, { flex: 1, textAlign: "center" }]}>Qty</Text>
              <Text style={[s.th, { flex: 2, textAlign: "right" }]}>Harga</Text>
              <Text style={[s.th, { flex: 2, textAlign: "right" }]}>Subtotal</Text>
            </View>
            {addonItems.map((item, i) => (
              <View key={i} style={[s.tr, i % 2 === 1 ? s.trEven : {}]}>
                <Text style={[s.td, { flex: 4 }]}>{item.description}</Text>
                <Text style={[s.td, { flex: 1, textAlign: "center" }]}>{item.qty}</Text>
                <Text style={[s.td, { flex: 2, textAlign: "right" }]}>{fmt(item.unit_price)}</Text>
                <Text style={[s.td, { flex: 2, textAlign: "right", fontFamily: "Helvetica-Bold" }]}>{fmt(item.subtotal)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Total box */}
        <View wrap={false} style={{ marginBottom: 12 }}>
          {(quo.unit_ac_amount > 0) && (
            <View style={s.subRow}>
              <Text style={s.subLabel}>Unit AC</Text>
              <Text style={s.subVal}>{fmt(quo.unit_ac_amount)}</Text>
            </View>
          )}
          {(quo.labor > 0) && (
            <View style={s.subRow}>
              <Text style={s.subLabel}>Paket & Jasa</Text>
              <Text style={s.subVal}>{fmt(quo.labor)}</Text>
            </View>
          )}
          {(quo.material > 0) && (
            <View style={s.subRow}>
              <Text style={s.subLabel}>Material Tambahan</Text>
              <Text style={s.subVal}>{fmt(quo.material)}</Text>
            </View>
          )}
          {(quo.discount > 0) && (
            <View style={s.subRow}>
              <Text style={[s.subLabel, { color: "#f59e0b" }]}>Diskon</Text>
              <Text style={[s.subVal, { color: "#f59e0b" }]}>-{fmt(quo.discount)}</Text>
            </View>
          )}
          {(quo.trade_in_amount > 0) && (
            <View style={s.subRow}>
              <Text style={[s.subLabel, { color: "#f59e0b" }]}>Trade-in AC lama</Text>
              <Text style={[s.subVal, { color: "#f59e0b" }]}>-{fmt(quo.trade_in_amount)}</Text>
            </View>
          )}
          <View style={s.totalBox}>
            <Text style={s.totalLabel}>TOTAL PENAWARAN</Text>
            <Text style={s.totalVal}>{fmt(quo.total)}</Text>
          </View>
        </View>

        {/* Valid until warning */}
        <View wrap={false} style={s.validBox}>
          <Text style={s.validText}>
            ⏰ Penawaran ini berlaku hingga {fmtDate(quo.valid_until)}.
            Harga dapat berubah setelah masa berlaku habis.
          </Text>
        </View>

        {/* Catatan tambahan custom — hanya tampil jika notes BUKAN sekadar preset T&C */}
        {quo.notes && !_norm(quo.notes).includes(_PRESET_SIGNATURE) && (
          <View style={s.noteBox}>
            <Text style={s.noteTitle}>Catatan / Scope Pekerjaan</Text>
            <Text style={s.noteText}>{quo.notes}</Text>
          </View>
        )}

        {/* Syarat & Ketentuan — selalu embed di PDF (tidak perlu klik preset) */}
        <View wrap={false} style={s.termsBox}>
          <Text style={s.termsTitle}>Catatan Pekerjaan</Text>
          {TERMS_PEKERJAAN.map((t, i) => (
            <View key={i} style={s.termsItem}>
              <Text style={s.termsNum}>{i + 1}.</Text>
              <Text style={{ flex: 1 }}>{t}</Text>
            </View>
          ))}
          <Text style={[s.termsTitle, { marginTop: 8 }]}>Term Of Payment</Text>
          {TERMS_PAYMENT.map((t, i) => (
            <View key={i} style={s.termsItem}>
              <Text style={s.termsNum}>{i + 1}.</Text>
              <Text style={{ flex: 1 }}>{t}</Text>
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>
            Pertanyaan? Hubungi kami via WA: +{companyPhone}
          </Text>
          <Text style={[s.footerText, { marginTop: 4 }]}>
            Terima kasih telah mempercayakan kebutuhan AC Anda kepada {companyName}
          </Text>
        </View>

      </Page>
    </Document>
  );
}
