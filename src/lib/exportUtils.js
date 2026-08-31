// src/lib/exportUtils.js
// Helper bersama untuk rekap CSV & PDF (via print) di seluruh menu.
// Dipakai ExpensesView (Biaya), ReportsView (Statistik), InvoiceView (AR), dst.
// Semua jalan di browser nyata (bukan sandbox artifact) → download & print aman.

// ── Format ──
export const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
export const fmtTanggal = (d) => {
  if (!d) return "";
  try { return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return String(d); }
};
export const fmtWaktu = (d) => {
  if (!d) return "";
  try { return new Date(d).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return String(d); }
};

// ── CSV ──
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
export function buildCsv(headers, rows) {
  const lines = [headers, ...rows].map(r => r.map(csvCell).join(","));
  // BOM (﻿) supaya Excel (locale ID) baca UTF-8 & huruf/emoji benar.
  return "﻿" + lines.join("\r\n");
}

export function downloadBlob(content, filename, mime = "text/plain;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCsv(headers, rows, filename) {
  downloadBlob(buildCsv(headers, rows), filename, "text/csv;charset=utf-8");
}

// ── HTML escape (untuk konten dinamis di dokumen print) ──
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]
  ));
}

// ── PDF via print — buka jendela baru berformat A4 rapi, panggil print().
// User pilih "Save as PDF" atau cetak. Return false kalau popup diblokir.
const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 22px; font-size: 12px; }
  .head { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
  .head h1 { margin: 0 0 2px; font-size: 20px; }
  .head .sub { color: #555; font-size: 12px; }
  .head .legend { margin-top: 6px; font-size: 11px; color: #555; }
  h2.sec { font-size: 15px; margin: 18px 0 6px; background: #f1f1f1; padding: 6px 10px; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #bbb; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; }
  td.r, th.r { text-align: right; white-space: nowrap; }
  td.c, th.c { text-align: center; white-space: nowrap; }
  td.no, th.no { width: 30px; text-align: center; color: #888; }
  tfoot td, tr.total td { font-weight: 800; background: #f7f7f7; }
  .pos { color: #0a7f2e; font-weight: 700; }
  .neg { color: #c01818; font-weight: 700; }
  .muted { color: #888; }
  .cards { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
  .card { border: 1px solid #ccc; border-radius: 8px; padding: 8px 12px; min-width: 150px; }
  .card .lbl { font-size: 10px; text-transform: uppercase; color: #666; letter-spacing: .3px; }
  .card .val { font-size: 17px; font-weight: 800; margin-top: 2px; }
  .sign { margin-top: 22px; display: flex; gap: 40px; font-size: 11px; color: #333; }
  .sign div { flex: 1; border-top: 1px solid #999; padding-top: 4px; margin-top: 34px; text-align: center; }
  @media print { body { margin: 12mm; } .noprint { display: none; } }
`;

export function printDocument({ title, subtitle = "", legend = "", bodyHtml = "", signature = false, showNotif }) {
  const sign = signature
    ? `<div class="sign"><div>Dibuat oleh</div><div>Diperiksa / Disetujui</div></div>`
    : "";
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8">
    <title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>
    <div class="head">
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<div class="sub">${escapeHtml(subtitle)}</div>` : ""}
      ${legend ? `<div class="legend">${legend}</div>` : ""}
    </div>
    ${bodyHtml}
    ${sign}
    </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { showNotif?.("⚠️ Popup diblokir browser — izinkan popup untuk cetak / simpan PDF."); return false; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* user bisa cetak manual */ } }, 400);
  return true;
}

// Bangun <table> HTML dari header + baris (nilai sudah diformat string).
// colClass: array kelas per kolom ("r"|"c"|""); footer: array sel baris total (opsional).
export function htmlTable(headers, rows, { colClass = [], footer = null } = {}) {
  const th = headers.map((h, i) => `<th class="${colClass[i] || ""}">${escapeHtml(h)}</th>`).join("");
  const body = rows.map(r =>
    `<tr>${r.map((c, i) => `<td class="${colClass[i] || ""}">${c == null ? "" : c}</td>`).join("")}</tr>`
  ).join("");
  const foot = footer
    ? `<tfoot><tr class="total">${footer.map((c, i) => `<td class="${colClass[i] || ""}">${c == null ? "" : c}</td>`).join("")}</tr></tfoot>`
    : "";
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}
