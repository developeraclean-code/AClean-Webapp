// PDF dokumen finansial & rekap Project dengan KOP SURAT AClean.
// type: "KWITANSI" | "INVOICE" | "REKAP". @react-pdf/renderer.
import React from "react";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

const BLUE = "#1E5BA8";
const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: "#1e293b", fontFamily: "Helvetica" },
  kop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: BLUE, paddingBottom: 10, marginBottom: 14 },
  kopLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  brand: { fontSize: 17, fontFamily: "Helvetica-Bold", color: BLUE },
  brandSub: { fontSize: 8, color: "#64748b", marginTop: 2 },
  badge: { backgroundColor: BLUE, color: "#fff", padding: "5 12", borderRadius: 4, fontSize: 11, fontFamily: "Helvetica-Bold" },
  metaR: { fontSize: 8.5, color: "#475569", textAlign: "right", marginTop: 6 },
  title: { textAlign: "center", fontSize: 14, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2, color: BLUE },
  sub: { textAlign: "center", fontSize: 9, color: "#64748b", marginBottom: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  label: { color: "#64748b" },
  val: { fontFamily: "Helvetica-Bold" },
  amountBox: { backgroundColor: "#eff6ff", border: `1px solid ${BLUE}33`, borderRadius: 6, padding: "10 14", marginVertical: 12 },
  amountVal: { fontSize: 18, fontFamily: "Helvetica-Bold", color: BLUE },
  terbilang: { fontSize: 9.5, fontStyle: "italic", color: "#334155", marginTop: 4 },
  thead: { flexDirection: "row", backgroundColor: BLUE, borderRadius: "3 3 0 0" },
  th: { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8.5, padding: "7 8", textTransform: "uppercase" },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  td: { fontSize: 9, padding: "6 8" },
  totalBox: { backgroundColor: BLUE, borderRadius: 6, padding: "10 14", marginTop: 6, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLbl: { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 11 },
  totalVal: { color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 14 },
  secTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: BLUE, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  baCard: { border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, marginBottom: 8 },
  signWrap: { flexDirection: "row", justifyContent: "space-between", marginTop: 40 },
  signBox: { width: "45%", alignItems: "center" },
  signLine: { marginTop: 44, borderTopWidth: 1, borderTopColor: "#1e293b", paddingTop: 3, fontFamily: "Helvetica-Bold", width: "100%", textAlign: "center" },
  foot: { position: "absolute", bottom: 24, left: 40, right: 40, textAlign: "center", fontSize: 7.5, color: "#94a3b8", borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 6 },
});

// Logo AClean (data URL) untuk kop surat — cache 1×.
let _logoCache;
export async function loadLogo() {
  if (_logoCache !== undefined) return _logoCache;
  try {
    const r = await fetch("/aclean-logo.png");
    if (!r.ok) { _logoCache = null; return null; }
    const blob = await r.blob();
    return await new Promise((res) => {
      const rd = new FileReader();
      rd.onload = () => { _logoCache = rd.result; res(rd.result); };
      rd.onerror = () => { _logoCache = null; res(null); };
      rd.readAsDataURL(blob);
    });
  } catch { _logoCache = null; return null; }
}

const rp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const fmtTgl = (d) => { if (!d) return "-"; try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }); } catch { return d; } };

// Angka → kata (Bahasa Indonesia)
function terbilang(n) {
  n = Math.floor(Number(n) || 0);
  if (n === 0) return "nol";
  const sat = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
  const f = (x) => {
    if (x < 12) return sat[x];
    if (x < 20) return f(x - 10) + " belas";
    if (x < 100) return f(Math.floor(x / 10)) + " puluh" + (x % 10 ? " " + f(x % 10) : "");
    if (x < 200) return "seratus" + (x - 100 ? " " + f(x - 100) : "");
    if (x < 1000) return f(Math.floor(x / 100)) + " ratus" + (x % 100 ? " " + f(x % 100) : "");
    if (x < 2000) return "seribu" + (x - 1000 ? " " + f(x - 1000) : "");
    if (x < 1000000) return f(Math.floor(x / 1000)) + " ribu" + (x % 1000 ? " " + f(x % 1000) : "");
    if (x < 1000000000) return f(Math.floor(x / 1000000)) + " juta" + (x % 1000000 ? " " + f(x % 1000000) : "");
    return f(Math.floor(x / 1000000000)) + " miliar" + (x % 1000000000 ? " " + f(x % 1000000000) : "");
  };
  return f(n).replace(/\s+/g, " ").trim();
}

function Kop({ companyName, companyAddr, companyPhone, logoUrl, badge }) {
  return (
    <View style={s.kop}>
      <View style={s.kopLeft}>
        {logoUrl ? <Image src={logoUrl} style={{ width: 46, height: 46, objectFit: "contain" }} /> : null}
        <View>
          <Text style={s.brand}>{companyName}</Text>
          <Text style={s.brandSub}>AC Installation & Service Professional</Text>
          <Text style={s.brandSub}>{companyAddr} · {companyPhone}</Text>
        </View>
      </View>
      {badge ? <Text style={s.badge}>{badge}</Text> : null}
    </View>
  );
}

export default function ProjectPaperPDF({ type, project = {}, appSettings = {}, logoUrl = null, kwitansi = null, invoice = null, rekap = null }) {
  const companyName = appSettings?.company_name || "AClean Service";
  const companyPhone = String(appSettings?.wa_number || appSettings?.company_phone || "6281289898937").replace(/[^\d]/g, "") || "6281289898937";
  const companyAddr = appSettings?.company_addr || appSettings?.company_address || "Alam Sutera, Tangerang Selatan";
  const kop = { companyName, companyAddr, companyPhone, logoUrl };

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {type === "KWITANSI" && kwitansi && <KwitansiBody kop={kop} project={project} k={kwitansi} companyName={companyName} />}
        {type === "INVOICE" && invoice && <InvoiceBody kop={kop} project={project} inv={invoice} companyName={companyName} />}
        {type === "REKAP" && rekap && <RekapBody kop={kop} project={project} r={rekap} />}
        <Text style={s.foot} fixed>{companyName} · {companyAddr} · {companyPhone} — dokumen ini sah tanpa tanda tangan basah.</Text>
      </Page>
    </Document>
  );
}

function KwitansiBody({ kop, project, k, companyName }) {
  return (
    <>
      <Kop {...kop} badge={k.nomor || "KWITANSI"} />
      <Text style={s.title}>Kwitansi Pembayaran</Text>
      <Text style={s.sub}>Project: {project.nama || "-"}{project.lokasi ? ` · ${project.lokasi}` : ""}</Text>
      <View style={s.row}><Text style={s.label}>No. Kwitansi</Text><Text style={s.val}>{k.nomor || "-"}</Text></View>
      <View style={s.row}><Text style={s.label}>Tanggal</Text><Text style={s.val}>{fmtTgl(k.tanggal)}</Text></View>
      <View style={s.row}><Text style={s.label}>Telah terima dari</Text><Text style={s.val}>{k.customer || "-"}</Text></View>
      <View style={s.row}><Text style={s.label}>Untuk pembayaran</Text><Text style={s.val}>{k.ket || "Pembayaran project"}</Text></View>
      <View style={s.amountBox}>
        <Text style={s.label}>Jumlah diterima</Text>
        <Text style={s.amountVal}>{rp(k.jumlah)}</Text>
        <Text style={s.terbilang}>Terbilang: {terbilang(k.jumlah)} rupiah</Text>
      </View>
      <View style={s.signWrap}>
        <View style={s.signBox} />
        <View style={s.signBox}>
          <Text>Hormat kami,</Text>
          <Text style={s.signLine}>{companyName}</Text>
        </View>
      </View>
    </>
  );
}

function InvoiceBody({ kop, project, inv, companyName }) {
  return (
    <>
      <Kop {...kop} badge={inv.nomor || "INVOICE"} />
      <Text style={s.title}>Invoice Project</Text>
      <Text style={s.sub}>Project: {project.nama || "-"}{project.lokasi ? ` · ${project.lokasi}` : ""}</Text>
      <View style={s.row}><Text style={s.label}>No. Invoice</Text><Text style={s.val}>{inv.nomor || "-"}</Text></View>
      <View style={s.row}><Text style={s.label}>Tanggal</Text><Text style={s.val}>{fmtTgl(inv.tanggal)}</Text></View>
      <View style={s.row}><Text style={s.label}>Kepada</Text><Text style={s.val}>{inv.customer || "-"}</Text></View>

      <Text style={s.secTitle}>Pembayaran Diterima (DP / Termin)</Text>
      <View style={s.thead}>
        <Text style={[s.th, { flex: 2 }]}>Tanggal</Text>
        <Text style={[s.th, { flex: 4 }]}>Keterangan</Text>
        <Text style={[s.th, { flex: 3, textAlign: "right" }]}>Jumlah</Text>
      </View>
      {(inv.dpList || []).length === 0 ? (
        <View style={s.tr}><Text style={[s.td, { flex: 1, color: "#94a3b8" }]}>Belum ada pembayaran</Text></View>
      ) : (inv.dpList || []).map((d, i) => (
        <View key={i} style={[s.tr, i % 2 ? { backgroundColor: "#f8fafc" } : {}]}>
          <Text style={[s.td, { flex: 2 }]}>{fmtTgl(d.tanggal)}</Text>
          <Text style={[s.td, { flex: 4 }]}>{d.ket || "-"}</Text>
          <Text style={[s.td, { flex: 3, textAlign: "right" }]}>{rp(d.jumlah)}</Text>
        </View>
      ))}

      <View style={{ marginTop: 12 }}>
        <View style={s.row}><Text style={s.label}>Nilai Kontrak</Text><Text style={s.val}>{rp(inv.nilai)}</Text></View>
        <View style={s.row}><Text style={s.label}>Total Diterima</Text><Text style={[s.val, { color: "#16a34a" }]}>{rp(inv.dpTotal)}</Text></View>
      </View>
      <View style={s.totalBox}>
        <Text style={s.totalLbl}>SISA TAGIHAN</Text>
        <Text style={s.totalVal}>{rp(inv.sisa)}</Text>
      </View>
    </>
  );
}

function RekapBody({ kop, project, r }) {
  return (
    <>
      <Kop {...kop} badge="REKAP" />
      <Text style={s.title}>Laporan Progres Proyek</Text>
      <Text style={s.sub}>{project.nama || "-"}{project.lokasi ? ` · ${project.lokasi}` : ""}</Text>
      <View style={s.row}><Text style={s.label}>Status</Text><Text style={s.val}>{project.status || "-"} · {project.progress || 0}%</Text></View>
      <View style={s.row}><Text style={s.label}>Periode</Text><Text style={s.val}>{fmtTgl(project.mulai)} → {fmtTgl(project.target)}</Text></View>

      <Text style={s.secTitle}>Berita Acara Harian ({(r.beritaAcara || []).length})</Text>
      {(r.beritaAcara || []).length === 0 ? (
        <Text style={{ fontSize: 9, color: "#94a3b8" }}>Belum ada berita acara terverifikasi.</Text>
      ) : (r.beritaAcara || []).map((b, i) => (
        <View key={i} style={s.baCard}>
          <View style={s.row}>
            <Text style={s.val}>{fmtTgl(b.tanggal)}</Text>
            <Text style={s.label}>{b.teknisi_name || "-"}{(b.helper_names || []).length ? ` + ${b.helper_names.join(", ")}` : ""}</Text>
          </View>
          <Text style={{ fontSize: 9.5, marginTop: 3 }}>{b.pekerjaan || "-"}</Text>
          {b.kendala ? <Text style={{ fontSize: 9, color: "#b45309", marginTop: 2 }}>Kendala: {b.kendala}</Text> : null}
        </View>
      ))}

      {(r.usageSummary || []).length > 0 && (
        <>
          <Text style={s.secTitle}>Pemakaian Material</Text>
          <View style={s.thead}>
            <Text style={[s.th, { flex: 4 }]}>Material</Text>
            <Text style={[s.th, { flex: 2, textAlign: "right" }]}>Jumlah</Text>
          </View>
          {(r.usageSummary || []).map((u, i) => (
            <View key={i} style={[s.tr, i % 2 ? { backgroundColor: "#f8fafc" } : {}]}>
              <Text style={[s.td, { flex: 4 }]}>{u.nama}</Text>
              <Text style={[s.td, { flex: 2, textAlign: "right" }]}>{u.qty}{u.satuan ? ` ${u.satuan}` : ""}</Text>
            </View>
          ))}
        </>
      )}
    </>
  );
}
