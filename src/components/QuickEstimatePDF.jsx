import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { QUICK_ESTIMATE_TERMS } from "../lib/quickEstimate.js";

const styles = StyleSheet.create({
  page: { padding: 38, paddingTop: 62, paddingBottom: 65, fontFamily: "Helvetica", color: "#172033", fontSize: 10 },
  brand: { fontSize: 20, fontWeight: 700, color: "#087f8c" },
  subtitle: { fontSize: 9, color: "#64748b", marginTop: 4 },
  title: { fontSize: 16, fontWeight: 700, marginTop: 24, marginBottom: 4 },
  note: { fontSize: 9, color: "#64748b", marginBottom: 15 },
  info: { flexDirection: "row", flexWrap: "wrap", marginBottom: 18 },
  infoItem: { width: "50%", marginBottom: 8 },
  label: { fontSize: 8, color: "#64748b", marginBottom: 3 },
  value: { fontSize: 10, fontWeight: 700 },
  tableHead: { flexDirection: "row", padding: 8, backgroundColor: "#e8f6f7", borderBottomWidth: 1, borderColor: "#b7dce0" },
  row: { flexDirection: "row", padding: 8, borderBottomWidth: 0.5, borderColor: "#dbe2ea" },
  desc: { width: "48%" }, qty: { width: "18%", textAlign: "right" }, price: { width: "17%", textAlign: "right" }, amount: { width: "17%", textAlign: "right" },
  total: { marginTop: 16, padding: 13, backgroundColor: "#e8f6f7", flexDirection: "row", justifyContent: "space-between", fontWeight: 700, fontSize: 14, color: "#087f8c" },
  termsTitle: { fontSize: 11, fontWeight: 700, marginTop: 24, marginBottom: 8 },
  term: { fontSize: 8.5, lineHeight: 1.45, marginBottom: 5, color: "#334155" },
  footer: { position: "absolute", bottom: 23, left: 38, right: 38, fontSize: 8, color: "#64748b", borderTopWidth: 0.5, borderColor: "#dbe2ea", paddingTop: 7 },
});

const rupiah = value => `Rp ${Number(value || 0).toLocaleString("id-ID")}`;

export default function QuickEstimatePDF({ estimate, customer, address, date, workLabel, documentTitle = `Estimasi Biaya ${workLabel}`, terms = QUICK_ESTIMATE_TERMS, footer = "Estimasi bukan penawaran final. Harga akhir mengikuti survei dan pemakaian aktual yang disetujui customer.", isManualOffer = false }) {
  return (
    <Document title={`Estimasi AClean - ${customer || "Pelanggan"}`}>
      <Page size="A4" style={styles.page}>
        <Text fixed style={{ position: "absolute", top: 24, left: 38, fontSize: 9, color: "#64748b" }} render={({ pageNumber, totalPages }) => `${documentTitle} · ${customer || "Pelanggan"} · ${pageNumber}/${totalPages}`} />
        <Text style={styles.brand}>AClean Service</Text>
        <Text style={styles.subtitle}>Penawaran jasa dan material AC · 0812-8989-8937 · aclean.id</Text>
        <Text style={styles.title}>{documentTitle}</Text>
        <Text style={styles.note}>Dokumen estimasi cepat di luar quotation resmi AClean.</Text>
        <View style={styles.info}>
          <View style={styles.infoItem}><Text style={styles.label}>CUSTOMER</Text><Text style={styles.value}>{customer || "—"}</Text></View>
          <View style={styles.infoItem}><Text style={styles.label}>TANGGAL</Text><Text style={styles.value}>{date || "—"}</Text></View>
          <View style={styles.infoItem}><Text style={styles.label}>ALAMAT / LOKASI</Text><Text style={styles.value}>{address || "—"}</Text></View>
        </View>
        <View style={styles.tableHead}>
          <Text style={[styles.desc, { fontWeight: 700 }]}>Rincian pekerjaan</Text>
          <Text style={[styles.qty, { fontWeight: 700 }]}>Jumlah</Text>
          <Text style={[styles.price, { fontWeight: 700 }]}>Harga</Text>
          <Text style={[styles.amount, { fontWeight: 700 }]}>Subtotal</Text>
        </View>
        {estimate.rows.map((row, index) => (
          <View key={`${row.label}-${index}`} style={styles.row} wrap={false}>
            <Text style={styles.desc}>{row.label}</Text>
            <Text style={styles.qty}>{row.qty} {row.unit}</Text>
            <Text style={styles.price}>{rupiah(row.unitPrice)}</Text>
            <Text style={styles.amount}>{rupiah(row.total)}</Text>
          </View>
        ))}
        <View style={styles.total} wrap={false}><Text>{isManualOffer ? "TOTAL PENAWARAN" : "PERKIRAAN TOTAL"}</Text><Text>{rupiah(estimate.total)}</Text></View>
        {terms.length > 0 && <Text style={styles.termsTitle} minPresenceAhead={45}>Ketentuan & catatan</Text>}
        {terms.map((term, index) => <Text key={index} style={styles.term}>• {term}</Text>)}
        <Text fixed style={styles.footer}>{footer}</Text>
      </Page>
    </Document>
  );
}
