import React, { useEffect, useMemo, useState } from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { matTotal, matAlloc, pName } from "../utils/finance.js";
import { MAT_SUBS, fmtRp } from "../utils/constants.js";
import { api } from "../data/projectApi";

const mutationId = (prefix) => `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
const qty = (v) => Number(v) || 0;
const fmtDate = (v) => v ? new Date(v).toLocaleString("id-ID") : "-";
const TX_LABEL = { OPENING: "Saldo awal", RESTOCK: "Restock", ALLOCATE: "Alokasi", RETURN: "Pengembalian", USAGE: "Pemakaian", ADJUSTMENT: "Koreksi", ARCHIVE: "Arsip", RESTORE: "Pulihkan" };

export default function ProjectMaterialView() {
  const { db, can, runStockMutation, currentUser } = useProject();
  const { openForm, toast } = useModal();
  const [q, setQ] = useState("");
  const [subFilter, setSubFilter] = useState("Semua");
  const [statusFilter, setStatusFilter] = useState("Aktif");
  const [collapsed, setCollapsed] = useState({});
  const [historyOpen, setHistoryOpen] = useState(null);
  const [history, setHistory] = useState({});
  const [historyBusy, setHistoryBusy] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reconciliation, setReconciliation] = useState(null);

  const activeMaterials = db.materials.filter((m) => m.isActive !== false);
  const materialOptions = useMemo(() => activeMaterials.map((m) => `${m.nama} · ${m.id.slice(-6)}`), [activeMaterials]);
  const materialByOption = (label) => activeMaterials.find((m) => `${m.nama} · ${m.id.slice(-6)}` === label);
  const projectOptions = useMemo(() => db.projects.map((p) => `${p.nama} · ${p.id.slice(-6)}`), [db.projects]);
  const projectByOption = (label) => db.projects.find((p) => `${p.nama} · ${p.id.slice(-6)}` === label);

  const loadReconciliation = async () => {
    try { setReconciliation(await api.materialReconciliation()); }
    catch { setReconciliation(null); }
  };
  useEffect(() => { loadReconciliation(); }, []); // audit only when this tab is opened

  const execute = async (rpc, params, success) => {
    if (busy) return;
    setBusy(true);
    try { await runStockMutation(rpc, params); await loadReconciliation(); toast(success); }
    catch (e) { toast(`Gagal: ${e.message || e}`, 3500); }
    finally { setBusy(false); }
  };

  const editMaterial = (m) => openForm({
    title: `Ubah Material — ${m.nama}`,
    fields: [
      { name: "nama", label: "Nama", val: m.nama },
      { name: "groupName", label: "Kelompok material", val: m.groupName || m.nama },
      { name: "variantLabel", label: "Label varian / unit", val: m.variantLabel || "", ph: "Contoh: 01 atau Roll B2" },
      { name: "sub", label: "Kategori", type: "select", options: MAT_SUBS, val: m.sub || MAT_SUBS[0] },
      { name: "satuan", label: "Satuan", val: m.satuan || "" },
      { name: "gudang", label: "Stok gudang setelah koreksi", type: "number", val: m.gudang },
      { name: "min", label: "Batas stok minimum", type: "number", val: m.min },
      { name: "harga", label: "Harga satuan", type: "number", val: m.harga },
      { name: "reason", label: "Alasan koreksi stok (wajib bila jumlah berubah)", type: "textarea", ph: "Contoh: hasil stock opname 19 September" },
    ],
    onSubmit: (d) => execute("update_project_material_atomic", {
      p_material_id: m.id, p_name: d.nama, p_sub: d.sub, p_unit: d.satuan,
      p_min: qty(d.min), p_price: qty(d.harga), p_group_name: d.groupName,
      p_variant_label: d.variantLabel || null, p_target_stock: qty(d.gudang),
      p_reason: d.reason || null, p_mutation_key: mutationId("material-edit"),
    }, "Material diperbarui dan tercatat di riwayat"),
  });

  const addMaterial = () => openForm({
    title: "Tambah Material Project",
    fields: [{ name: "rows", label: "Material baru", type: "grid", hint: "Setiap material mempunyai ID unik; nama boleh mirip.", columns: [
      { key: "nama", label: "Nama" }, { key: "groupName", label: "Kelompok" },
      { key: "variantLabel", label: "Varian" }, { key: "sub", label: "Kategori", type: "select", options: MAT_SUBS },
      { key: "satuan", label: "Satuan" }, { key: "gudang", label: "Stok awal", type: "number" },
      { key: "min", label: "Minimum", type: "number" }, { key: "harga", label: "Harga", type: "number" },
    ] }],
    onSubmit: (d) => {
      const rows = (d.rows || []).filter((r) => r.nama?.trim()).map((r) => ({
        id: `pm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        nama: r.nama.trim(), groupName: r.groupName?.trim() || r.nama.trim(), variantLabel: r.variantLabel?.trim() || null,
        sub: r.sub || MAT_SUBS[0], satuan: r.satuan?.trim() || "pcs", gudang: qty(r.gudang), min: qty(r.min), harga: qty(r.harga),
      }));
      if (!rows.length) return toast("Isi minimal satu material");
      execute("create_project_materials_atomic", { p_rows: rows, p_mutation_key: mutationId("material-create") }, `${rows.length} material ditambahkan`);
    },
  });

  const restock = () => {
    if (!materialOptions.length) return toast("Tidak ada material aktif");
    openForm({ title: "Restock Gudang", fields: [
      { name: "notes", label: "Catatan / sumber pembelian", type: "textarea", ph: "Contoh: PO supplier 19 September" },
      { name: "rows", label: "Daftar restock", type: "grid", columns: [
        { key: "material", label: "Material", type: "select", options: materialOptions }, { key: "qty", label: "Tambah qty", type: "number" },
      ] },
    ], onSubmit: (d) => {
      const rows = (d.rows || []).map((r) => ({ materialId: materialByOption(r.material)?.id, qty: qty(r.qty) })).filter((r) => r.materialId && r.qty > 0);
      if (!rows.length) return toast("Isi minimal satu restock");
      execute("restock_project_materials_atomic", { p_rows: rows, p_notes: d.notes || null, p_mutation_key: mutationId("material-restock") }, `${rows.length} restock berhasil`);
    } });
  };

  const allocate = () => {
    if (!materialOptions.length || !projectOptions.length) return toast("Material aktif atau project belum tersedia");
    openForm({ title: "Alokasi Material ke Project", fields: [
      { name: "project", label: "Project", type: "select", options: projectOptions },
      { name: "notes", label: "Catatan", type: "textarea" },
      { name: "rows", label: "Material", type: "grid", columns: [
        { key: "material", label: "Material", type: "select", options: materialOptions }, { key: "qty", label: "Qty", type: "number" },
      ] },
    ], onSubmit: (d) => {
      const project = projectByOption(d.project);
      const rows = (d.rows || []).map((r) => ({ materialId: materialByOption(r.material)?.id, qty: qty(r.qty) })).filter((r) => r.materialId && r.qty > 0);
      if (!project || !rows.length) return toast("Project dan material wajib diisi");
      execute("allocate_project_materials_atomic", { p_project_id: project.id, p_rows: rows, p_notes: d.notes || null, p_mutation_key: mutationId("material-allocate") }, `${rows.length} alokasi berhasil`);
    } });
  };

  const setArchive = (m, archive) => openForm({
    title: `${archive ? "Arsipkan" : "Pulihkan"} — ${m.nama}`,
    fields: [{ name: "reason", label: "Alasan", type: "textarea", ph: archive ? "Contoh: stok habis dan item tidak dipakai lagi" : "Alasan material digunakan kembali" }],
    onSubmit: (d) => execute("set_project_material_archive_atomic", {
      p_material_id: m.id, p_archive: archive, p_reason: d.reason,
      p_mutation_key: mutationId(archive ? "material-archive" : "material-restore"),
    }, archive ? "Material diarsipkan" : "Material dipulihkan"),
  });

  const toggleHistory = async (m) => {
    if (historyOpen === m.id) return setHistoryOpen(null);
    setHistoryOpen(m.id);
    if (history[m.id]) return;
    setHistoryBusy(m.id);
    try {
      const rows = await api.materialHistory(m.id);
      setHistory((cur) => ({ ...cur, [m.id]: rows }));
    }
    catch (e) { toast(`Riwayat gagal dimuat: ${e.message || e}`, 3500); }
    finally { setHistoryBusy(null); }
  };

  const stats = useMemo(() => db.materials.reduce((a, m) => {
    const total = matTotal(db, m); const allocated = matAlloc(db, m).reduce((n, x) => n + qty(x.qty), 0);
    if (m.isActive === false) a.archived += 1; else a.active += 1;
    a.warehouse += qty(m.gudang); a.allocated += allocated; a.value += total * qty(m.harga);
    if (m.isActive !== false && qty(m.gudang) <= qty(m.min)) a.critical += 1;
    return a;
  }, { active: 0, archived: 0, warehouse: 0, allocated: 0, critical: 0, value: 0 }), [db]);

  const matches = (m) => {
    const needle = q.trim().toLowerCase(); const allocated = matAlloc(db, m).reduce((n, x) => n + qty(x.qty), 0);
    const statusOk = statusFilter === "Semua" || (statusFilter === "Aktif" && m.isActive !== false)
      || (statusFilter === "Diarsipkan" && m.isActive === false) || (statusFilter === "Habis" && m.isActive !== false && qty(m.gudang) === 0 && allocated === 0)
      || (statusFilter === "Kritis" && m.isActive !== false && qty(m.gudang) <= qty(m.min));
    return statusOk && (subFilter === "Semua" || m.sub === subFilter)
      && (!needle || [m.nama, m.groupName, m.variantLabel, m.sub].some((v) => String(v || "").toLowerCase().includes(needle)));
  };
  const shown = db.materials.filter(matches);
  const rowsBySub = Object.fromEntries(MAT_SUBS.map((s) => [s, shown.filter((m) => (m.sub || "Lainnya") === s)]));
  const shownSubs = MAT_SUBS.filter((s) => rowsBySub[s].length);
  const groupsOf = (items) => {
    const map = new Map(); items.forEach((m) => { const k = m.groupName || m.nama; map.set(k, [...(map.get(k) || []), m]); }); return [...map.entries()];
  };
  const colSpan = can.finance ? 8 : 7;

  const renderHistory = (m) => (
    <tr key={`${m.id}:history`}><td colSpan={colSpan} style={{ padding: 0, background: "#091426" }}>
      <div style={{ padding: "12px 18px 16px" }}>
        <b style={{ color: cs.accent, fontSize: 12 }}>Riwayat — {m.nama}</b>
        {historyBusy === m.id ? <div style={{ ...S.muted, padding: 12 }}>Memuat riwayat…</div> : !(history[m.id] || []).length
          ? <div style={{ ...S.muted, padding: 12 }}>Belum ada mutasi sejak ledger diaktifkan.</div>
          : <div style={{ overflowX: "auto", marginTop: 8 }}><table style={S.tableStyles.table}><thead><tr>
            <th style={S.tableStyles.th}>Waktu</th><th style={S.tableStyles.th}>Jenis</th><th style={S.tableStyles.th}>Project</th>
            <th style={S.tableStyles.th}>Gudang Δ</th><th style={S.tableStyles.th}>Alokasi Δ</th><th style={S.tableStyles.th}>Oleh</th><th style={S.tableStyles.th}>Catatan</th>
          </tr></thead><tbody>{history[m.id].map((h) => <tr key={h.id}>
            <td style={S.tableStyles.td}>{fmtDate(h.created_at)}</td><td style={S.tableStyles.td}>{TX_LABEL[h.movement_type] || h.movement_type}</td>
            <td style={S.tableStyles.td}>{h.project_id ? pName(db, h.project_id) : "Gudang"}</td>
            <td style={{ ...S.tableStyles.td, color: qty(h.warehouse_delta) >= 0 ? cs.green : cs.red }}>{qty(h.warehouse_delta) || "-"}</td>
            <td style={{ ...S.tableStyles.td, color: qty(h.allocation_delta) >= 0 ? cs.green : cs.red }}>{qty(h.allocation_delta) || "-"}</td>
            <td style={S.tableStyles.td}>{h.actor_name || "-"}</td><td style={S.tableStyles.td}>{h.notes || "-"}</td>
          </tr>)}</tbody></table></div>}
      </div>
    </td></tr>
  );

  const renderRow = (m, indent = false) => {
    const allocations = matAlloc(db, m); const allocated = allocations.reduce((n, a) => n + qty(a.qty), 0); const total = qty(m.gudang) + allocated;
    const isArchived = m.isActive === false; const empty = qty(m.gudang) === 0 && allocated === 0;
    const level = isArchived ? "gray" : empty ? "gray" : qty(m.gudang) <= qty(m.min) ? "red" : "green";
    const label = isArchived ? "Diarsipkan" : empty ? "Habis" : level === "red" ? "Kritis" : "Aman";
    return <React.Fragment key={m.id}><tr style={{ opacity: isArchived ? .68 : 1 }}>
      <td style={{ ...S.tableStyles.td, paddingLeft: indent ? 28 : 12 }}><b>{m.nama}</b>{m.variantLabel && <div style={{ ...S.muted, fontSize: 11 }}>Varian: {m.variantLabel}</div>}</td>
      <td style={S.tableStyles.td}>{m.satuan || "-"}</td><td style={S.tableStyles.td}><b>{qty(m.gudang)}</b></td>
      <td style={S.tableStyles.td}><b>{allocated}</b>{allocations.length > 0 && <div style={{ marginTop: 4 }}>{allocations.filter((a) => qty(a.qty)>0).map((a) => <span key={a.id} style={{ ...S.tag, margin: "0 4px 3px 0" }}>{pName(db,a.projectId)}: {qty(a.qty)}</span>)}</div>}</td>
      <td style={S.tableStyles.td}><b>{total}</b></td><td style={S.tableStyles.td}><span style={S.pill(level)}>{label}</span></td>
      {can.finance && <td style={S.tableStyles.td}>{fmtRp(total * qty(m.harga))}</td>}
      <td style={S.tableStyles.td}><div style={S.row}>
        <button style={S.btnSm("ghost")} onClick={() => toggleHistory(m)}>🕘 Riwayat</button>
        {can.manage && m.isActive !== false && <button disabled={busy} style={S.btnSm("yellow")} onClick={() => editMaterial(m)}>Ubah</button>}
        {can.manage && <button disabled={busy || (!empty && m.isActive !== false)} title={!empty && m.isActive !== false ? "Stok gudang dan alokasi harus 0" : ""} style={S.btnSm(isArchived ? "green" : "ghost")} onClick={() => setArchive(m, !isArchived)}>{isArchived ? "Pulihkan" : "Arsip"}</button>}
      </div></td>
    </tr>{historyOpen === m.id && renderHistory(m)}</React.Fragment>;
  };

  return <div style={{ padding: 22, maxWidth: 1280 }}>
    <div style={S.note}>Saldo Project terpisah dari Inventori utama. Setiap restock, alokasi, pemakaian, koreksi, dan arsip kini tercatat dalam satu ledger audit.</div>
    {reconciliation && reconciliation.ok === false && <div style={S.alert(false)}>🚨 Rekonsiliasi menemukan {reconciliation.issue_count} selisih saldo. Hindari mutasi lanjutan dan periksa ledger.</div>}
    <div style={{ ...S.between, marginBottom: 14 }}><div style={S.sectionTitle}><h2 style={S.sectionTitleH}>Stok Material Project</h2></div>
      {can.manage && <div style={S.row}><button disabled={busy} style={S.btnSm("ghost")} onClick={addMaterial}>+ Item</button><button disabled={busy} style={S.btnSm("ghost")} onClick={restock}>Restock Gudang</button><button disabled={busy} style={S.btnSm()} onClick={allocate}>Alokasi ke Project</button></div>}
    </div>
    <div style={{ ...S.row, marginBottom: 14 }}>{[
      ["Aktif",stats.active,cs.accent],["Gudang",stats.warehouse,cs.green],["Dialokasikan",stats.allocated,cs.ara],["Kritis/Habis",stats.critical,cs.red],["Arsip",stats.archived,cs.muted],
    ].map(([l,v,c]) => <div key={l} style={S.minicard}><div style={S.minicardL}>{l}</div><div style={{ ...S.minicardV, color:c }}>{v}</div></div>)}{can.finance && <div style={S.minicard}><div style={S.minicardL}>Nilai stok</div><div style={{ ...S.minicardV,color:cs.green,fontSize:15 }}>{fmtRp(stats.value)}</div></div>}</div>
    <div style={{ ...S.row, marginBottom: 10 }}><input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="🔍 Cari nama, kelompok, varian…" style={{ ...S.select, flex:"1 1 260px" }}/>
      {["Aktif","Kritis","Habis","Diarsipkan","Semua"].map((x)=><span key={x} style={S.chip(statusFilter===x)} onClick={()=>setStatusFilter(x)}>{x}</span>)}</div>
    <div style={{ ...S.row, marginBottom: 10 }}>{["Semua",...MAT_SUBS].map((x)=><span key={x} style={S.chip(subFilter===x)} onClick={()=>setSubFilter(x)}>{x}</span>)}</div>
    <div style={{ ...S.muted,fontSize:12,marginBottom:8 }}>{shown.length} material ditampilkan</div>
    <div style={{ ...S.cardZero, overflowX:"auto" }}><table style={S.tableStyles.table}><thead><tr>
      <th style={S.tableStyles.th}>Material</th><th style={S.tableStyles.th}>Satuan</th><th style={S.tableStyles.th}>Gudang</th><th style={S.tableStyles.th}>Alokasi</th><th style={S.tableStyles.th}>Total fisik</th><th style={S.tableStyles.th}>Status</th>{can.finance&&<th style={S.tableStyles.th}>Nilai</th>}<th style={S.tableStyles.th}>Aksi</th>
    </tr></thead><tbody>{shown.length===0?<tr><td colSpan={colSpan} style={{ ...S.tableStyles.td,textAlign:"center",padding:24,...S.muted }}>Tidak ada material sesuai filter.</td></tr>:shownSubs.map((sub)=><React.Fragment key={sub}>
      <tr><td colSpan={colSpan} style={{ background:"#0f1b30",color:cs.ara,fontWeight:700,fontSize:11,padding:"9px 12px" }}>{sub.toUpperCase()}</td></tr>
      {groupsOf(rowsBySub[sub]).map(([group,items])=>{const multi=items.length>1;if(!multi)return renderRow(items[0]);const key=`${sub}|${group}`;const open=!collapsed[key];return <React.Fragment key={key}><tr onClick={()=>setCollapsed((c)=>({...c,[key]:!c[key]}))} style={{cursor:"pointer"}}><td colSpan={colSpan} style={{background:"#0c1526",padding:"8px 12px",fontWeight:700,color:cs.text}}>{open?"▾":"▸"} {group} <span style={S.muted}>· {items.length} item</span></td></tr>{open&&items.map((m)=>renderRow(m,true))}</React.Fragment>;})}
    </React.Fragment>)}</tbody></table></div>
    <div style={{ ...S.muted,fontSize:11,marginTop:10 }}>Operator: {currentUser?.name || "-"} · Riwayat dimuat hanya saat dibuka agar halaman tetap ringan.</div>
  </div>;
}
