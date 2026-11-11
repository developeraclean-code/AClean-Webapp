import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const BLUE = "#1E5BA8";
const PALE = "#EFF6FF";
const s = StyleSheet.create({
  page: { paddingTop: 34, paddingHorizontal: 38, paddingBottom: 52, fontSize: 10, color: "#172033", fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 2, borderBottomColor: BLUE, paddingBottom: 10, marginBottom: 18 },
  brandRow: { flexDirection: "row", alignItems: "center" },
  logo: { width: 42, height: 42, objectFit: "contain", marginRight: 10 },
  brand: { fontSize: 15, fontFamily: "Helvetica-Bold", color: BLUE },
  brandSub: { fontSize: 7.5, color: "#64748B", marginTop: 3 },
  status: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 4, backgroundColor: PALE, color: BLUE, fontSize: 8, fontFamily: "Helvetica-Bold" },
  title: { textAlign: "center", color: BLUE, fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: 0.5, marginBottom: 4 },
  subtitle: { textAlign: "center", color: "#64748B", fontSize: 9, marginBottom: 16 },
  projectBox: { padding: 12, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#DCE4EF", borderRadius: 6, marginBottom: 14 },
  projectName: { color: "#12233E", fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 5 },
  projectMeta: { color: "#475569", fontSize: 9, lineHeight: 1.4 },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  metaCell: { width: "50%", paddingVertical: 6, paddingRight: 8, borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  label: { color: "#64748B", fontSize: 8, marginBottom: 3 },
  value: { color: "#172033", fontSize: 9.5, fontFamily: "Helvetica-Bold", lineHeight: 1.3 },
  section: { marginTop: 10, marginBottom: 5, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: "#DCE4EF", color: BLUE, fontSize: 9, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  paragraph: { color: "#263449", fontSize: 10, lineHeight: 1.55 },
  warningBox: { marginTop: 5, padding: 9, backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderRadius: 4 },
  warningLabel: { color: "#9A3412", fontSize: 8, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  warningText: { color: "#7C2D12", fontSize: 9.5, lineHeight: 1.4 },
  noteBox: { marginTop: 10, padding: 9, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 4 },
  noteText: { color: "#991B1B", fontSize: 9, lineHeight: 1.4 },
  footer: { position: "absolute", left: 38, right: 38, bottom: 24, borderTopWidth: 1, borderTopColor: "#E2E8F0", paddingTop: 6, color: "#64748B", fontSize: 7.5, textAlign: "center" },
  appendixTitle: { color: BLUE, fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 2, marginBottom: 3 },
  appendixSub: { color: "#64748B", textAlign: "center", fontSize: 8.5, marginBottom: 13 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  photoCard: { width: "48.5%", height: 310, borderWidth: 1, borderColor: "#DCE4EF", borderRadius: 5, padding: 7, marginBottom: 10, backgroundColor: "#FFFFFF" },
  photo: { width: "100%", height: 265, objectFit: "contain", backgroundColor: "#F8FAFC" },
  photoFallback: { width: "100%", height: 265, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center", padding: 12 },
  photoFallbackText: { color: "#64748B", fontSize: 9, textAlign: "center", lineHeight: 1.4 },
  photoCaption: { color: "#334155", fontSize: 8.5, marginTop: 6 },
});

const text = (value, fallback = "-") => String(value ?? "").trim() || fallback;

function formatDate(value, withTime = false) {
  if (!value) return "-";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("id-ID", withTime
    ? { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "long", year: "numeric" }).format(date);
}

function Header({ appSettings, logoUrl, status }) {
  const companyName = appSettings?.company_name || "AClean Service";
  const companyPhone = String(appSettings?.wa_number || appSettings?.company_phone || "6281289898937").replace(/[^\d+]/g, "");
  const companyAddress = appSettings?.company_addr || appSettings?.company_address || "Alam Sutera, Tangerang Selatan";
  return (
    <View style={s.header}>
      <View style={s.brandRow}>
        {logoUrl ? <Image src={logoUrl} style={s.logo} /> : null}
        <View>
          <Text style={s.brand}>{companyName}</Text>
          <Text style={s.brandSub}>Laporan pekerjaan proyek</Text>
          {(companyAddress || companyPhone) ? <Text style={s.brandSub}>{[companyAddress, companyPhone].filter(Boolean).join(" | ")}</Text> : null}
        </View>
      </View>
      <Text style={s.status}>{String(status || "PENDING").toUpperCase()}</Text>
    </View>
  );
}

function Footer({ projectName, reportDate }) {
  return <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `${projectName} | ${reportDate} | Halaman ${pageNumber} dari ${totalPages}`} />;
}

export default function ProjectDailyReportPDF({ report = {}, project = {}, appSettings = {}, logoUrl = null, photos = [] }) {
  const projectName = text(project.nama, "Proyek AClean");
  const reportDate = formatDate(report.tanggal);
  const team = [report.teknisi_name, ...(Array.isArray(report.helper_names) ? report.helper_names : [])].filter(Boolean).join(", ");
  const photoPages = [];
  for (let i = 0; i < photos.length; i += 4) photoPages.push(photos.slice(i, i + 4));

  return (
    <Document title={`Laporan ${projectName} - ${report.tanggal || ""}`} author={appSettings?.company_name || "AClean Service"}>
      <Page size="A4" style={s.page}>
        <Header appSettings={appSettings} logoUrl={logoUrl} status={report.status} />
        <Text style={s.title}>LAPORAN HARIAN PROYEK</Text>
        <Text style={s.subtitle}>Berita acara pekerjaan lapangan</Text>

        <View style={s.projectBox}>
          <Text style={s.projectName}>{projectName}</Text>
          <Text style={s.projectMeta}>{[project.lokasi, project.pic ? `PIC: ${project.pic}` : ""].filter(Boolean).join(" | ") || ""}</Text>
        </View>

        <View style={s.metaGrid}>
          <Info label="TANGGAL PEKERJAAN" value={reportDate} />
          <Info label="NO. ORDER / LAPORAN" value={report.order_id || report.id} />
          <Info label="TEKNISI & TIM" value={team} />
          <Info label="DICATAT OLEH" value={report.submitted_by} />
          <Info label="WAKTU SUBMIT" value={formatDate(report.submitted_at, true)} />
          <Info label="WAKTU VERIFIKASI" value={report.verified_at ? formatDate(report.verified_at, true) : "Belum diverifikasi"} />
        </View>

        <Text style={s.section}>Pekerjaan yang Dilakukan</Text>
        <Text style={s.paragraph}>{text(report.pekerjaan, "Belum ada rincian pekerjaan.")}</Text>

        {report.kendala ? (
          <View>
            <Text style={s.section}>Kendala / Catatan Lapangan</Text>
            <View style={s.warningBox}>
              <Text style={s.warningLabel}>CATATAN</Text>
              <Text style={s.warningText}>{report.kendala}</Text>
            </View>
          </View>
        ) : null}

        {report.status === "REVISION" && report.revision_note ? (
          <View style={s.noteBox}><Text style={s.noteText}>Catatan revisi: {report.revision_note}</Text></View>
        ) : null}

        <Text style={s.section}>Dokumentasi</Text>
        <Text style={s.paragraph}>{photos.length ? `${photos.length} foto terlampir pada halaman dokumentasi berikutnya.` : "Tidak ada foto yang dilampirkan pada laporan ini."}</Text>

        <Footer projectName={projectName} reportDate={reportDate} />
      </Page>

      {photoPages.map((pagePhotos, pageIndex) => (
        <Page size="A4" style={s.page} key={`photo-page-${pageIndex}`}>
          <Header appSettings={appSettings} logoUrl={logoUrl} status={report.status} />
          <Text style={s.appendixTitle}>DOKUMENTASI FOTO</Text>
          <Text style={s.appendixSub}>{projectName} | {reportDate} | Lampiran {pageIndex + 1} dari {photoPages.length}</Text>
          <View style={s.photoGrid}>
            {pagePhotos.map((photo) => (
              <View style={s.photoCard} key={`${pageIndex}-${photo.index}`} wrap={false}>
                {photo.src ? <Image src={photo.src} style={s.photo} /> : (
                  <View style={s.photoFallback}><Text style={s.photoFallbackText}>Foto {photo.index + 1} tidak dapat dimuat saat PDF dibuat.</Text></View>
                )}
                <Text style={s.photoCaption}>Foto {photo.index + 1}</Text>
              </View>
            ))}
          </View>
          <Footer projectName={projectName} reportDate={reportDate} />
        </Page>
      ))}
    </Document>
  );
}

function Info({ label, value }) {
  return (
    <View style={s.metaCell}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{text(value)}</Text>
    </View>
  );
}
