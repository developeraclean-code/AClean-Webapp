// Dokumen universal modul Maintenance — pilih customer (dropdown) lalu buat dokumen
// (Berita Acara, Form Commissioning, Kartu Garansi, Surat Penerimaan/Pengiriman).
// Reuse komponen dokumen modul Project (DocPaper, ProjectDocPDF, SignaturePad, Modal)
// + helper skema kolom per-jenis. Persist via backend action "maintenance" (RLS service key).
import React, { useState, useEffect, useCallback } from "react";
import { pdf } from "@react-pdf/renderer";
import { cs } from "../theme/cs.js";
import * as S from "../project/utils/styles.js";
import Modal from "../project/components/Modal.jsx";
import DocPaper from "../project/components/DocPaper.jsx";
import SignaturePad from "../project/components/SignaturePad.jsx";
import ProjectDocPDF from "../project/components/ProjectDocPDF.jsx";
import { loadLogo } from "../project/components/ProjectPaperPDF.jsx";
import {
  docColumns, docPrefix, docUraianLabel, docItemsLabel,
  DOC_PRESETS, BA_CHECK_PRESET, sumDocTotal, fmtRp,
} from "../project/utils/constants.js";
import { docSeqNext, ttdStatus } from "../project/utils/finance.js";

// Hanya 5 jenis yang relevan untuk maintenance.
const MAINT_DOC_TYPES = [
  "Berita Acara Pengerjaan",
  "Form Commissioning / Uji Fungsi",
  "Kartu Garansi",
  "Surat Penerimaan Barang",
  "Surat Pengiriman Barang",
];

const today = () => new Date().toISOString().slice(0, 10);

// DB row (snake_case) → objek doc yang dipahami DocPaper / ProjectDocPDF.
const toDocObj = (row) => ({
  ...row,
  tanggal: row.tanggal || "",
  items: row.items || [],
  checklist: row.checklist || [],
  ttdTeknisi: row.ttd_teknisi || "(teknisi)",
  ttdCustomer: row.ttd_customer || "(belum)",
  ttdCustomerImg: row.ttd_customer_img || null,
});

// ─────────── styles lokal (selaras dgn MaintenanceView) ───────────
const card = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 16 };
const btn = { background: cs.accent, color: "#04121f", border: 0, borderRadius: 9, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" };
const btnGhost = { ...btn, background: "transparent", color: cs.text, border: "1px solid " + cs.border };
const miniBtn = { background: "transparent", border: "1px solid " + cs.border, color: cs.text, borderRadius: 7, padding: "4px 9px", cursor: "pointer", fontSize: 12 };
const inp = { background: cs.surface, border: "1px solid " + cs.border, color: cs.text, borderRadius: 8, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" };
const th = { textAlign: "left", padding: "9px 10px", borderBottom: "1px solid " + cs.border, color: cs.muted, fontSize: 11, textTransform: "uppercase", whiteSpace: "nowrap" };
const td = { padding: "9px 10px", borderBottom: "1px solid " + cs.border, color: cs.text };
const pill = (bg, c) => ({ background: bg + "22", color: c, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 });

export default function MaintenanceDocsView({ clients = [], call, showNotif, showConfirm, isOwner, canManage = isOwner, appSettings = {}, onBack }) {
  const [clientId, setClientId] = useState(clients[0]?.id || "");
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [editId, setEditId] = useState(null);
  const [signId, setSignId] = useState(null);

  const client = clients.find((c) => c.id === clientId) || null;
  const project = client ? { nama: client.name, lokasi: client.address || "-" } : { nama: "-", lokasi: "-" };

  const load = useCallback(async () => {
    if (!clientId) { setDocs([]); return; }
    setLoading(true);
    try { const j = await call("list-documents", { client_id: clientId }); setDocs(j.documents || []); }
    catch (e) { showNotif("❌ " + e.message); }
    finally { setLoading(false); }
  }, [clientId, call, showNotif]);

  useEffect(() => { load(); }, [load]);

  const docObjs = docs.map(toDocObj);
  const viewDoc = viewId ? docObjs.find((d) => d.id === viewId) : null;
  const editDoc = editId ? docObjs.find((d) => d.id === editId) : null;
  const signDoc = signId ? docObjs.find((d) => d.id === signId) : null;

  const createDoc = async (jenis) => {
    const nomor = docSeqNext({ documents: docs }, docPrefix(jenis));
    const isBA = jenis.includes("Berita");
    try {
      const j = await call("create-document", {
        client_id: clientId, jenis, nomor, tanggal: today(),
        kepada: client?.pic_name || client?.name || "", periode: "", uraian: "", items: [], foto: 0,
        checklist: isBA ? [{ item: "Pekerjaan sesuai spesifikasi", done: false }, { item: "Uji fungsi / tes", done: false }, { item: "Area kerja bersih", done: false }] : [],
      });
      setCreateOpen(false);
      await load();
      showNotif("✅ Dokumen dibuat · " + nomor);
      setEditId(j.document.id);
    } catch (e) { showNotif("❌ " + e.message); }
  };

  const saveEdit = async (patch) => {
    try { await call("update-document", { id: editId, ...patch }); setEditId(null); await load(); showNotif("✅ Dokumen tersimpan"); }
    catch (e) { showNotif("❌ " + e.message); }
  };

  const saveSign = async ({ name, img }) => {
    try { await call("update-document", { id: signId, ttd_customer: name, ttd_customer_img: img }); setSignId(null); await load(); showNotif("✅ TTD virtual tersimpan"); }
    catch (e) { showNotif("❌ " + e.message); }
  };

  const removeDoc = async (d) => {
    const ok = await showConfirm({ title: "Hapus dokumen?", message: `Hapus ${d.nomor}? Tindakan tidak bisa diurungkan.` });
    if (!ok) return;
    try { await call("delete-document", { id: d.id }); await load(); showNotif("✅ Dokumen dihapus"); }
    catch (e) { showNotif("❌ " + e.message); }
  };

  const cetak = async (d) => {
    try {
      showNotif("⏳ Membuat PDF…");
      const logoUrl = await loadLogo();
      const blob = await pdf(<ProjectDocPDF doc={d} project={project} appSettings={appSettings} logoUrl={logoUrl} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${(d.nomor || "dokumen").replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showNotif("✅ PDF terunduh");
    } catch (e) { showNotif("❌ Gagal membuat PDF: " + (e.message || e)); }
  };

  const pillFor = (j) => j.includes("Berita") ? pill(cs.accent, cs.accent) : j.includes("Garansi") ? pill(cs.green, cs.green) : j.includes("Commissioning") || j.includes("Uji") ? pill(cs.yellow || "#eab308", cs.yellow || "#eab308") : pill(cs.muted, cs.muted);

  return (
    <div style={{ padding: 18 }}>
      <button onClick={onBack} style={{ ...btnGhost, marginBottom: 12 }}>← Kembali ke Maintenance</button>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <h2 style={{ color: cs.text, margin: 0 }}>📄 Dokumen Maintenance</h2>
      </div>
      <div style={{ color: cs.muted, fontSize: 13, marginBottom: 14 }}>
        Universal untuk semua customer maintenance — pilih customer lalu buat dokumen. Format & kolom bisa diedit, PDF pakai kop surat AClean.
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: cs.muted }}>
          <div style={{ marginBottom: 4 }}>Customer Maintenance</div>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ ...inp, minWidth: 280 }}>
            {clients.length === 0 && <option value="">(belum ada customer)</option>}
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button style={{ ...btn, opacity: clientId ? 1 : 0.5 }} disabled={!clientId} onClick={() => setCreateOpen(true)}>+ Buat Dokumen</button>
      </div>

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Tgl</th><th style={th}>Jenis</th><th style={th}>Nomor</th>
            <th style={th}>Kepada</th><th style={th}>TTD</th><th style={th}>Aksi</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td style={{ ...td, color: cs.muted }} colSpan={6}>Memuat…</td></tr>
            ) : docObjs.length === 0 ? (
              <tr><td style={{ ...td, color: cs.muted }} colSpan={6}>Belum ada dokumen untuk customer ini. Klik "+ Buat Dokumen".</td></tr>
            ) : docObjs.map((d) => (
              <tr key={d.id}>
                <td style={td}>{(d.tanggal || "").slice(5)}</td>
                <td style={td}><span style={pillFor(d.jenis)}>{d.jenis.replace("Surat ", "")}</span></td>
                <td style={td}>{d.nomor}</td>
                <td style={td}>{d.kepada}</td>
                <td style={td}>{ttdStatus(d) === "lengkap" ? <span style={pill(cs.green, cs.green)}>lengkap</span> : <span style={pill(cs.yellow || "#eab308", cs.yellow || "#eab308")}>belum</span>}</td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button style={miniBtn} onClick={() => setViewId(d.id)}>Lihat</button>
                    <button style={miniBtn} onClick={() => setEditId(d.id)}>Edit</button>
                    {ttdStatus(d) === "belum" && <button style={{ ...miniBtn, color: cs.green, borderColor: cs.green + "55" }} onClick={() => setSignId(d.id)}>Tanda Tangani</button>}
                    {canManage && <button style={{ ...miniBtn, color: cs.red }} onClick={() => removeDoc(d)}>🗑</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && <CreatePicker onPick={createDoc} onClose={() => setCreateOpen(false)} />}
      {viewDoc && <DocViewer doc={viewDoc} project={project} onClose={() => setViewId(null)} onPrint={() => cetak(viewDoc)} />}
      {editDoc && <DocEditor doc={editDoc} onClose={() => setEditId(null)} onSave={saveEdit} />}
      {signDoc && <SignaturePad kepada={signDoc.kepada} initialName={signDoc.ttdCustomer} onClose={() => setSignId(null)} onSave={saveSign} />}
    </div>
  );
}

// ─────────── picker jenis dokumen ───────────
function CreatePicker({ onPick, onClose }) {
  return (
    <Modal onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 800, color: cs.text, marginBottom: 14 }}>Pilih Jenis Dokumen</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {MAINT_DOC_TYPES.map((j) => (
          <button key={j} style={{ ...btnGhost, textAlign: "left", padding: "12px 14px" }} onClick={() => onPick(j)}>{j}</button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button style={btnGhost} onClick={onClose}>Batal</button>
      </div>
    </Modal>
  );
}

// ─────────── viewer (preview + cetak) ───────────
function DocViewer({ doc, project, onClose, onPrint }) {
  return (
    <Modal wide onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: cs.text, margin: 0 }}>{doc.jenis}</h3>
        <span style={S.tag}>TTD virtual ter-embed di PDF</span>
      </div>
      <DocPaper doc={doc} project={project} />
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
        <button style={btnGhost} onClick={onClose}>Tutup</button>
        <button style={btn} onClick={onPrint}>Cetak / PDF</button>
      </div>
    </Modal>
  );
}

// ─────────── editor (grid Excel, skema kolom per-jenis) ───────────
function DocEditor({ doc, onClose, onSave }) {
  const isBA = doc.jenis.includes("Berita");
  const cols = docColumns(doc.jenis);
  const [kepada, setKepada] = useState(doc.kepada || "");
  const [nomor, setNomor] = useState(doc.nomor || "");
  const [tanggal, setTanggal] = useState(doc.tanggal || today());
  const [periode, setPeriode] = useState(doc.periode || "");
  const [uraian, setUraian] = useState(doc.uraian || "");
  const [items, setItems] = useState(doc.items?.length ? doc.items.map((i) => ({ ...i })) : [{}, {}, {}]);
  const [checklist, setChecklist] = useState(doc.checklist?.length ? doc.checklist.map((c) => ({ ...c })) : (isBA ? [{ done: false, item: "" }] : []));

  const presetItems = () => setItems((DOC_PRESETS[doc.jenis] || []).map((x) => ({ ...x })));
  const presetCheck = () => setChecklist(BA_CHECK_PRESET.map((it) => ({ item: it, done: false })));

  const save = () => {
    const keys = cols.map((c) => c.key);
    const patch = {
      kepada, nomor, tanggal, periode, uraian,
      items: items.filter((it) => keys.some((k) => String(it[k] ?? "").trim() !== "")),
    };
    if (isBA) patch.checklist = checklist.filter((c) => c.item);
    onSave(patch);
  };

  const cellInput = { width: "100%", background: cs.surface, border: `1px solid ${cs.border}`, color: cs.text, borderRadius: 6, padding: "6px 7px", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box" };

  return (
    <Modal wide onClose={onClose}>
      <h3 style={{ fontSize: 16, fontWeight: 800, color: cs.text, marginBottom: 14 }}>Edit Dokumen — {doc.jenis.replace("Surat ", "")}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Lbl t="Kepada"><input style={cellInput} value={kepada} onChange={(e) => setKepada(e.target.value)} /></Lbl>
        <Lbl t="Nomor"><input style={cellInput} value={nomor} onChange={(e) => setNomor(e.target.value)} /></Lbl>
        <Lbl t="Tanggal"><input type="date" style={cellInput} value={tanggal} onChange={(e) => setTanggal(e.target.value)} /></Lbl>
        <Lbl t="Periode (opsional)"><input style={cellInput} value={periode} onChange={(e) => setPeriode(e.target.value)} /></Lbl>
      </div>
      <Lbl t={docUraianLabel(doc.jenis)}>
        <textarea style={{ ...cellInput, minHeight: 64 }} value={uraian} onChange={(e) => setUraian(e.target.value)} />
      </Lbl>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 4px" }}>
        <label style={{ fontSize: 12, color: cs.muted }}>{docItemsLabel(doc.jenis)}</label>
        <div style={S.row}>
          <button style={S.btnSm("ghost")} onClick={presetItems}>📋 Preset</button>
          <button style={S.btnSm()} onClick={() => setItems([...items, {}])}>+ Baris</button>
        </div>
      </div>
      <table style={S.tableStyles.table}>
        <thead><tr>
          <th style={{ ...S.tableStyles.th, width: 26 }}>No</th>
          {cols.map((c) => <th key={c.key} style={S.tableStyles.th}>{c.label}</th>)}
          <th style={{ ...S.tableStyles.th, width: 28 }}></th>
        </tr></thead>
        <tbody>
          {items.map((r, i) => (
            <tr key={i}>
              <td style={{ ...S.tableStyles.td, color: cs.muted, fontSize: 11, textAlign: "center" }}>{i + 1}</td>
              {cols.map((c) => (
                <td key={c.key} style={{ ...S.tableStyles.td, padding: "3px 4px" }}>
                  <input style={cellInput} value={r[c.key] ?? ""} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, [c.key]: e.target.value } : x))} />
                </td>
              ))}
              <td style={{ ...S.tableStyles.td, padding: "3px 4px" }}>
                <button style={S.btnSm("ghost")} onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
        {cols.some((c) => c.sum) && sumDocTotal(items) > 0 && (
          <tfoot><tr>
            <td style={{ ...S.tableStyles.td }} colSpan={cols.length}><b style={{ float: "right", color: cs.text }}>Total</b></td>
            <td style={{ ...S.tableStyles.td, fontWeight: 800, color: cs.text }}>{fmtRp(sumDocTotal(items))}</td>
            <td style={S.tableStyles.td}></td>
          </tr></tfoot>
        )}
      </table>

      {isBA && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 4px" }}>
            <label style={{ fontSize: 12, color: cs.muted }}>Checklist Serah Terima</label>
            <div style={S.row}>
              <button style={S.btnSm("ghost")} onClick={presetCheck}>📋 Preset</button>
              <button style={S.btnSm()} onClick={() => setChecklist([...checklist, { done: false, item: "" }])}>+ Poin</button>
            </div>
          </div>
          <table style={S.tableStyles.table}>
            <thead><tr>
              <th style={{ ...S.tableStyles.th, width: 40 }}>✔</th>
              <th style={S.tableStyles.th}>Poin pekerjaan</th>
              <th style={{ ...S.tableStyles.th, width: 28 }}></th>
            </tr></thead>
            <tbody>
              {checklist.map((c, i) => (
                <tr key={i}>
                  <td style={{ ...S.tableStyles.td, textAlign: "center" }}>
                    <input type="checkbox" checked={c.done} onChange={(e) => setChecklist(checklist.map((x, j) => j === i ? { ...x, done: e.target.checked } : x))} />
                  </td>
                  <td style={{ ...S.tableStyles.td, padding: "3px 4px" }}>
                    <input style={cellInput} value={c.item} onChange={(e) => setChecklist(checklist.map((x, j) => j === i ? { ...x, item: e.target.value } : x))} />
                  </td>
                  <td style={{ ...S.tableStyles.td, padding: "3px 4px" }}>
                    <button style={S.btnSm("ghost")} onClick={() => setChecklist(checklist.filter((_, j) => j !== i))}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
        <button style={btnGhost} onClick={onClose}>Batal</button>
        <button style={btn} onClick={save}>Simpan</button>
      </div>
    </Modal>
  );
}

const Lbl = ({ t, children }) => (
  <div style={{ marginBottom: 12 }}>
    <label style={{ display: "block", fontSize: 12, color: cs.muted, marginBottom: 5 }}>{t}</label>
    {children}
  </div>
);
