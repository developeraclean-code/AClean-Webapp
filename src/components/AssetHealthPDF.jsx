// Laporan Kesehatan Aset AC per klien maintenance — dikirim ke PIC klien sebagai
// bukti nilai kontrak (renewal/upsell). Semua data DIHITUNG di caller
// (AssetHealthPDFModule) — komponen ini murni render.
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { HEALTH_META } from "../lib/maintenanceHealth.js";

const BLUE = "#1E5BA8";
// Label dari HEALTH_META (satu sumber, anti-drift dgn layar); warna KHUSUS cetak —
// dark-text di kertas putih, bukan token layar dark-mode.
const PRINT_COLOR = { SEHAT: "#16a34a", PERHATIAN: "#d97706", BERMASALAH: "#dc2626", NO_DATA: "#6b7280" };
const HEALTH_PDF = Object.fromEntries(
  Object.entries(HEALTH_META).map(([k, m]) => [k, { label: m.label, color: PRINT_COLOR[k] || "#6b7280" }])
);

const s = StyleSheet.create({
  page:      { padding: 34, fontFamily: "Helvetica", fontSize: 9, color: "#1e293b", backgroundColor: "#fff" },
  header:    { borderRadius: 6, border: `2px solid ${BLUE}`, marginBottom: 12, padding: "12 16", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand:     { fontSize: 16, fontFamily: "Helvetica-Bold", color: BLUE },
  brandSub:  { fontSize: 8, color: "#6b7280", marginTop: 2 },
  docTitle:  { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#1e293b", textAlign: "right" },
  docSub:    { fontSize: 8, color: "#6b7280", textAlign: "right", marginTop: 2 },
  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", color: BLUE, marginBottom: 5, marginTop: 8 },
  sumRow:    { flexDirection: "row", gap: 8, marginBottom: 4 },
  sumBox:    { flex: 1, border: "1px solid #e2e8f0", borderRadius: 5, padding: "6 8", alignItems: "center" },
  sumNum:    { fontSize: 14, fontFamily: "Helvetica-Bold" },
  sumLbl:    { fontSize: 7, color: "#6b7280", marginTop: 2 },
  th:        { flexDirection: "row", backgroundColor: BLUE, borderRadius: 3, padding: "4 6" },
  thText:    { color: "#fff", fontSize: 8, fontFamily: "Helvetica-Bold" },
  tr:        { flexDirection: "row", borderBottom: "1px solid #e2e8f0", padding: "4 6", alignItems: "flex-start" },
  cKode:     { width: "13%" }, cLok: { width: "22%" }, cSpek: { width: "16%" },
  cSehat:    { width: "15%" }, cTgl: { width: "12%" }, cCatatan: { width: "22%" },
  rekBox:    { border: "1px solid #fca5a5", backgroundColor: "#fef2f2", borderRadius: 5, padding: "6 10", marginBottom: 4 },
  rekBoxY:   { border: "1px solid #fcd34d", backgroundColor: "#fffbeb", borderRadius: 5, padding: "6 10", marginBottom: 4 },
  footer:    { position: "absolute", bottom: 20, left: 34, right: 34, borderTop: "1px solid #e2e8f0", paddingTop: 6, flexDirection: "row", justifyContent: "space-between" },
  footText:  { fontSize: 7, color: "#94a3b8" },
});

export default function AssetHealthPDF({ client, rows, summary, kandidat, periode, generatedAt, appName = "AClean Service" }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.brand}>{appName}</Text>
            <Text style={s.brandSub}>Jasa Servis & Perawatan AC Profesional</Text>
          </View>
          <View>
            <Text style={s.docTitle}>LAPORAN KESEHATAN ASET AC</Text>
            <Text style={s.docSub}>{client?.name || "-"}</Text>
            <Text style={s.docSub}>Periode data: {periode || "-"} · Dicetak: {generatedAt}</Text>
          </View>
        </View>

        {/* Ringkasan */}
        <View style={s.sumRow}>
          <View style={s.sumBox}>
            <Text style={[s.sumNum, { color: "#1e293b" }]}>{rows.length}</Text>
            <Text style={s.sumLbl}>TOTAL UNIT</Text>
          </View>
          {["SEHAT", "PERHATIAN", "BERMASALAH", "NO_DATA"].map(k => (
            <View key={k} style={s.sumBox}>
              <Text style={[s.sumNum, { color: HEALTH_PDF[k].color }]}>{summary[k] || 0}</Text>
              <Text style={s.sumLbl}>{HEALTH_PDF[k].label.toUpperCase()}</Text>
            </View>
          ))}
        </View>

        {/* Rekomendasi tindakan */}
        {kandidat.length > 0 && (
          <View>
            <Text style={s.sectionTitle}>REKOMENDASI TINDAKAN</Text>
            {kandidat.map((r, i) => (
              <View key={i} style={r.level === "GANTI" ? s.rekBox : s.rekBoxY} wrap={false}>
                <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: r.level === "GANTI" ? "#dc2626" : "#d97706" }}>
                  {r.unit.unit_code}{r.unit.location ? ` — ${r.unit.location}` : ""} · {r.level === "GANTI" ? "Rekomendasi Ganti Unit / Test Press" : "Perlu Pemantauan Ketat"}
                </Text>
                <Text style={{ fontSize: 8, color: "#374151", marginTop: 2 }}>{r.reasons.join(" · ")}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Tabel unit */}
        <Text style={s.sectionTitle}>KONDISI SEMUA UNIT</Text>
        <View style={s.th} fixed>
          <Text style={[s.thText, s.cKode]}>Kode</Text>
          <Text style={[s.thText, s.cLok]}>Lokasi</Text>
          <Text style={[s.thText, s.cSpek]}>Merk / PK</Text>
          <Text style={[s.thText, s.cSehat]}>Kesehatan</Text>
          <Text style={[s.thText, s.cTgl]}>Servis Akhir</Text>
          <Text style={[s.thText, s.cCatatan]}>Catatan</Text>
        </View>
        {rows.map((r, i) => {
          const hp = HEALTH_PDF[r.health.key] || HEALTH_PDF.NO_DATA;
          return (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={[s.cKode, { fontFamily: "Helvetica-Bold" }]}>{r.unit.unit_code}</Text>
              <Text style={s.cLok}>{r.unit.location || "-"}</Text>
              <Text style={s.cSpek}>{[r.unit.brand, r.unit.capacity_pk ? r.unit.capacity_pk + "PK" : ""].filter(Boolean).join(" ") || "-"}</Text>
              <Text style={[s.cSehat, { color: hp.color, fontFamily: "Helvetica-Bold" }]}>{hp.label}</Text>
              <Text style={s.cTgl}>{r.lastService || "-"}</Text>
              <Text style={[s.cCatatan, { color: "#6b7280" }]}>{r.note || "-"}</Text>
            </View>
          );
        })}

        <View style={s.footer} fixed>
          <Text style={s.footText}>Dibuat otomatis dari riwayat servis {appName}</Text>
          <Text style={s.footText} render={({ pageNumber, totalPages }) => `Hal ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
