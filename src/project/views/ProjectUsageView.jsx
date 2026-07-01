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
      // Kaitkan tiap baris ke material stok (materialId) bila bukan input manual.
      const rows = (d.rows || [])
        .map((r) => {
          const isManual = r.material === MANUAL;
          const mat = isManual ? null : db.materials.find((m) => m.nama === r.material);
          return {
            namaFinal: isManual ? (r.manual || "").trim() : r.material,
            qtyNum: Number(r.qty) || 0,
            satuan: r.satuan || (mat ? mat.satuan : "") || "",
            mat, isManual,
          };
        })
        .filter((r) => r.qtyNum > 0 && r.namaFinal);
      if (!rows.length) return toast("Isi minimal 1 baris (material + qty)");

      // Guard over-pakai: total qty stok per material vs sisa alokasi project. Jangan silent-floor.
      const perMat = {}; // materialId → total qty diminta
      rows.forEach((r) => { if (r.mat) perMat[r.mat.id] = (perMat[r.mat.id] || 0) + r.qtyNum; });
      const over = [];
      Object.entries(perMat).forEach(([mid, want]) => {
        const al = db.alokasi.find((a) => a.materialId === mid && a.projectId === pid);
        const sisa = al ? Number(al.qty) || 0 : 0;
        const mat = db.materials.find((m) => m.id === mid);
        if (want > sisa) over.push(`• ${mat?.nama || mid}: pakai ${want}, sisa alokasi ${sisa}`);
      });
      if (over.length && !window.confirm(
        `⚠️ Pemakaian melebihi alokasi project:\n\n${over.join("\n")}\n\n` +
        `Alokasikan dulu dari Stok Material agar akurat. Lanjutkan tetap catat (sisa alokasi → 0, tercatat over-pakai)?`
      )) return;

      // Catat pemakaian: nama + qty numerik + satuan + kaitan stok + snapshot harga (COGS).
      addRows("usage", rows.map((r) => ({
        tanggal: today, projectId: pid, material: r.namaFinal,
        materialId: r.mat ? r.mat.id : null,
        qty: String(r.qtyNum), qtyNum: r.qtyNum, satuan: r.satuan,
        harga: r.mat ? (r.mat.harga || 0) : 0,
        oleh: d.oleh,
      })));

      // Potong sisa alokasi untuk material dari stok. Material manual → skip (beli on-site).
      const alokasiUpd = {};
      Object.entries(perMat).forEach(([mid, want]) => {
        const al = db.alokasi.find((a) => a.materialId === mid && a.projectId === pid);
        if (!al) return; // belum dialokasikan → hanya log, tak ada yang dipotong
        alokasiUpd[al.id] = Math.max(0, (Number(al.qty) || 0) - want);
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
