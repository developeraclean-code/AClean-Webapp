import React from "react";

// Preview format PDF-like (kertas A4) untuk Surat Penerimaan/Pengiriman & Berita Acara.
export default function DocPaper({ doc, project }) {
  const isBA = doc.jenis.includes("Berita");
  const cl = doc.checklist || [];
  const allDone = cl.length && cl.every((c) => c.done);
  return (
    <div style={{ background: "#f8fafc", color: "#0f172a", borderRadius: 8, padding: "28px 30px", fontSize: 12.5, lineHeight: 1.55 }}>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "2px solid #0f172a", paddingBottom: 10, marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: "#0a3a52" }}>
          AClean Service AC
          <small style={{ display: "block", fontWeight: 400, color: "#475569", fontSize: 10.5 }}>Jl. Contoh No.123, Bekasi · 0812-xxxx-xxxx</small>
        </div>
        <div style={{ textAlign: "right", fontSize: 11, color: "#475569" }}>
          Tanggal: {doc.tanggal}<br />No: {doc.nomor}
        </div>
      </div>
      <h4 style={{ textAlign: "center", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.04em", margin: "6px 0 2px" }}>{doc.jenis}</h4>
      <div style={{ textAlign: "center", color: "#475569", marginBottom: 14, fontSize: 11 }}>
        Project: {project?.nama || "-"}{doc.periode ? ` · Periode: ${doc.periode}` : ""}
      </div>
      <div style={{ display: "flex", gap: 24, marginBottom: 8 }}>
        <div><b>Kepada:</b><br />{doc.kepada}</div>
        <div><b>Lokasi:</b><br />{project?.lokasi || "-"}</div>
      </div>
      {doc.uraian && (
        <p style={{ margin: "6px 0" }}>
          <b>{isBA ? "Uraian Pekerjaan:" : "Keterangan:"}</b> {doc.uraian}
        </p>
      )}
      {doc.items?.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0" }}>
          <thead><tr>
            <th style={paperTh}>No</th><th style={paperTh}>Nama Barang</th><th style={paperTh}>Jumlah</th><th style={paperTh}>Keterangan</th>
          </tr></thead>
          <tbody>{doc.items.map((it, i) => (
            <tr key={i}>
              <td style={paperTd}>{i + 1}</td>
              <td style={paperTd}>{it.nama}</td>
              <td style={paperTd}>{it.qty}{it.satuan ? " " + it.satuan : ""}</td>
              <td style={paperTd}>{it.ket || ""}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {isBA && cl.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <b>Checklist Serah Terima:</b>
          <table style={{ width: "100%", borderCollapse: "collapse", margin: "4px 0" }}>
            <tbody>{cl.map((c, i) => (
              <tr key={i}>
                <td style={{ ...paperTd, width: 30 }}>{c.done ? "✔" : "☐"}</td>
                <td style={paperTd}>{c.item}</td>
              </tr>
            ))}</tbody>
          </table>
          {!allDone && <div style={{ color: "#b45309", fontSize: 11, marginTop: 4 }}>⚠️ Lengkapi semua poin sebelum TTD customer.</div>}
        </div>
      )}
      {isBA && doc.foto > 0 && (
        <div style={{ marginTop: 6 }}>
          <b>Dokumentasi Foto:</b>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginTop: 8 }}>
            {Array.from({ length: Math.min(4, doc.foto) }).map((_, i) => (
              <div key={i} style={{ aspectRatio: "4/3", background: "#e2e8f0", border: "1px solid #cbd5e1", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 10 }}>foto</div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28 }}>
        <div style={{ textAlign: "center", width: "45%" }}>
          <div>Diserahkan oleh,<br />Teknisi AClean</div>
          <div style={{ marginTop: 54, borderTop: "1px solid #0f172a", paddingTop: 4, fontWeight: 700 }}>{doc.ttdTeknisi}</div>
        </div>
        <div style={{ textAlign: "center", width: "45%" }}>
          <div>Diterima oleh,<br />{(doc.kepada || "").split("—")[0]}</div>
          {doc.ttdCustomerImg && <img alt="ttd" src={doc.ttdCustomerImg} style={{ height: 46, display: "block", margin: "6px auto -8px" }} />}
          <div style={{ marginTop: 54, borderTop: "1px solid #0f172a", paddingTop: 4, fontWeight: 700 }}>{doc.ttdCustomer}</div>
        </div>
      </div>
    </div>
  );
}

const paperTh = { border: "1px solid #cbd5e1", padding: "6px 8px", background: "#e2e8f0", color: "#0f172a", fontSize: 12 };
const paperTd = { border: "1px solid #cbd5e1", padding: "6px 8px", color: "#0f172a", fontSize: 12 };
