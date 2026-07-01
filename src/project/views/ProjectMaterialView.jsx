import React, { useState } from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { matTotal, matAlloc, pName } from "../utils/finance.js";
import { MAT_SUBS, fmtRp } from "../utils/constants.js";

// Nama dasar (grup) = nama tanpa akhiran nomor. "DSP 2PK - 01" → "DSP 2PK".
const baseName = (n = "") => n.replace(/[\s\-–—_.]*\d+\s*$/, "").trim() || n;

export default function ProjectMaterialView() {
  const { db, can, addRows, patchRows, patchRow, allocateMaterials, deleteRow } = useProject();
  const { openForm, toast } = useModal();
  const [q, setQ] = useState("");
  const [subFilter, setSubFilter] = useState("Semua");
  const [collapsed, setCollapsed] = useState({});
  const toggleGroup = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // Edit material (Owner only) — adjust nama/satuan/stok gudang/min/harga
  const editMaterial = (m) => openForm({
    title: `Edit Material — ${m.nama}`,
    fields: [
      { name: "nama", label: "Nama", val: m.nama },
      { name: "sub", label: "Sub-kategori", type: "select", options: MAT_SUBS, val: m.sub },
      { name: "satuan", label: "Satuan", val: m.satuan },
      { name: "gudang", label: "Stok Gudang (adjust)", type: "number", val: m.gudang },
      { name: "min", label: "Min", type: "number", val: m.min },
      { name: "harga", label: "Harga", type: "number", val: m.harga },
    ],
    onSubmit: (d) => {
      if (!d.nama) return toast("Nama wajib diisi");
      patchRow("materials", m.id, {
        nama: d.nama, sub: d.sub || m.sub, satuan: d.satuan,
        gudang: +d.gudang || 0, min: +d.min || 0, harga: +d.harga || 0,
      });
      toast("Material diperbarui");
    },
  });

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
      addRows("materials", rows.map((r, i) => ({
        id: "m" + Date.now() + i, nama: r.nama, sub: r.sub || MAT_SUBS[0], satuan: r.satuan,
        gudang: +r.gudang || 0, min: +r.min || 0, harga: +r.harga || 0,
      })));
      toast(`${rows.length} material ditambah`);
    },
  });

  const restock = () => {
    if (!db.materials.length) { toast("Tambah item material dulu"); return; }
    openForm({
    title: "Restock Gudang (isi beberapa sekaligus)",
    fields: [{ name: "rows", label: "Restock", type: "grid", hint: "pilih material & tambahan qty",
      columns: [{ key: "material", label: "Material", type: "select", options: db.materials.map((m) => m.nama) }, { key: "qty", label: "Tambah Qty", type: "number" }] }],
    onSubmit: (d) => {
      const rows = (d.rows || []).filter((r) => r.qty);
      if (!rows.length) return toast("Isi minimal 1 baris");
      const add = {}; // materialId → total tambahan qty
      rows.forEach((r) => { const m = db.materials.find((x) => x.nama === r.material); if (m) add[m.id] = (add[m.id] || 0) + (+r.qty || 0); });
      const updates = Object.entries(add).map(([id, q]) => { const m = db.materials.find((x) => x.id === id); return { id, gudang: (m.gudang || 0) + q }; });
      if (!updates.length) return toast("Material tidak ditemukan");
      patchRows("materials", updates);
      toast(`${rows.length} material di-restock`);
    },
  });
  };

  const allocate = () => {
    if (!db.materials.length) { toast("Tambah item material dulu"); return; }
    if (!db.projects.length) { toast("Buat project dulu di Daftar Project"); return; }
    openForm({
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
      const matWork = {}; // id → sisa gudang (working copy)
      const alWork = {};  // materialId → baris alokasi (working copy)
      rows.forEach((r) => {
        const base = db.materials.find((x) => x.nama === r.material); const q = +r.qty;
        if (!base || q <= 0) return;
        if (!(base.id in matWork)) matWork[base.id] = base.gudang;
        if (q > matWork[base.id]) { gagal++; return; }
        matWork[base.id] -= q;
        if (!alWork[base.id]) {
          const ex = db.alokasi.find((a) => a.materialId === base.id && a.projectId === pid);
          alWork[base.id] = ex ? { id: ex.id, materialId: base.id, projectId: pid, qty: ex.qty } : { materialId: base.id, projectId: pid, qty: 0 };
        }
        alWork[base.id].qty += q;
        ok++;
      });
      if (ok) {
        const materialUpdates = Object.keys(alWork).map((id) => ({ id, gudang: matWork[id] }));
        allocateMaterials(materialUpdates, Object.values(alWork));
      }
      toast(`${ok} dialokasikan${gagal ? `, ${gagal} gagal (stok kurang)` : ""}`);
    },
  });
  };

  const colSpan = (can.finance ? 7 : 6) + (can.delete ? 1 : 0);
  const matchQ = (m) => !q.trim() || (m.nama || "").toLowerCase().includes(q.trim().toLowerCase());

  // Baris per sub-kategori (terfilter), lalu dikelompokkan per nama-dasar.
  const rowsBySub = {};
  MAT_SUBS.forEach((s) => (rowsBySub[s] = db.materials.filter((m) => m.sub === s && matchQ(m))));
  const shownSubs = MAT_SUBS.filter((s) => (subFilter === "Semua" || subFilter === s) && rowsBySub[s].length);
  const totalShown = shownSubs.reduce((n, s) => n + rowsBySub[s].length, 0);

  const groupsOf = (items) => {
    const map = new Map();
    items.forEach((m) => { const k = baseName(m.nama); if (!map.has(k)) map.set(k, []); map.get(k).push(m); });
    return [...map.entries()];
  };

  const renderRow = (m, indent) => {
    const al = matAlloc(db, m); const tot = matTotal(db, m);
    const st = m.gudang <= m.min ? (m.gudang < m.min * 0.5 ? "red" : "yellow") : "green";
    const lbl = st === "red" ? "Kritis" : st === "yellow" ? "Menipis" : "Aman";
    return (
      <tr key={m.id}>
        <td style={{ ...S.tableStyles.td, paddingLeft: indent ? 28 : undefined }}>{m.nama}</td>
        <td style={S.tableStyles.td}>{m.satuan}</td>
        <td style={S.tableStyles.td}><b>{m.gudang}</b> <span style={S.muted}>/ total {tot}</span></td>
        <td style={S.tableStyles.td}>{al.length ? al.map((a, i) => <span key={i} style={{ ...S.tag, marginRight: 4 }}>{pName(db, a.projectId)}: {a.qty}</span>) : <span style={S.muted}>-</span>}</td>
        <td style={S.tableStyles.td}>{m.min}</td>
        <td style={S.tableStyles.td}><span style={S.pill(st)}>{lbl}</span></td>
        {can.finance && <td style={S.tableStyles.td}>{fmtRp(tot * m.harga)}</td>}
        {can.delete && <td style={S.tableStyles.td}><div style={S.row}>
          <button style={S.btnSm("ghost")} title="Edit material" onClick={() => editMaterial(m)}>✏️</button>
          <button style={S.btnSm("ghost")} onClick={() => { if (window.confirm(`Hapus material "${m.nama}" beserta alokasinya?`)) deleteRow("materials", m.id); }}>🗑</button>
        </div></td>}
      </tr>
    );
  };

  return (
    <div style={{ padding: 22, maxWidth: 1200 }}>
      <div style={S.note}>
        Stok material Project <b>berdiri sendiri</b> dari Inventori utama. Tiap material punya stok <b>Gudang</b> + <b>alokasi per project</b>, dikelompokkan per sub-kategori & nama.
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

      {/* Filter: cari nama + chip sub-kategori */}
      <div style={{ ...S.row, marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Cari material… (mis. DSP 2PK)"
          style={{ flex: "1 1 240px", minWidth: 200, background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 8, padding: "8px 12px", color: cs.text, fontSize: 13, outline: "none" }}
        />
        <div style={{ ...S.row, flexWrap: "wrap", gap: 6 }}>
          {["Semua", ...MAT_SUBS].map((c) => (
            <span key={c} style={S.chip(c === subFilter)} onClick={() => setSubFilter(c)}>{c}</span>
          ))}
        </div>
      </div>
      <div style={{ ...S.muted, fontSize: 11.5, marginBottom: 8 }}>{totalShown} material ditampilkan{q.trim() ? ` · cari "${q.trim()}"` : ""}</div>

      <div style={S.cardZero}>
        <table style={S.tableStyles.table}>
          <thead><tr>
            <th style={S.tableStyles.th}>Material</th><th style={S.tableStyles.th}>Satuan</th>
            <th style={S.tableStyles.th}>Gudang</th><th style={S.tableStyles.th}>Alokasi Project</th>
            <th style={S.tableStyles.th}>Min</th><th style={S.tableStyles.th}>Status</th>
            {can.finance && <th style={S.tableStyles.th}>Nilai (total)</th>}
            {can.delete && <th style={S.tableStyles.th}></th>}
          </tr></thead>
          <tbody>
            {totalShown === 0 ? (
              <tr><td colSpan={colSpan} style={{ ...S.tableStyles.td, ...S.muted, textAlign: "center", padding: 20 }}>Tidak ada material cocok.</td></tr>
            ) : shownSubs.map((sub) => (
              <React.Fragment key={sub}>
                <tr><td colSpan={colSpan} style={{ background: "#0f1b30", color: cs.ara, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", padding: "9px 12px" }}>{sub}</td></tr>
                {groupsOf(rowsBySub[sub]).map(([base, items]) => {
                  const multi = items.length > 1;
                  if (!multi) return renderRow(items[0], false);
                  const gkey = sub + "|" + base;
                  const isOpen = !collapsed[gkey];
                  const gGudang = items.reduce((n, m) => n + (Number(m.gudang) || 0), 0);
                  return (
                    <React.Fragment key={gkey}>
                      <tr onClick={() => toggleGroup(gkey)} style={{ cursor: "pointer" }}>
                        <td colSpan={colSpan} style={{ background: "#0c1526", color: cs.text, fontWeight: 600, fontSize: 12, padding: "7px 12px" }}>
                          <span style={{ color: cs.muted, marginRight: 6 }}>{isOpen ? "▾" : "▸"}</span>
                          {base} <span style={S.muted}>· {items.length} item · gudang {gGudang}</span>
                        </td>
                      </tr>
                      {isOpen && items.map((m) => renderRow(m, true))}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
