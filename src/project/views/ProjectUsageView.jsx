import React from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { isLocked, pName } from "../utils/finance.js";

export default function ProjectUsageView() {
  const { db, can, today, addRows, patchRows, deleteRow } = useProject();
  const { openForm, toast } = useModal();
  const pidByName = (n) => (db.projects.find((p) => p.nama === n) || {}).id || "";

  const MANUAL = "✏️ Ketik manual";
  const addUsage = () => {
    if (!db.projects.length) { toast("Buat project dulu di Daftar Project"); return; }
    openForm({
    title: "Catat Pemakaian Material (isi beberapa sekaligus)",
    fields: [
      { name: "projectId", label: "Project", type: "select", options: db.projects.map((p) => p.nama) },
      { name: "oleh", label: "Oleh" },
      { name: "rows", label: "Pemakaian Material", type: "grid", hint: "pilih material dari stok ATAU '✏️ Ketik manual' lalu isi nama di kolom Manual (mis. beli satuan)",
        columns: [
          { key: "material", label: "Material", type: "select", options: [...db.materials.map((m) => m.nama), MANUAL] },
          { key: "manual", label: "Nama (jika manual)" },
          { key: "qty", label: "Qty", type: "number" },
          { key: "satuan", label: "Satuan" },
        ] },
    ],
    onSubmit: (d) => {
      const pid = pidByName(d.projectId);
      if (isLocked(db, pid, today)) return toast("🔒 Hari terkunci");
      const rows = (d.rows || [])
        .map((r) => ({ ...r, namaFinal: r.material === MANUAL ? (r.manual || "").trim() : r.material, qtyNum: Number(r.qty) || 0 }))
        .filter((r) => r.qtyNum > 0 && r.namaFinal);
      if (!rows.length) return toast("Isi minimal 1 baris (material + qty)");
      // Catat pemakaian: qty angka + satuan terpisah
      addRows("usage", rows.map((r) => ({ tanggal: today, projectId: pid, material: r.namaFinal, qty: String(r.qtyNum), satuan: r.satuan || "", oleh: d.oleh })));
      // Potong alokasi untuk material dari stok (match nama). Material manual → skip (beli on-site).
      const alokasiUpd = {};
      rows.forEach((r) => {
        if (r.material === MANUAL) return;
        const mat = db.materials.find((m) => m.nama === r.namaFinal);
        if (!mat) return;
        const al = db.alokasi.find((a) => a.materialId === mat.id && a.projectId === pid);
        if (!al) return; // belum dialokasikan → hanya log, tak ada yang dipotong
        const base = alokasiUpd[al.id] !== undefined ? alokasiUpd[al.id] : al.qty;
        alokasiUpd[al.id] = Math.max(0, base - r.qtyNum);
      });
      const updates = Object.entries(alokasiUpd).map(([id, qty]) => ({ id, qty }));
      if (updates.length) patchRows("alokasi", updates);
      toast(`${rows.length} pemakaian tercatat${updates.length ? ` · alokasi ${updates.length} material diperbarui` : ""}`);
    },
  });
  };

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      <div style={S.note}>Pemakaian material terecord per project + tanggal. Mengurangi alokasi project.</div>
      <div style={{ ...S.between, marginBottom: 14 }}>
        <div style={S.sectionTitle}><h2 style={S.sectionTitleH}>Pemakaian Material</h2></div>
        <button style={S.btn()} onClick={addUsage}>+ Catat Pemakaian</button>
      </div>
      <div style={S.cardZero}>
        <table style={S.tableStyles.table}>
          <thead><tr>
            <th style={S.tableStyles.th}>Tgl</th><th style={S.tableStyles.th}>Project</th>
            <th style={S.tableStyles.th}>Material</th><th style={S.tableStyles.th}>Qty</th><th style={S.tableStyles.th}>Oleh</th>
            {can.delete && <th style={S.tableStyles.th}></th>}
          </tr></thead>
          <tbody>
            {db.usage.map((u, i) => (
              <tr key={i}>
                <td style={S.tableStyles.td}>{u.tanggal.slice(5)}</td>
                <td style={S.tableStyles.td}>{pName(db, u.projectId)} {isLocked(db, u.projectId, u.tanggal) && <span style={S.pill("gray")}>🔒</span>}</td>
                <td style={S.tableStyles.td}>{u.material}</td>
                <td style={S.tableStyles.td}>{u.qty}{u.satuan ? ` ${u.satuan}` : ""}</td>
                <td style={S.tableStyles.td}>{u.oleh}</td>
                {can.delete && <td style={S.tableStyles.td}><button style={S.btnSm("ghost")} onClick={() => { if (window.confirm("Hapus catatan pemakaian ini?")) deleteRow("usage", u.id); }}>🗑</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
