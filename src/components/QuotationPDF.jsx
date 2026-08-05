import { Document, Page, Text, View, StyleSheet, Image, Font } from "@react-pdf/renderer";

// Matikan hyphenation otomatis react-pdf — defaultnya suka motong kata di
// ujung baris (mis. "Service" → "Ser-vice") walau bukan bahasa Inggris.
Font.registerHyphenationCallback((word) => [word]);

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

const s = StyleSheet.create({
  page:       { padding: 40, fontFamily: "Times-Roman", fontSize: 10, color: "#22252b", backgroundColor: "#fff" },
  // Header
  headerRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 14, borderBottom: "2.5px solid #22252b", marginBottom: 16 },
  brandRow:   { flexDirection: "row", alignItems: "center", gap: 14 },
  brandName:  { fontFamily: "Times-Bold", fontSize: 17, color: "#2f5ea3" },
  brandTag:   { fontSize: 8, color: "#5b5f66", marginTop: 2 },
  brandInfo:  { fontSize: 8, color: "#5b5f66", marginTop: 5, lineHeight: 1.5 },
  docKind:    { fontFamily: "Times-Bold", fontSize: 20, letterSpacing: 1, textAlign: "right" },
  docNo:      { fontSize: 9, color: "#5b5f66", marginTop: 5, border: "1px solid #cfd2d6", borderRadius: 3, padding: "3 9", textAlign: "right" },
  // Meta grid
  metaRow:    { flexDirection: "row", justifyContent: "space-between", gap: 24, marginBottom: 14 },
  metaK:      { fontFamily: "Times-Bold", fontSize: 8, textTransform: "uppercase", letterSpacing: 0.5, color: "#5b5f66", marginBottom: 3 },
  metaV:      { fontFamily: "Times-Bold", fontSize: 11 },
  metaAddr:   { fontSize: 9, color: "#22252b", marginTop: 2, maxWidth: 220 },
  metaRight:  { alignItems: "flex-end" },
  // Table
  table:      { marginTop: 4 },
  thead:      { flexDirection: "row", backgroundColor: "#2f5ea3" },
  th:         { color: "#fff", fontFamily: "Times-Bold", fontSize: 8.5, padding: "6 8", textTransform: "uppercase" },
  tr:         { flexDirection: "row", borderBottom: "1px solid #cfd2d6" },
  td:         { fontSize: 9.5, padding: "6 8" },
  incText:    { fontSize: 8, color: "#5b5f66", padding: "1 8 1 16" },
  adjRow:     { flexDirection: "row", justifyContent: "space-between", padding: "4 9", fontSize: 9.5, color: "#5b5f66" },
  totalBar:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#2f5ea3", padding: "9 14", marginTop: 4 },
  totalLabel: { color: "#fff", fontFamily: "Times-Bold", fontSize: 12, letterSpacing: 0.5 },
  totalVal:   { color: "#fff", fontFamily: "Times-Bold", fontSize: 13 },
  // Boxes
  validBox:   { backgroundColor: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 4, padding: "8 12", marginTop: 14 },
  validText:  { fontSize: 9, color: "#c2410c" },
  noteBox:    { border: "1px solid #cfd2d6", borderRadius: 4, padding: "9 12", marginTop: 12 },
  noteTitle:  { fontFamily: "Times-Bold", fontSize: 8, color: "#5b5f66", marginBottom: 4, textTransform: "uppercase" },
  noteText:   { fontSize: 9.5, lineHeight: 1.5 },
  termsBox:   { marginTop: 14 },
  termsTitle: { fontFamily: "Times-Bold", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 },
  termsItem:  { fontSize: 9, lineHeight: 1.5, marginBottom: 2, flexDirection: "row" },
  termsNum:   { width: 14, color: "#5b5f66" },
  // Footer
  footerRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: 22 },
  footerNote: { fontSize: 9, color: "#5b5f66", lineHeight: 1.5, maxWidth: 280 },
  signBlock:  { alignItems: "center", minWidth: 150 },
  signPlace:  { fontSize: 10, marginBottom: 46 },
  signName:   { fontFamily: "Times-Bold", fontSize: 10, borderTop: "1px solid #22252b", paddingTop: 4 },
  pageFooter: { borderTop: "1px solid #cfd2d6", paddingTop: 8, marginTop: 16, textAlign: "center" },
  pageFooterText: { fontSize: 8, color: "#94a3b8" },
});

// Baris item flat (dipakai semua kategori — Unit AC, Paket/Jasa, Material)
function ItemRow({ no, desc, qty, uom, price, subtotal, include }) {
  return (
    <View>
      <View style={s.tr}>
        <Text style={[s.td, { width: 26 }]}>{no}</Text>
        <Text style={[s.td, { flex: 1 }]}>{desc}</Text>
        <Text style={[s.td, { width: 34, textAlign: "right" }]}>{qty}</Text>
        <Text style={[s.td, { width: 50 }]}>{uom || "Unit"}</Text>
        <Text style={[s.td, { width: 76, textAlign: "right" }]}>{price > 0 ? price.toLocaleString("id-ID") : "—"}</Text>
        <Text style={[s.td, { width: 86, textAlign: "right", fontFamily: "Times-Bold" }]}>{subtotal > 0 ? subtotal.toLocaleString("id-ID") : "—"}</Text>
      </View>
      {(include || []).map((inc, i) => (
        <Text key={i} style={s.incText}>✓ {inc.nama} {inc.qty} {inc.satuan}</Text>
      ))}
    </View>
  );
}

export default function QuotationPDF({ quo, appSettings, logoUrl }) {
  if (!quo) return null;

  const items      = quo.items || [];
  const unitItems  = items.filter(i => i.item_type === "unit_ac");
  const otherItems = items.filter(i => i.item_type !== "unit_ac");
  const allRows    = [...unitItems, ...otherItems];

  const companyName  = appSettings?.company_name  || "AClean Service";
  const _rawPhone    = appSettings?.wa_number || appSettings?.company_phone || "6281289898937";
  const companyPhone = String(_rawPhone).replace(/[^\d]/g, "") || "6281289898937";
  const companyAddr  = appSettings?.company_addr || appSettings?.company_address || "Jakarta";
  const bankInfo     = (appSettings?.bank_name || appSettings?.bank_number)
    ? `${appSettings.bank_name || "BCA"} ${appSettings.bank_number || ""}${appSettings.bank_holder ? " a.n " + appSettings.bank_holder : ""}`.trim()
    : (appSettings?.bank_info || "BCA 8830883011 a.n Malda Retta");

  const STATUS_LABEL = {
    DRAFT: "DRAFT", SENT: "PENAWARAN", APPROVED: "DISETUJUI",
    EXPIRED: "KADALUARSA", CANCELLED: "DIBATALKAN",
  };

  const hasPph = !!quo.pph23 && (quo.pph23_amount || 0) > 0;
  // DPP = nilai JASA saja + PPh — bukan total (jasa+material+unit AC).
  const dpp = hasPph ? (quo.labor || 0) + (quo.pph23_amount || 0) : 0;

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* Header */}
        <View style={s.headerRow}>
          <View style={s.brandRow}>
            {logoUrl ? <Image src={logoUrl} style={{ width: 56, height: 56, objectFit: "contain" }} /> : null}
            <View>
              <Text style={s.brandName}>{companyName}</Text>
              <Text style={s.brandTag}>AC Installation & Service Professional</Text>
              <Text style={s.brandInfo}>{companyAddr}{"\n"}+{companyPhone} · {bankInfo}</Text>
            </View>
          </View>
          <View>
            <Text style={s.docKind}>QUOTATION</Text>
            <Text style={s.docNo}>No. {quo.id}</Text>
          </View>
        </View>

        {/* Meta: Kepada / Info */}
        <View style={s.metaRow}>
          <View>
            <Text style={s.metaK}>Kepada</Text>
            <Text style={s.metaV}>{quo.customer || "—"}</Text>
            {quo.address ? <Text style={s.metaAddr}>{quo.address}</Text> : null}
            <Text style={s.metaAddr}>{quo.phone || "—"}{quo.area ? " · " + quo.area : ""}</Text>
          </View>
          <View style={s.metaRight}>
            <Text style={s.metaK}>Tanggal</Text>
            <Text style={s.metaV}>{fmtDate(quo.created_at)}</Text>
            <Text style={[s.metaAddr, { marginTop: 8 }]}>Berlaku s.d {fmtDate(quo.valid_until)}</Text>
            <Text style={s.metaAddr}>Status: {STATUS_LABEL[quo.status] || quo.status}</Text>
          </View>
        </View>

        {/* Tabel item — flat, 1 tabel gabungan */}
        <View style={s.table}>
          <View style={s.thead}>
            <Text style={[s.th, { width: 26 }]}>No</Text>
            <Text style={[s.th, { flex: 1 }]}>Detail Item</Text>
            <Text style={[s.th, { width: 34, textAlign: "right" }]}>Qty</Text>
            <Text style={[s.th, { width: 50 }]}>Uom</Text>
            <Text style={[s.th, { width: 76, textAlign: "right" }]}>Value</Text>
            <Text style={[s.th, { width: 86, textAlign: "right" }]}>Amount</Text>
          </View>
          {allRows.length === 0 ? (
            <View style={s.tr}><Text style={[s.td, { flex: 1, textAlign: "center", color: "#94a3b8", fontStyle: "italic" }]}>Belum ada item</Text></View>
          ) : allRows.map((item, i) => (
            <ItemRow key={i} no={i + 1}
              desc={item.description?.trim() || (item.item_type === "unit_ac" ? "Unit AC" : "")}
              qty={item.qty} uom={item.satuan} price={item.unit_price} subtotal={item.subtotal}
              include={item.include} />
          ))}

          {(quo.discount || 0) > 0 && (
            <View style={s.adjRow}><Text>Diskon</Text><Text>- {fmt(quo.discount)}</Text></View>
          )}
          {(quo.trade_in_amount || 0) > 0 && (
            <View style={s.adjRow}><Text>Trade-in AC Lama</Text><Text>- {fmt(quo.trade_in_amount)}</Text></View>
          )}
          {hasPph && (
            <>
              <View style={s.adjRow}><Text>Nilai Jasa (DPP)</Text><Text>{fmt(dpp)}</Text></View>
              <View style={[s.adjRow, { color: "#2f5ea3" }]}><Text>PPh 23 (2,5%) dipotong customer</Text><Text>- {fmt(quo.pph23_amount)}</Text></View>
            </>
          )}

          <View style={s.totalBar}>
            <Text style={s.totalLabel}>TOTAL PENAWARAN</Text>
            <Text style={s.totalVal}>{fmt(quo.total)}</Text>
          </View>
        </View>

        {/* Valid until warning */}
        <View wrap={false} style={s.validBox}>
          <Text style={s.validText}>
            ⏰ Penawaran ini berlaku hingga {fmtDate(quo.valid_until)}. Harga dapat berubah setelah masa berlaku habis.
          </Text>
        </View>

        {/* Catatan tambahan custom — hanya tampil jika notes BUKAN sekadar preset T&C */}
        {quo.notes && !_norm(quo.notes).includes(_PRESET_SIGNATURE) && (
          <View style={s.noteBox}>
            <Text style={s.noteTitle}>Catatan / Scope Pekerjaan</Text>
            <Text style={s.noteText}>{quo.notes}</Text>
          </View>
        )}

        {/* Syarat & Ketentuan */}
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

        {/* Footer: catatan kontak + tanda tangan sejajar */}
        <View wrap={false} style={s.footerRow}>
          <Text style={s.footerNote}>
            Pertanyaan? Hubungi kami via WA: +{companyPhone}{"\n"}
            Terima kasih telah mempercayakan kebutuhan AC Anda kepada {companyName}.
          </Text>
          <View style={s.signBlock}>
            <Text style={s.signPlace}>{fmtDate(quo.created_at)}</Text>
            <Text style={s.signName}>{companyName}</Text>
          </View>
        </View>

        <View style={s.pageFooter}>
          <Text style={s.pageFooterText}>Dokumen ini dibuat otomatis oleh sistem — {companyName}</Text>
        </View>

      </Page>
    </Document>
  );
}
