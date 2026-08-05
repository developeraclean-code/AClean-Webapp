import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

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

// Baris material_detail (jasa/repair/material/freon) → shape flat {desc,qty,uom,price,subtotal}
const matRowData = (m) => {
  const hSat = m.harga_satuan > 0 ? m.harga_satuan
    : (m.subtotal > 0 && m.jumlah > 0 ? Math.round(m.subtotal / m.jumlah) : 0);
  const sub = m.subtotal > 0 ? m.subtotal
    : (hSat > 0 && m.jumlah > 0 ? hSat * m.jumlah : 0);
  return { desc: m.nama || "", qty: m.jumlah, uom: m.satuan || "", price: hSat, subtotal: sub };
};

// ── Styles (Times New Roman, 1 tabel flat — konsisten dgn QuotationPDF.jsx) ──
const s = StyleSheet.create({
  page:       { padding: 40, fontFamily: "Times-Roman", fontSize: 10, color: "#22252b", backgroundColor: "#fff" },
  headerRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 14, borderBottom: "2.5px solid #22252b", marginBottom: 16 },
  brandRow:   { flexDirection: "row", alignItems: "center", gap: 10 },
  brandName:  { fontFamily: "Times-Bold", fontSize: 17, color: "#2f5ea3" },
  brandTag:   { fontSize: 8, color: "#5b5f66", marginTop: 2 },
  brandInfo:  { fontSize: 8, color: "#5b5f66", marginTop: 5, lineHeight: 1.5 },
  docKind:    { fontFamily: "Times-Bold", fontSize: 20, letterSpacing: 1, textAlign: "right" },
  docNo:      { fontSize: 9, color: "#5b5f66", marginTop: 5, border: "1px solid #cfd2d6", borderRadius: 3, padding: "3 9", textAlign: "right" },
  pageLabel:  { fontSize: 8, color: "#5b5f66", backgroundColor: "#f1f5f9", padding: "3 8", borderRadius: 4, alignSelf: "flex-end", marginBottom: 6 },

  metaRow:    { flexDirection: "row", justifyContent: "space-between", gap: 24, marginBottom: 14 },
  metaK:      { fontFamily: "Times-Bold", fontSize: 8, textTransform: "uppercase", letterSpacing: 0.5, color: "#5b5f66", marginBottom: 3 },
  metaV:      { fontFamily: "Times-Bold", fontSize: 11 },
  metaAddr:   { fontSize: 9, color: "#22252b", marginTop: 2, maxWidth: 220 },
  metaRight:  { alignItems: "flex-end" },

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

  statusRow:  { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  statusPill: { fontFamily: "Times-Bold", fontSize: 9, padding: "3 10", borderRadius: 99 },
  statusMeta: { fontSize: 9, color: "#5b5f66" },

  garansiBox: { border: "1px solid #cfd2d6", borderRadius: 4, padding: "8 12", marginTop: 12 },
  garansiText:{ fontSize: 9, lineHeight: 1.5 },

  payBox:     { border: "1px solid #cfd2d6", borderRadius: 4, padding: "9 12", marginTop: 12 },
  payTitle:   { fontFamily: "Times-Bold", fontSize: 8, textTransform: "uppercase", letterSpacing: 0.5, color: "#5b5f66", marginBottom: 4 },
  payBank:    { fontSize: 9, color: "#5b5f66" },
  payNum:     { fontFamily: "Times-Bold", fontSize: 10.5, marginTop: 1, marginBottom: 1 },
  payHolder:  { fontSize: 9, color: "#5b5f66" },
  payHint:    { fontSize: 8, color: "#94a3b8", marginTop: 4 },

  footerRow:  { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: 22 },
  footerNote: { fontSize: 9, color: "#5b5f66", lineHeight: 1.5, maxWidth: 280 },
  signBlock:  { alignItems: "center", minWidth: 150 },
  signPlace:  { fontSize: 10, marginBottom: 46 },
  signName:   { fontFamily: "Times-Bold", fontSize: 10, borderTop: "1px solid #22252b", paddingTop: 4 },
  pageFooter: { borderTop: "1px solid #cfd2d6", paddingTop: 8, marginTop: 16, textAlign: "center" },
  pageFooterText: { fontSize: 8, color: "#94a3b8" },

  sectionHead:{ backgroundColor: "#2f5ea3", padding: "7 12", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle:{ color: "#fff", fontFamily: "Times-Bold", fontSize: 10 },
  sectionSub: { color: "#dbe4f5", fontSize: 8, marginTop: 1 },
  sectionVal: { color: "#fff", fontFamily: "Times-Bold", fontSize: 11 },
  sectionBox: { marginBottom: 10, border: "1px solid #cfd2d6", overflow: "hidden" },
});

const STATUS_INFO = {
  PAID:        { label: "LUNAS",              bg: "#e6f4ec", fg: "#1f7a4d" },
  PARTIAL_PAID:{ label: "DP / CICILAN",        bg: "#fff7ed", fg: "#c2410c" },
  OVERDUE:     { label: "JATUH TEMPO",         bg: "#fbe9e7", fg: "#b3402f" },
  UNPAID:      { label: "MENUNGGU PEMBAYARAN", bg: "#fff7ed", fg: "#c2410c" },
};
function StatusPill({ status, due }) {
  const info = STATUS_INFO[status] || STATUS_INFO.UNPAID;
  return (
    <View style={s.statusRow}>
      <Text style={[s.statusPill, { backgroundColor: info.bg, color: info.fg }]}>{info.label}</Text>
      {due ? <Text style={s.statusMeta}>Jatuh tempo: {due}</Text> : null}
    </View>
  );
}

function PaymentInfoBox({ appSettings }) {
  return (
    <View style={s.payBox}>
      <Text style={s.payTitle}>Informasi Pembayaran</Text>
      <Text style={s.payBank}>Transfer Bank {appSettings.bank_name || "BCA"}</Text>
      <Text style={s.payNum}>{appSettings.bank_number || "8830883011"}</Text>
      <Text style={s.payHolder}>a.n. {appSettings.bank_holder || "Malda Retta"}</Text>
      <Text style={s.payHint}>Kirim bukti transfer via WhatsApp ke nomor di atas</Text>
    </View>
  );
}

function ItemRow({ no, desc, qty, uom, price, subtotal, include, bold }) {
  return (
    <View>
      <View style={s.tr}>
        <Text style={[s.td, { width: 26 }]}>{no}</Text>
        <Text style={[s.td, { flex: 1 }, bold ? { fontFamily: "Times-Bold" } : {}]}>{desc}</Text>
        <Text style={[s.td, { width: 34, textAlign: "right" }]}>{qty || "—"}</Text>
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
function TableHead() {
  return (
    <View style={s.thead}>
      <Text style={[s.th, { width: 26 }]}>No</Text>
      <Text style={[s.th, { flex: 1 }]}>Deskripsi</Text>
      <Text style={[s.th, { width: 34, textAlign: "right" }]}>Qty</Text>
      <Text style={[s.th, { width: 50 }]}>Uom</Text>
      <Text style={[s.th, { width: 76, textAlign: "right" }]}>Harga</Text>
      <Text style={[s.th, { width: 86, textAlign: "right" }]}>Subtotal</Text>
    </View>
  );
}

// ── Main Component ──
//
// Mode tunggal:    <InvoicePDF inv={...} />
// Mode gabung-multi-page (deprecated default):
//                   <InvoicePDF invList={[{inv, invoiceItems}, ...]} />
// Mode gabung-unified (1 halaman, section per pekerjaan, 1 total keseluruhan):
//                   <InvoicePDF invList={[...]} unified={true} />
export default function InvoicePDF({ inv, logoUrl, appSettings = {}, invoiceItems = [], portalLink = null, invList = null, unified = false }) {
  if (Array.isArray(invList) && invList.length > 0) {
    if (unified) {
      return (
        <Document>
          <MergedInvoicePage
            invList={invList.map(e => (e && e.inv ? e : { inv: e, invoiceItems: [] }))}
            logoUrl={logoUrl}
            appSettings={appSettings}
            portalLink={portalLink}
          />
        </Document>
      );
    }
    return (
      <Document>
        {invList.map((entry, idx) => {
          const e = entry && entry.inv ? entry : { inv: entry, invoiceItems: [] };
          return (
            <InvoicePage
              key={(e.inv?.id || "inv") + "-" + idx}
              inv={e.inv}
              logoUrl={logoUrl}
              appSettings={appSettings}
              invoiceItems={e.invoiceItems || []}
              portalLink={portalLink}
              pageIndex={idx}
              pageTotal={invList.length}
            />
          );
        })}
      </Document>
    );
  }
  return (
    <Document>
      <InvoicePage inv={inv} logoUrl={logoUrl} appSettings={appSettings} invoiceItems={invoiceItems} portalLink={portalLink} />
    </Document>
  );
}

function InvoicePage({ inv, logoUrl, appSettings = {}, invoiceItems = [], portalLink = null, pageIndex = null, pageTotal = null }) {
  const isAcSale = inv.invoice_type === "ac_unit_sale";

  const matDetails = (() => {
    const md = inv.materials_detail;
    if (!md) return [];
    if (Array.isArray(md)) return md;
    try { return JSON.parse(md); } catch { return []; }
  })();

  const unitCount = Array.isArray(inv.units) ? inv.units.length : (Number(inv.units) || 1);
  const perUnit   = unitCount > 0 ? Math.round((inv.labor || 0) / unitCount) : (inv.labor || 0);

  const companyName  = appSettings.company_name || "AClean Service";
  const companyPhone = String(appSettings.wa_number || "6281289898937").replace(/[^\d]/g, "") || "6281289898937";

  // ── Flat rows: AC-sale (unit+paket+addon) atau servis biasa (jasa+repair+material+freon) ──
  let rows = [];
  if (isAcSale) {
    const acUnitItems = invoiceItems.filter(i => i.item_type === "unit_ac");
    const paketItems  = invoiceItems.filter(i => i.item_type === "paket" || i.item_type === "jasa");
    const addonItems  = invoiceItems.filter(i => i.item_type === "addon" || i.item_type === "material");
    const paketSnap = inv.paket_pasang;
    const includeItems = Array.isArray(paketSnap?.include) ? paketSnap.include : null;
    rows = [...acUnitItems, ...paketItems, ...addonItems].map((item, i) => ({
      desc: item.description, qty: item.qty, uom: "Unit", price: item.unit_price,
      subtotal: item.subtotal || item.qty * item.unit_price || 0,
      include: (includeItems && paketItems[0] === item) ? includeItems : null,
    }));
  } else if (matDetails.length > 0) {
    const ordered = [
      ...matDetails.filter(m => detectKat(m) === "jasa"),
      ...matDetails.filter(m => detectKat(m) === "repair"),
      ...matDetails.filter(m => detectKat(m) === "mat"),
      ...matDetails.filter(m => detectKat(m) === "freon"),
    ];
    rows = ordered.map(matRowData);
  } else if ((inv.labor || 0) > 0 || (inv.material || 0) > 0) {
    if ((inv.labor || 0) > 0) rows.push({ desc: inv.service || "Jasa Servis AC", qty: unitCount, uom: "Unit", price: perUnit, subtotal: inv.labor || 0 });
    if ((inv.material || 0) > 0) rows.push({ desc: "Material & Freon", qty: null, uom: "", price: 0, subtotal: inv.material || 0 });
  }

  const hasPph = !!inv.pph23 && (inv.pph23_amount || 0) > 0;
  // DPP = nilai JASA (labor) saja + PPh — bukan total (jasa+material), supaya baris
  // "Nilai Jasa (DPP)" akurat saat invoice ada material-nya juga.
  const dpp = hasPph ? (inv.labor || 0) + (inv.pph23_amount || 0) : 0;
  const sisaBayar = (inv.remaining_amount || 0) > 0 ? inv.remaining_amount : Math.max(0, (inv.total || 0) - (inv.paid_amount || 0));
  const hasPageLabel = pageTotal && pageTotal > 1;

  return (
    <Page size="A4" style={s.page}>
      {hasPageLabel ? <Text style={s.pageLabel}>Invoice {pageIndex + 1} dari {pageTotal}</Text> : null}

      {/* Header */}
      <View style={s.headerRow}>
        <View style={s.brandRow}>
          {logoUrl ? <Image src={logoUrl} style={{ width: 42, height: 42, objectFit: "contain" }} /> : null}
          <View>
            <Text style={s.brandName}>{companyName}</Text>
            <Text style={s.brandTag}>Jasa Servis & Perawatan AC Profesional</Text>
            <Text style={s.brandInfo}>{appSettings.company_addr || ""}{"\n"}+{companyPhone}</Text>
          </View>
        </View>
        <View>
          <Text style={s.docKind}>INVOICE</Text>
          <Text style={s.docNo}>No. {inv.id}</Text>
        </View>
      </View>

      {/* Meta */}
      <View style={s.metaRow}>
        <View>
          <Text style={s.metaK}>Tagihan Kepada</Text>
          <Text style={s.metaV}>{inv.customer || "—"}</Text>
          {inv.address ? <Text style={s.metaAddr}>{inv.address}</Text> : null}
          <Text style={s.metaAddr}>{inv.phone || "—"} · {inv.service || "—"}</Text>
        </View>
        <View style={s.metaRight}>
          <Text style={s.metaK}>Tanggal</Text>
          <Text style={s.metaV}>{fmtDate(inv.created_at)}</Text>
          <Text style={[s.metaAddr, { marginTop: 8 }]}>No. Order: {inv.job_id}</Text>
          <Text style={s.metaAddr}>Jatuh tempo: {inv.due || "—"}</Text>
        </View>
      </View>

      {/* Tabel — 1 tabel flat */}
      <View style={s.table}>
        <TableHead />
        {rows.length === 0 ? (
          <View style={s.tr}><Text style={[s.td, { flex: 1, textAlign: "center", color: "#94a3b8", fontStyle: "italic" }]}>Belum ada item</Text></View>
        ) : rows.map((r, i) => <ItemRow key={i} no={i + 1} {...r} />)}

        {(inv.discount || 0) > 0 && (
          <View style={s.adjRow}><Text>Diskon</Text><Text>- {fmt(inv.discount)}</Text></View>
        )}
        {inv.trade_in && (inv.trade_in_amount || 0) > 0 && (
          <View style={s.adjRow}><Text>Trade-In Unit Lama</Text><Text>- {fmt(inv.trade_in_amount)}</Text></View>
        )}
        {hasPph && (
          <>
            <View style={s.adjRow}><Text>Nilai Jasa (DPP)</Text><Text>{fmt(dpp)}</Text></View>
            <View style={[s.adjRow, { color: "#2f5ea3" }]}><Text>PPh 23 (2,5%) dipotong customer</Text><Text>- {fmt(inv.pph23_amount)}</Text></View>
          </>
        )}

        <View style={s.totalBar}>
          <Text style={s.totalLabel}>{hasPph ? "DIBAYAR KE ACLEAN" : "TOTAL TAGIHAN"}</Text>
          <Text style={s.totalVal}>{fmt(inv.total)}</Text>
        </View>

        {(inv.paid_amount || 0) > 0 && inv.status !== "PAID" && (
          <>
            <View style={s.adjRow}><Text>DP / Sudah Dibayar</Text><Text>- {fmt(inv.paid_amount)}</Text></View>
            <View style={[s.totalBar, { backgroundColor: "#c2410c" }]}>
              <Text style={s.totalLabel}>SISA TAGIHAN</Text>
              <Text style={s.totalVal}>{fmt(sisaBayar)}</Text>
            </View>
          </>
        )}
      </View>

      <StatusPill status={inv.status} due={inv.due} />
      {inv.paid_at ? <Text style={[s.statusMeta, { marginTop: 3 }]}>Dibayar: {fmtDate(inv.paid_at)}</Text> : null}

      <PaymentInfoBox appSettings={appSettings} />

      {/* Garansi */}
      {inv.garansi_expires ? (
        <View style={s.garansiBox}>
          <Text style={s.garansiText}>Garansi Servis {inv.garansi_days || 30} Hari — berlaku sampai {inv.garansi_expires}. Jika AC bermasalah dalam masa garansi, hubungi kami tanpa biaya tambahan.</Text>
        </View>
      ) : null}

      {/* Footer */}
      <View wrap={false} style={s.footerRow}>
        <View style={{ maxWidth: 300 }}>
          {portalLink ? (
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 8, color: "#2f5ea3", fontFamily: "Times-Bold" }}>Portal Servis Anda (riwayat, foto & invoice):</Text>
              <Text style={{ fontSize: 8, color: "#2f5ea3", marginTop: 2 }}>{portalLink}</Text>
            </View>
          ) : null}
        </View>
        <View style={s.signBlock}>
          <Text style={s.signPlace}>{fmtDate(inv.created_at)}</Text>
          <Text style={s.signName}>{companyName}</Text>
        </View>
      </View>

      <View style={s.pageFooter}>
        <Text style={s.pageFooterText}>Dokumen ini dibuat otomatis oleh sistem — {companyName}</Text>
      </View>
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Merged Invoice — 1 halaman gabungan dengan section per pekerjaan
// ─────────────────────────────────────────────────────────────────────────────
function MergedInvoicePage({ invList, logoUrl, appSettings = {}, portalLink = null }) {
  const first = invList[0]?.inv || {};
  const customer = first.customer || "";
  const phone = first.phone || "";

  const totalAll = invList.reduce((s, e) => s + (Number(e.inv?.total) || 0), 0);
  const paidAll  = invList.reduce((s, e) => s + (Number(e.inv?.paid_amount) || 0), 0);
  const sisaAll  = invList.reduce((s, e) => {
    const inv = e.inv || {};
    if (inv.status === "PAID") return s;
    const sisa = Number(inv.remaining_amount) > 0 ? Number(inv.remaining_amount) : Number(inv.total) || 0;
    return s + sisa;
  }, 0);

  const dueDates = invList.map(e => e.inv?.due).filter(Boolean);
  const dueLatest = dueDates.length > 0 ? dueDates.sort((a, b) => new Date(b) - new Date(a))[0] : null;
  const garansiExpires = invList.map(e => e.inv?.garansi_expires).filter(Boolean);
  const garansiLatest = garansiExpires.length > 0 ? garansiExpires.sort((a, b) => new Date(b) - new Date(a))[0] : null;

  const allPaid = invList.every(e => e.inv?.status === "PAID");
  const aggStatus = allPaid ? "PAID" : (paidAll > 0 ? "PARTIAL_PAID" : "UNPAID");

  const allIds = invList.map(e => e.inv?.id).filter(Boolean);
  const mergedId = allIds.length === 2 ? allIds.join(" + ") : `${allIds[0]} +${allIds.length - 1} lainnya`;

  const companyName  = appSettings.company_name || "AClean Service";
  const companyPhone = String(appSettings.wa_number || "6281289898937").replace(/[^\d]/g, "") || "6281289898937";

  return (
    <Page size="A4" style={s.page}>
      {/* Header */}
      <View style={s.headerRow}>
        <View style={s.brandRow}>
          {logoUrl ? <Image src={logoUrl} style={{ width: 42, height: 42, objectFit: "contain" }} /> : null}
          <View>
            <Text style={s.brandName}>{companyName}</Text>
            <Text style={s.brandTag}>Jasa Servis & Perawatan AC Profesional</Text>
            <Text style={s.brandInfo}>{appSettings.company_addr || ""}{"\n"}+{companyPhone}</Text>
          </View>
        </View>
        <View>
          <Text style={s.docKind}>INVOICE</Text>
          <Text style={s.docNo}>{invList.length} Pekerjaan</Text>
        </View>
      </View>

      {/* Meta */}
      <View style={s.metaRow}>
        <View>
          <Text style={s.metaK}>Tagihan Kepada</Text>
          <Text style={s.metaV}>{customer}</Text>
          <Text style={s.metaAddr}>{phone || "—"} · {invList.length} pekerjaan servis</Text>
        </View>
        <View style={s.metaRight}>
          <Text style={s.metaK}>Tanggal</Text>
          <Text style={s.metaV}>{fmtDate(new Date())}</Text>
          <Text style={[s.metaAddr, { marginTop: 8 }]}>Nomor: {mergedId}</Text>
          {dueLatest ? <Text style={s.metaAddr}>Jatuh tempo: {dueLatest}</Text> : null}
        </View>
      </View>

      {/* Section per pekerjaan — tetap dipisah per job (perlu utk multi-invoice),
          tapi isi tiap section sekarang 1 tabel flat, bukan 4 sub-kategori. */}
      {invList.map((entry, idx) => {
        const inv = entry.inv || {};
        const tgl = inv.created_at ? fmtDate(inv.created_at) : "—";
        const unitCount = Array.isArray(inv.units) ? inv.units.length : (Number(inv.units) || 1);
        const matDetails = (() => {
          const md = inv.materials_detail;
          if (!md) return [];
          if (Array.isArray(md)) return md;
          try { return JSON.parse(md); } catch { return []; }
        })();
        const rows = matDetails.length > 0
          ? [
              ...matDetails.filter(m => detectKat(m) === "jasa"),
              ...matDetails.filter(m => detectKat(m) === "repair"),
              ...matDetails.filter(m => detectKat(m) === "mat"),
              ...matDetails.filter(m => detectKat(m) === "freon"),
            ].map(matRowData)
          : [
              ...((Number(inv.labor) || 0) > 0 ? [{ desc: inv.service || "Jasa Servis AC", qty: unitCount, uom: "Unit", price: 0, subtotal: Number(inv.labor) || 0 }] : []),
              ...((Number(inv.material) || 0) > 0 ? [{ desc: "Material & Freon", qty: null, uom: "", price: 0, subtotal: Number(inv.material) || 0 }] : []),
            ];

        return (
          <View key={idx} wrap={false} style={s.sectionBox}>
            <View style={s.sectionHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.sectionTitle}>Pekerjaan #{idx + 1} — {inv.service || "Servis AC"}</Text>
                <Text style={s.sectionSub}>{tgl} · {inv.id} · {unitCount} unit</Text>
              </View>
              <Text style={s.sectionVal}>{fmt(inv.total)}</Text>
            </View>
            {rows.length > 0 ? rows.map((r, i) => <ItemRow key={i} no={i + 1} {...r} />) : (
              <View style={s.tr}><Text style={[s.td, { flex: 1, color: "#94a3b8", fontStyle: "italic" }]}>Tidak ada rincian item</Text></View>
            )}
            {(Number(inv.discount) || 0) > 0 && (
              <View style={s.adjRow}><Text>Diskon</Text><Text>- {fmt(inv.discount)}</Text></View>
            )}
            {inv.status === "PAID" ? (
              <View style={{ padding: "4 12", backgroundColor: "#e6f4ec", borderTop: "1px solid #cfd2d6" }}>
                <Text style={{ fontSize: 8, color: "#1f7a4d", fontFamily: "Times-Bold" }}>Lunas — {inv.paid_at ? fmtDate(inv.paid_at) : ""}</Text>
              </View>
            ) : (Number(inv.paid_amount) || 0) > 0 ? (
              <View style={{ padding: "4 12", backgroundColor: "#fff7ed", borderTop: "1px solid #cfd2d6" }}>
                <Text style={{ fontSize: 8, color: "#c2410c", fontFamily: "Times-Bold" }}>
                  DP: {fmt(inv.paid_amount)} • Sisa: {fmt(inv.remaining_amount || (Number(inv.total) - Number(inv.paid_amount)))}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}

      {/* Total akumulasi */}
      <View style={{ marginTop: 4, marginBottom: 12, border: "2px solid #2f5ea3" }}>
        <View style={{ flexDirection: "row", padding: "8 14", borderBottom: "1px solid #cfd2d6" }}>
          <Text style={{ flex: 1, fontSize: 10, color: "#5b5f66" }}>Subtotal {invList.length} pekerjaan</Text>
          <Text style={{ fontSize: 10, fontFamily: "Times-Bold" }}>{fmt(totalAll)}</Text>
        </View>
        {paidAll > 0 && (
          <View style={{ flexDirection: "row", padding: "6 14" }}>
            <Text style={{ flex: 1, fontSize: 9, color: "#1f7a4d" }}>Sudah dibayar</Text>
            <Text style={{ fontSize: 9, color: "#1f7a4d", fontFamily: "Times-Bold" }}>- {fmt(paidAll)}</Text>
          </View>
        )}
        <View style={[s.totalBar, { marginTop: 0, backgroundColor: aggStatus === "PAID" ? "#1f7a4d" : "#2f5ea3" }]}>
          <Text style={s.totalLabel}>{aggStatus === "PAID" ? "TOTAL DIBAYAR" : "TOTAL TAGIHAN"}</Text>
          <Text style={s.totalVal}>{fmt(aggStatus === "PAID" ? totalAll : sisaAll)}</Text>
        </View>
      </View>

      <StatusPill status={aggStatus} due={dueLatest} />

      <PaymentInfoBox appSettings={appSettings} />

      {garansiLatest ? (
        <View style={s.garansiBox}>
          <Text style={s.garansiText}>Garansi servis — berlaku sampai {garansiLatest}. Jika AC bermasalah dalam masa garansi, hubungi kami tanpa biaya tambahan.</Text>
        </View>
      ) : null}

      <View wrap={false} style={s.footerRow}>
        <View style={{ maxWidth: 300 }}>
          {portalLink ? (
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 8, color: "#2f5ea3", fontFamily: "Times-Bold" }}>Portal Servis Anda (riwayat, foto & invoice):</Text>
              <Text style={{ fontSize: 8, color: "#2f5ea3", marginTop: 2 }}>{portalLink}</Text>
            </View>
          ) : null}
        </View>
        <View style={s.signBlock}>
          <Text style={s.signPlace}>{fmtDate(new Date())}</Text>
          <Text style={s.signName}>{companyName}</Text>
        </View>
      </View>

      <View style={s.pageFooter}>
        <Text style={s.pageFooterText}>Dokumen ini dibuat otomatis oleh sistem — {companyName}</Text>
      </View>
    </Page>
  );
}
