import React, { useState } from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { docSeqNext, ttdStatus, pName } from "../utils/finance.js";
import { DOC_TYPES, DOC_PRESETS, BA_CHECK_PRESET } from "../utils/constants.js";
import Modal from "../components/Modal.jsx";
import DocPaper from "../components/DocPaper.jsx";
import SignaturePad from "../components/SignaturePad.jsx";

export default function ProjectDocsView() {
  const { db, can, today, update } = useProject();
  const { openForm, openContent, close, toast } = useModal();
  const pidByName = (n) => (db.projects.find((p) => p.nama === n) || {}).id || "";

  const addDoc = () => {
    if (!db.projects.length) { toast("Buat project dulu di Daftar Project"); return; }
    openForm({
    title: "Buat Dokumen",
    fields: [
      { name: "jenis", label: "Jenis dokumen", type: "select", options: DOC_TYPES },
      { name: "projectId", label: "Project", type: "select", options: db.projects.map((p) => p.nama) },
      { name: "kepada", label: "Kepada (penerima)" },
      { name: "tanggal", label: "Tanggal", type: "date", val: today },
    ],
    onSubmit: (d) => {
      const pre = d.jenis.includes("Berita") ? "BA" : d.jenis.includes("Pengiriman") ? "SJ" : "TT";
      const isBA = d.jenis.includes("Berita");
      const id = "d" + Date.now();
      let nomor = "";
      update((cur) => {
        nomor = docSeqNext(cur, pre);
        cur.documents = [{
          id, jenis: d.jenis, projectId: pidByName(d.projectId), tanggal: d.tanggal || today,
          nomor, kepada: d.kepada, periode: "", uraian: "", items: [], foto: 0,
          ttdTeknisi: "(teknisi)", ttdCustomer: "(belum)", ttdCustomerImg: null,
          checklist: isBA ? [{ item: "Pekerjaan sesuai spesifikasi", done: false }, { item: "Uji fungsi / tes", done: false }, { item: "Area kerja bersih", done: false }] : [],
        }, ...cur.documents];
      });
      toast(`Dokumen dibuat · ${nomor}`);
      setTimeout(() => viewDoc(id), 50);
    },
  });
  };

  const viewDoc = (id) => {
    openContent({
      content: <DocViewer docId={id} />,
    });
  };

  const editDoc = (id) => {
    openContent({ content: <DocEditor docId={id} /> });
  };

  const signDoc = (id) => {
    const d = db.documents.find((x) => x.id === id);
    openContent({
      content: (
        <SignaturePad
          kepada={d.kepada}
          initialName={d.ttdCustomer}
          onClose={close}
          onSave={({ name, img }) => {
            update((cur) => { cur.documents = cur.documents.map((x) => (x.id === id ? { ...x, ttdCustomer: name, ttdCustomerImg: img } : x)); });
            close();
            toast("TTD virtual tersimpan → embed di PDF + R2");
            setTimeout(() => viewDoc(id), 50);
          }}
        />
      ),
    });
  };

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      <div style={S.note}>3 jenis dokumen, format bisa <b>diedit manual</b>. Klik <b>Lihat</b> untuk preview format PDF (siap disesuaikan).</div>
      <div style={{ ...S.between, marginBottom: 14 }}>
        <div style={S.sectionTitle}><h2 style={S.sectionTitleH}>Dokumen / BAST</h2></div>
        <button style={S.btn()} onClick={addDoc}>+ Buat Dokumen</button>
      </div>
      <div style={S.cardZero}>
        <table style={S.tableStyles.table}>
          <thead><tr>
            <th style={S.tableStyles.th}>Tgl</th><th style={S.tableStyles.th}>Jenis</th>
            <th style={S.tableStyles.th}>Nomor</th><th style={S.tableStyles.th}>Project</th>
            <th style={S.tableStyles.th}>Kepada</th><th style={S.tableStyles.th}>TTD</th>
            <th style={S.tableStyles.th}>Aksi</th>
          </tr></thead>
          <tbody>
            {db.documents.map((d) => (
              <tr key={d.id}>
                <td style={S.tableStyles.td}>{d.tanggal.slice(5)}</td>
                <td style={S.tableStyles.td}>
                  <span style={S.pill(d.jenis.includes("Berita") ? "ara" : d.jenis.includes("Pengiriman") ? "accent" : "green")}>{d.jenis.replace("Surat ", "")}</span>
                </td>
                <td style={S.tableStyles.td}>{d.nomor}</td>
                <td style={S.tableStyles.td}>{pName(db, d.projectId)}</td>
                <td style={S.tableStyles.td}>{d.kepada}</td>
                <td style={S.tableStyles.td}>
                  {ttdStatus(d) === "lengkap" ? <span style={S.pill("green")}>lengkap</span> : <span style={S.pill("yellow")}>belum</span>}
                </td>
                <td style={S.tableStyles.td}>
                  <div style={S.row}>
                    <button style={S.btnSm()} onClick={() => viewDoc(d.id)}>Lihat</button>
                    {can.manage && <button style={S.btnSm("ghost")} onClick={() => editDoc(d.id)}>Edit</button>}
                    {ttdStatus(d) === "belum" && can.manage && (
                      <button style={S.btnSm("green")} onClick={() => signDoc(d.id)}>Tanda Tangani</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ DocViewer ============
function DocViewer({ docId }) {
  const { db } = useProject();
  const { close, toast } = useModal();
  const d = db.documents.find((x) => x.id === docId);
  const p = db.projects.find((x) => x.id === d.projectId);
  return (
    <Modal wide onClose={close}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: cs.text, margin: 0 }}>{d.jenis}</h3>
        <span style={S.tag}>format bisa disesuaikan</span>
      </div>
      <DocPaper doc={d} project={p} />
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
        <button style={S.btn("ghost")} onClick={close}>Tutup</button>
        <button style={S.btn()} onClick={() => toast("(demo) export PDF ke R2")}>Cetak / PDF</button>
      </div>
    </Modal>
  );
}

// ============ DocEditor — grid Excel ============
function DocEditor({ docId }) {
  const { db, update } = useProject();
  const { close, toast } = useModal();
  const original = db.documents.find((x) => x.id === docId);
  const isBA = original.jenis.includes("Berita");
  const [kepada, setKepada] = useState(original.kepada);
  const [nomor, setNomor] = useState(original.nomor);
  const [tanggal, setTanggal] = useState(original.tanggal);
  const [periode, setPeriode] = useState(original.periode || "");
  const [uraian, setUraian] = useState(original.uraian || "");
  const [items, setItems] = useState(original.items?.length ? original.items.map((i) => ({ ...i })) : [{}, {}, {}]);
  const [checklist, setChecklist] = useState(original.checklist?.length ? original.checklist.map((c) => ({ ...c })) : (isBA ? [{ done: false, item: "" }] : []));

  const usePreset = () => {
    if (isBA) setChecklist(BA_CHECK_PRESET.map((it) => ({ item: it, done: false })));
    else setItems((DOC_PRESETS[original.jenis] || []).map((x) => ({ ...x })));
    toast("Preset dimuat");
  };
  const save = () => {
    update((cur) => {
      cur.documents = cur.documents.map((x) => x.id === docId ? {
        ...x, kepada, nomor, tanggal, periode, uraian,
        items: isBA ? x.items : items.filter((it) => it.nama),
        checklist: isBA ? checklist.filter((c) => c.item) : x.checklist,
      } : x);
    });
    close();
    toast("Dokumen tersimpan rapi");
  };

  const cellInput = { width: "100%", background: cs.surface, border: `1px solid ${cs.border}`, color: cs.text, borderRadius: 6, padding: "6px 7px", fontSize: 12, fontFamily: "inherit" };

  return (
    <Modal wide onClose={close}>
      <h3 style={{ fontSize: 16, fontWeight: 800, color: cs.text, marginBottom: 14 }}>Edit Dokumen — {original.jenis.replace("Surat ", "")}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Lbl t="Kepada"><input style={cellInput} value={kepada} onChange={(e) => setKepada(e.target.value)} /></Lbl>
        <Lbl t="Nomor"><input style={cellInput} value={nomor} onChange={(e) => setNomor(e.target.value)} /></Lbl>
        <Lbl t="Tanggal"><input type="date" style={cellInput} value={tanggal} onChange={(e) => setTanggal(e.target.value)} /></Lbl>
        <Lbl t="Periode (opsional)"><input style={cellInput} value={periode} onChange={(e) => setPeriode(e.target.value)} /></Lbl>
      </div>
      <Lbl t={isBA ? "Uraian Pekerjaan" : "Keterangan"}>
        <textarea style={{ ...cellInput, minHeight: 64 }} value={uraian} onChange={(e) => setUraian(e.target.value)} />
      </Lbl>

      {!isBA && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 4px" }}>
            <label style={{ fontSize: 12, color: cs.muted }}>Daftar Barang — isi per kolom (rapi seperti Excel)</label>
            <div style={S.row}>
              <button style={S.btnSm("ghost")} onClick={usePreset}>📋 Preset</button>
              <button style={S.btnSm()} onClick={() => setItems([...items, {}])}>+ Baris</button>
            </div>
          </div>
          <table style={S.tableStyles.table}>
            <thead><tr>
              <th style={{ ...S.tableStyles.th, width: 26 }}>#</th>
              <th style={S.tableStyles.th}>Nama Barang</th>
              <th style={{ ...S.tableStyles.th, width: 64 }}>Qty</th>
              <th style={{ ...S.tableStyles.th, width: 76 }}>Satuan</th>
              <th style={S.tableStyles.th}>Keterangan</th>
              <th style={{ ...S.tableStyles.th, width: 28 }}></th>
            </tr></thead>
            <tbody>
              {items.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...S.tableStyles.td, color: cs.muted, fontSize: 11, textAlign: "center" }}>{i + 1}</td>
                  {["nama", "qty", "satuan", "ket"].map((k) => (
                    <td key={k} style={{ ...S.tableStyles.td, padding: "3px 4px" }}>
                      <input style={cellInput} value={r[k] ?? ""} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} />
                    </td>
                  ))}
                  <td style={{ ...S.tableStyles.td, padding: "3px 4px" }}>
                    <button style={S.btnSm("ghost")} onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {isBA && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 4px" }}>
            <label style={{ fontSize: 12, color: cs.muted }}>Checklist Serah Terima</label>
            <div style={S.row}>
              <button style={S.btnSm("ghost")} onClick={usePreset}>📋 Preset</button>
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
        <button style={S.btn("ghost")} onClick={close}>Batal</button>
        <button style={S.btn()} onClick={save}>Simpan</button>
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
