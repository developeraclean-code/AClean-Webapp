// PDF dokumen Project (BAST / Surat Penerimaan / Pengiriman) — @react-pdf/renderer.
// TTD customer virtual (data URL PNG dari SignaturePad) di-embed via <Image>.
import React from "react";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: "#0f172a", fontFamily: "Helvetica" },
  headRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: "#0f172a", paddingBottom: 8, marginBottom: 12 },
  brand: { fontSize: 15, fontWeight: 700, color: "#0a3a52" },
  brandSub: { fontSize: 8, color: "#475569", marginTop: 2 },
  metaR: { fontSize: 9, color: "#475569", textAlign: "right" },
  title: { textAlign: "center", fontSize: 13, marginTop: 4, marginBottom: 2, textTransform: "uppercase", letterSpacing: 1 },
  sub: { textAlign: "center", fontSize: 9, color: "#475569", marginBottom: 12 },
  twoCol: { flexDirection: "row", gap: 24, marginBottom: 8 },
  label: { fontWeight: 700 },
  para: { marginVertical: 6, lineHeight: 1.4 },
  table: { borderWidth: 1, borderColor: "#cbd5e1", marginVertical: 8 },
  tr: { flexDirection: "row" },
  th: { backgroundColor: "#e2e8f0", padding: 5, fontSize: 9, fontWeight: 700, borderRightWidth: 1, borderRightColor: "#cbd5e1", borderBottomWidth: 1, borderBottomColor: "#cbd5e1" },
  td: { padding: 5, fontSize: 9, borderRightWidth: 1, borderRightColor: "#cbd5e1", borderBottomWidth: 1, borderBottomColor: "#cbd5e1" },
  cNo: { width: "8%" }, cName: { width: "52%" }, cQty: { width: "18%" }, cKet: { width: "22%" },
  ckRow: { flexDirection: "row", marginBottom: 2 },
  signWrap: { flexDirection: "row", justifyContent: "space-between", marginTop: 36 },
  signBox: { width: "45%", alignItems: "center" },
  signImg: { height: 46, marginTop: 4, marginBottom: -6, objectFit: "contain" },
  signLine: { marginTop: 48, borderTopWidth: 1, borderTopColor: "#0f172a", paddingTop: 3, fontWeight: 700, width: "100%", textAlign: "center" },
});

export default function ProjectDocPDF({ doc, project }) {
  const isBA = (doc.jenis || "").includes("Berita");
  const items = doc.items || [];
  const cl = doc.checklist || [];
  const penerima = (doc.kepada || "").split("—")[0] || "Penerima";
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headRow}>
          <View>
            <Text style={s.brand}>AClean Service AC</Text>
            <Text style={s.brandSub}>Jl. Contoh No.123, Bekasi · 0812-8989-8937</Text>
          </View>
          <Text style={s.metaR}>Tanggal: {doc.tanggal || "-"}{"\n"}No: {doc.nomor || "-"}</Text>
        </View>

        <Text style={s.title}>{doc.jenis}</Text>
        <Text style={s.sub}>Project: {project?.nama || "-"}{doc.periode ? ` · Periode: ${doc.periode}` : ""}</Text>

        <View style={s.twoCol}>
          <Text><Text style={s.label}>Kepada:</Text>{"\n"}{doc.kepada || "-"}</Text>
          <Text><Text style={s.label}>Lokasi:</Text>{"\n"}{project?.lokasi || "-"}</Text>
        </View>

        {doc.uraian ? (
          <Text style={s.para}><Text style={s.label}>{isBA ? "Uraian Pekerjaan: " : "Keterangan: "}</Text>{doc.uraian}</Text>
        ) : null}

        {items.length > 0 && (
          <View style={s.table}>
            <View style={s.tr}>
              <Text style={[s.th, s.cNo]}>No</Text>
              <Text style={[s.th, s.cName]}>Nama Barang</Text>
              <Text style={[s.th, s.cQty]}>Jumlah</Text>
              <Text style={[s.th, s.cKet]}>Keterangan</Text>
            </View>
            {items.map((it, i) => (
              <View style={s.tr} key={i}>
                <Text style={[s.td, s.cNo]}>{i + 1}</Text>
                <Text style={[s.td, s.cName]}>{it.nama}</Text>
                <Text style={[s.td, s.cQty]}>{it.qty}{it.satuan ? " " + it.satuan : ""}</Text>
                <Text style={[s.td, s.cKet]}>{it.ket || ""}</Text>
              </View>
            ))}
          </View>
        )}

        {isBA && cl.length > 0 && (
          <View style={{ marginTop: 6 }}>
            <Text style={s.label}>Checklist Serah Terima:</Text>
            {cl.map((c, i) => (
              <View style={s.ckRow} key={i}><Text>{c.done ? "[v] " : "[ ] "}{c.item}</Text></View>
            ))}
          </View>
        )}

        <View style={s.signWrap}>
          <View style={s.signBox}>
            <Text>Diserahkan oleh,{"\n"}Teknisi AClean</Text>
            <Text style={s.signLine}>{doc.ttdTeknisi || "( ........... )"}</Text>
          </View>
          <View style={s.signBox}>
            <Text>Diterima oleh,{"\n"}{penerima}</Text>
            {doc.ttdCustomerImg ? <Image style={s.signImg} src={doc.ttdCustomerImg} /> : null}
            <Text style={s.signLine}>{doc.ttdCustomer && doc.ttdCustomer !== "(belum)" ? doc.ttdCustomer : "( ........... )"}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
