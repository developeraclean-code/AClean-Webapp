import React from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { matTotal, matAlloc, pName } from "../utils/finance.js";
import { MAT_SUBS, fmtRp } from "../utils/constants.js";

export default function ProjectMaterialView() {
  const { db, can, update } = useProject();
  const { openForm, toast } = useModal();

  const pidByName = (n) => (db.projects.find((p) => p.nama === n) || {}).id || "";
  const projOptions = db.projects.map((p) => p.nama);

  const addMaterial = () => openForm({
    title: "Item Material Baru (isi beberapa sekaligus)",
    fields: [{ name: "rows", label: "Material Baru", type: "grid", hint: "tambah beberapa item material sekaligus",
      columns: [
        { key: "nama", label: "Nama" },
        { key: "sub", label: "Sub-kategori", type: "select", options: MAT_SUBS },
        { key: "satuan", label: "Satuan" },
        { key: "gudang", label: "Stok awal", type: "number" },
        { key: "min", label: "Min", type: "number" },
        { key: "harga", label: "Harga", type: "number" },
      ] }],
    onSubmit: (d) => {
      const rows = (d.rows || []).filter((r) => r.nama);
      if (!rows.length) return toast("Isi minimal 1 baris");
      update((cur) => {
        rows.forEach((r, i) => cur.materials.push({
          id: "m" + Date.now() + i, nama: r.nama, sub: r.sub || MAT_SUBS[0], satuan: r.satuan,
          gudang: +r.gudang || 0, min: +r.min || 0, harga: +r.harga || 0,
        }));
      });
      toast(`${rows.length} material ditambah`);
    },
  });

  const restock = () => openForm({
    title: "Restock Gudang (isi beberapa sekaligus)",
    fields: [{ name: "rows", label: "Restock", type: "grid", hint: "pilih material & tambahan qty",
      columns: [{ key: "material", label: "Material", type: "select", options: db.materials.map((m) => m.nama) }, { key: "qty", label: "Tambah Qty", type: "number" }] }],
    onSubmit: (d) => {
      const rows = (d.rows || []).filter((r) => r.qty);
      if (!rows.length) return toast("Isi minimal 1 baris");
      update((cur) => { rows.forEach((r) => { const m = cur.materials.find((x) => x.nama === r.material); if (m) m.gudang += +r.qty; }); });
      toast(`${rows.length} material di-restock`);
    },
  });

  const allocate = () => openForm({
    title: "Alokasi Material ke Project (isi beberapa sekaligus)",
    fields: [
      { name: "projectId", label: "Project", type: "select", options: projOptions },
      { name: "rows", label: "Alokasi dari Gudang", type: "grid", hint: "pilih material & qty alokasi",
        columns: [{ key: "material", label: "Material", type: "select", options: db.materials.map((m) => m.nama) }, { key: "qty", label: "Qty", type: "number" }] },
    ],
    onSubmit: (d) => {
      const pid = pidByName(d.projectId);
      const rows = (d.rows || []).filter((r) => r.qty);
      if (!rows.length) return toast("Isi minimal 1 baris");
      let ok = 0, gagal = 0;
      update((cur) => {
        rows.forEach((r) => {
          const m = cur.materials.find((x) => x.nama === r.material); const q = +r.qty;
          if (!m || q <= 0) return;
          if (q > m.gudang) { gagal++; return; }
          m.gudang -= q;
          const ex = cur.alokasi.find((a) => a.materialId === m.id && a.projectId === pid);
          if (ex) ex.qty += q; else cur.alokasi.push({ materialId: m.id, projectId: pid, qty: q });
          ok++;
        });
      });
      toast(`${ok} dialokasikan${gagal ? `, ${gagal} gagal (stok kurang)` : ""}`);
    },
  });

  const rowsBySub = {};
  MAT_SUBS.forEach((s) => (rowsBySub[s] = db.materials.filter((m) => m.sub === s)));

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      <div style={S.note}>
        Stok material Project <b>berdiri sendiri</b> dari Inventori utama. Tiap material punya stok <b>Gudang</b> + <b>alokasi per project</b>, dikelompokkan per sub-kategori.
      </div>
      <div style={{ ...S.between, marginBottom: 14 }}>
        <div style={S.sectionTitle}><h2 style={S.sectionTitleH}>Stok Material Project</h2></div>
        {can.manage && (
          <div style={S.row}>
            <button style={S.btnSm("ghost")} onClick={addMaterial}>+ Item</button>
            <button style={S.btnSm("ghost")} onClick={restock}>Restock Gudang</button>
            <button style={S.btnSm()} onClick={allocate}>Alokasi ke Project</button>
          </div>
        )}
      </div>
      <div style={S.cardZero}>
        <table style={S.tableStyles.table}>
          <thead><tr>
            <th style={S.tableStyles.th}>Material</th><th style={S.tableStyles.th}>Satuan</th>
            <th style={S.tableStyles.th}>Gudang</th><th style={S.tableStyles.th}>Alokasi Project</th>
            <th style={S.tableStyles.th}>Min</th><th style={S.tableStyles.th}>Status</th>
            {can.finance && <th style={S.tableStyles.th}>Nilai (total)</th>}
          </tr></thead>
          <tbody>
            {MAT_SUBS.map((sub) => rowsBySub[sub].length ? (
              <React.Fragment key={sub}>
                <tr><td colSpan={can.finance ? 7 : 6} style={{ background: "#0f1b30", color: cs.ara, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", padding: "9px 12px" }}>{sub}</td></tr>
                {rowsBySub[sub].map((m) => {
                  const al = matAlloc(db, m); const tot = matTotal(db, m);
                  const st = m.gudang <= m.min ? (m.gudang < m.min * 0.5 ? "red" : "yellow") : "green";
                  const lbl = st === "red" ? "Kritis" : st === "yellow" ? "Menipis" : "Aman";
                  return (
                    <tr key={m.id}>
                      <td style={S.tableStyles.td}>{m.nama}</td>
                      <td style={S.tableStyles.td}>{m.satuan}</td>
                      <td style={S.tableStyles.td}><b>{m.gudang}</b> <span style={S.muted}>/ total {tot}</span></td>
                      <td style={S.tableStyles.td}>{al.length ? al.map((a, i) => <span key={i} style={{ ...S.tag, marginRight: 4 }}>{pName(db, a.projectId)}: {a.qty}</span>) : <span style={S.muted}>-</span>}</td>
                      <td style={S.tableStyles.td}>{m.min}</td>
                      <td style={S.tableStyles.td}><span style={S.pill(st)}>{lbl}</span></td>
                      {can.finance && <td style={S.tableStyles.td}>{fmtRp(tot * m.harga)}</td>}
                    </tr>
                  );
                })}
              </React.Fragment>
            ) : null)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
