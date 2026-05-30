import React from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { isLocked, pName } from "../utils/finance.js";

export default function ProjectUsageView() {
  const { db, today, update } = useProject();
  const { openForm, toast } = useModal();
  const pidByName = (n) => (db.projects.find((p) => p.nama === n) || {}).id || "";

  const addUsage = () => {
    if (!db.projects.length) { toast("Buat project dulu di Daftar Project"); return; }
    if (!db.materials.length) { toast("Buat material dulu di Stok Material"); return; }
    openForm({
    title: "Catat Pemakaian Material (isi beberapa sekaligus)",
    fields: [
      { name: "projectId", label: "Project", type: "select", options: db.projects.map((p) => p.nama) },
      { name: "oleh", label: "Oleh" },
      { name: "rows", label: "Pemakaian Material", type: "grid", hint: "pilih material, isi qty & satuan",
        columns: [{ key: "material", label: "Material", type: "select", options: db.materials.map((m) => m.nama) }, { key: "qty", label: "Qty", type: "number" }, { key: "satuan", label: "Satuan" }] },
    ],
    onSubmit: (d) => {
      const pid = pidByName(d.projectId);
      if (isLocked(db, pid, today)) return toast("🔒 Hari terkunci");
      const rows = (d.rows || []).filter((r) => r.qty);
      if (!rows.length) return toast("Isi minimal 1 baris");
      update((cur) => { rows.forEach((r) => cur.usage = [{ tanggal: today, projectId: pid, material: r.material, qty: `${r.qty} ${r.satuan || ""}`.trim(), oleh: d.oleh }, ...cur.usage]); });
      toast(`${rows.length} pemakaian tercatat`);
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
          </tr></thead>
          <tbody>
            {db.usage.map((u, i) => (
              <tr key={i}>
                <td style={S.tableStyles.td}>{u.tanggal.slice(5)}</td>
                <td style={S.tableStyles.td}>{pName(db, u.projectId)} {isLocked(db, u.projectId, u.tanggal) && <span style={S.pill("gray")}>🔒</span>}</td>
                <td style={S.tableStyles.td}>{u.material}</td>
                <td style={S.tableStyles.td}>{u.qty}</td>
                <td style={S.tableStyles.td}>{u.oleh}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
