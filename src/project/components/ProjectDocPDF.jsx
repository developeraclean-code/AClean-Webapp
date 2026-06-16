// PDF dokumen Project (BAST / Surat Penerimaan / Pengiriman) — @react-pdf/renderer.
// TTD customer virtual (data URL PNG dari SignaturePad) di-embed via <Image>.
import React from "react";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { sumDocTotal, fmtRp, docColumns, docUraianLabel, docSig } from "../utils/constants.js";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: "#0f172a", fontFamily: "Helvetica" },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: "#1E5BA8", paddingBottom: 8, marginBottom: 12 },
  kopLeft: { flexDirection: "row", alignItems: "center", gap: 9 },
  brand: { fontSize: 15, fontFamily: "Helvetica-Bold", color: "#1E5BA8" },
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
  cNo: { width: "8%", textAlign: "center" }, cName: { width: "50%" }, cQty: { width: "20%" }, cKet: { width: "22%", textAlign: "right" },
  ckRow: { flexDirection: "row", marginBottom: 2 },
  signWrap: { flexDirection: "row", justifyContent: "space-between", marginTop: 36 },
  signBox: { width: "45%", alignItems: "center" },
  signImg: { height: 46, marginTop: 4, marginBottom: -6, objectFit: "contain" },
  signLine: { marginTop: 48, borderTopWidth: 1, borderTopColor: "#0f172a", paddingTop: 3, fontWeight: 700, width: "100%", textAlign: "center" },
});

export default function ProjectDocPDF({ doc, project, appSettings = {}, logoUrl = null }) {
  const isBA = (doc.jenis || "").includes("Berita");
  const items = doc.items || [];
  const cl = doc.checklist || [];
  const penerima = (doc.kepada || "").split("—")[0] || "Penerima";
  const companyName = appSettings?.company_name || "AClean Service";
  const companyPhone = String(appSettings?.wa_number || appSettings?.company_phone || "6281289898937").replace(/[^\d]/g, "") || "6281289898937";
  const companyAddr = appSettings?.company_addr || appSettings?.company_address || "Alam Sutera, Tangerang Selatan";
  const cols = docColumns(doc.jenis);
  const sig = docSig(doc.jenis, companyName);
  const sumCol = cols.find((c) => c.sum);
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headRow}>
          <View style={s.kopLeft}>
            {logoUrl ? <Image src={logoUrl} style={{ width: 42, height: 42, objectFit: "contain" }} /> : null}
            <View>
              <Text style={s.brand}>{companyName}</Text>
              <Text style={s.brandSub}>AC Installation & Service Professional</Text>
              <Text style={s.brandSub}>{companyAddr} · {companyPhone}</Text>
            </View>
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
          <Text style={s.para}><Text style={s.label}>{docUraianLabel(doc.jenis)}: </Text>{doc.uraian}</Text>
        ) : null}

        {items.length > 0 && (
          <View style={s.table}>
            <View style={s.tr}>
              <Text style={[s.th, s.cNo]}>No</Text>
              {cols.map((c) => (
                <Text key={c.key} style={[s.th, { width: `${c.w}%`, textAlign: c.align || "left" }]}>{c.label}</Text>
              ))}
            </View>
            {items.map((it, i) => (
              <View style={s.tr} key={i}>
                <Text style={[s.td, s.cNo]}>{i + 1}</Text>
                {cols.map((c) => (
                  <Text key={c.key} style={[s.td, { width: `${c.w}%`, textAlign: c.align || "left" }]}>{it[c.key] || ""}</Text>
                ))}
              </View>
            ))}
            {sumCol && sumDocTotal(items) > 0 && (
              <View style={s.tr}>
                <Text style={[s.td, { width: `${100 - sumCol.w}%`, textAlign: "right", fontFamily: "Helvetica-Bold" }]}>Total</Text>
                <Text style={[s.td, { width: `${sumCol.w}%`, textAlign: "right", fontFamily: "Helvetica-Bold" }]}>{fmtRp(sumDocTotal(items))}</Text>
              </View>
            )}
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
            <Text>{sig.lRole}{"\n"}{sig.lName}</Text>
            <Text style={s.signLine}>{doc.ttdTeknisi || "( ........... )"}</Text>
          </View>
          <View style={s.signBox}>
            <Text>{sig.rRole}{"\n"}{penerima}</Text>
            {doc.ttdCustomerImg ? <Image style={s.signImg} src={doc.ttdCustomerImg} /> : null}
            <Text style={s.signLine}>{doc.ttdCustomer && doc.ttdCustomer !== "(belum)" ? doc.ttdCustomer : "( ........... )"}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
