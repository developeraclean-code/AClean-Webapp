import React from "react";
import { sumDocTotal, fmtRp, docColumns, docUraianLabel, docSig } from "../utils/constants.js";
import { normalizeDocumentAttachments } from "../utils/documentAttachments.js";

// Preview format PDF-like (kertas A4) untuk semua jenis dokumen project.
export default function DocPaper({ doc, project }) {
  const isBA = doc.jenis.includes("Berita");
  const cl = doc.checklist || [];
  const grandTotal = sumDocTotal(doc.items);
  const allDone = cl.length && cl.every((c) => c.done);
  const cols = docColumns(doc.jenis);
  const sig = docSig(doc.jenis);
  const penerima = (doc.kepada || "").split("—")[0];
  const attachments = normalizeDocumentAttachments(doc.attachments);
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
      {attachments.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <b>Lampiran Dokumentasi ({attachments.length} foto):</b>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginTop: 8 }}>
            {attachments.slice(0, 4).map((attachment, i) => (
              <div key={attachment.id} style={{ border: "1px solid #cbd5e1", borderRadius: 5, padding: 4 }}>
                <img src={attachment.url} alt={attachment.caption || `Foto ${i + 1}`} style={{ width: "100%", height: 130, objectFit: "cover", display: "block", borderRadius: 3 }} />
                <div style={{ color: "#475569", fontSize: 9.5, marginTop: 3 }}>{i + 1}. {attachment.caption || attachment.name}</div>
              </div>
            ))}
          </div>
          {attachments.length > 4 && <div style={{ color: "#475569", fontSize: 10, marginTop: 5 }}>+ {attachments.length - 4} foto lain tersedia di halaman lampiran PDF.</div>}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24, gap: 24 }}>
        <SignCol role={sig.lRole} name={sig.lName} signName={doc.ttdTeknisi} />
        <SignCol role={sig.rRole} name={penerima} signName={doc.ttdCustomer} img={doc.ttdCustomerImg} />
      </div>
    </div>
  );
}

// Satu kolom tanda tangan. Tinggi TETAP + garis di-pin ke bawah (marginTop:auto)
// → garis & nama SELALU sejajar antar kolom walau nama penerima panjang (wrap 2
// baris). wordBreak mencegah nama jebol keluar kotak.
function SignCol({ role, name, signName, img }) {
  return (
    <div style={{ width: "45%", minWidth: 0, textAlign: "center", display: "flex", flexDirection: "column", height: 96 }}>
      <div style={{ lineHeight: 1.3, wordBreak: "break-word" }}>{role}<br />{name}</div>
      <div style={{ marginTop: "auto" }}>
        {img && <img alt="ttd" src={img} style={{ maxHeight: 40, maxWidth: "90%", display: "block", margin: "0 auto 2px" }} />}
        <div style={{ borderTop: "1px solid #0f172a", paddingTop: 4, fontWeight: 700, lineHeight: 1.25, wordBreak: "break-word" }}>{signName}</div>
      </div>
    </div>
  );
}

const paperTh = { border: "1px solid #cbd5e1", padding: "6px 8px", background: "#e2e8f0", color: "#0f172a", fontSize: 12 };
const paperTd = { border: "1px solid #cbd5e1", padding: "6px 8px", color: "#0f172a", fontSize: 12 };
