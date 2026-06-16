import React from "react";
import { sumDocTotal, fmtRp, docColumns, docUraianLabel, docSig } from "../utils/constants.js";

// Preview format PDF-like (kertas A4) untuk semua jenis dokumen project.
export default function DocPaper({ doc, project }) {
  const isBA = doc.jenis.includes("Berita");
  const cl = doc.checklist || [];
  const grandTotal = sumDocTotal(doc.items);
  const allDone = cl.length && cl.every((c) => c.done);
  const cols = docColumns(doc.jenis);
  const sig = docSig(doc.jenis);
  const penerima = (doc.kepada || "").split("—")[0];
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
      <h4 style={{ textAlign: "center", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.04em", margin: "6px 0 14px" }}>{doc.jenis}</h4>
      <div style={{ marginBottom: 10, lineHeight: 1.7 }}>
        <div><b>Nama Customer:</b> {project?.nama || "-"}</div>
        <div><b>Lokasi:</b> {project?.lokasi || "-"}</div>
        <div><b>Kepada:</b> {doc.kepada || "-"}</div>
        {doc.periode ? <div><b>Periode:</b> {doc.periode}</div> : null}
      </div>
      {doc.uraian && (
        <p style={{ margin: "6px 0", whiteSpace: "pre-wrap" }}>
          <b>{docUraianLabel(doc.jenis)}:</b> {doc.uraian}
        </p>
      )}
      {doc.items?.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0" }}>
          <thead><tr>
            <th style={{ ...paperTh, width: 32 }}>No</th>
            {cols.map((c) => <th key={c.key} style={{ ...paperTh, width: `${c.w}%` }}>{c.label}</th>)}
          </tr></thead>
          <tbody>{doc.items.map((it, i) => (
            <tr key={i}>
              <td style={{ ...paperTd, textAlign: "center" }}>{i + 1}</td>
              {cols.map((c) => <td key={c.key} style={{ ...paperTd, textAlign: c.align || "left" }}>{it[c.key] || ""}</td>)}
            </tr>
          ))}</tbody>
          {grandTotal > 0 && cols.some((c) => c.sum) && (
            <tfoot><tr>
              <td style={{ ...paperTd, fontWeight: 700, textAlign: "right" }} colSpan={cols.length}>Total</td>
              <td style={{ ...paperTd, fontWeight: 800, textAlign: "right" }}>{fmtRp(grandTotal)}</td>
            </tr></tfoot>
          )}
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
          <div>{sig.lRole}<br />{sig.lName}</div>
          <div style={{ marginTop: 54, borderTop: "1px solid #0f172a", paddingTop: 4, fontWeight: 700 }}>{doc.ttdTeknisi}</div>
        </div>
        <div style={{ textAlign: "center", width: "45%" }}>
          <div>{sig.rRole}<br />{penerima}</div>
          {doc.ttdCustomerImg && <img alt="ttd" src={doc.ttdCustomerImg} style={{ height: 46, display: "block", margin: "6px auto -8px" }} />}
          <div style={{ marginTop: 54, borderTop: "1px solid #0f172a", paddingTop: 4, fontWeight: 700 }}>{doc.ttdCustomer}</div>
        </div>
      </div>
    </div>
  );
}

const paperTh = { border: "1px solid #cbd5e1", padding: "6px 8px", background: "#e2e8f0", color: "#0f172a", fontSize: 12 };
const paperTd = { border: "1px solid #cbd5e1", padding: "6px 8px", color: "#0f172a", fontSize: 12 };
