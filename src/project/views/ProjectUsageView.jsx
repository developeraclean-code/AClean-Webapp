import React, { useMemo, useState } from "react";
import { cs } from "../../theme/cs.js";
import * as S from "../utils/styles.js";
import { useProject } from "../context/ProjectContext.jsx";
import { useModal } from "../context/ModalContext.jsx";
import { isLocked, pName } from "../utils/finance.js";
import { fmtRp } from "../utils/constants.js";

const MANUAL = "✏️ Input manual / beli di lokasi";
const n = (v) => Number(v) || 0;
const mutationId = (prefix) => `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;

export default function ProjectUsageView() {
  const { db, can, today, runStockMutation, currentUser } = useProject();
  const { openForm, toast } = useModal();
  const [projectFilter, setProjectFilter] = useState("Semua Project");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [showVoided, setShowVoided] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState({});
  const [busy, setBusy] = useState(false);

  const activeProjects = db.projects.filter((p) => p.status !== "SELESAI");
  const projectOptions = db.projects.map((p) => `${p.nama} · ${p.id.slice(-6)}`);
  const activeProjectOptions = activeProjects.map((p) => `${p.nama} · ${p.id.slice(-6)}`);
  const projectByOption = (label) => db.projects.find((p) => `${p.nama} · ${p.id.slice(-6)}` === label);

  const execute = async (rpc, params, success) => {
    if (busy) return;
    setBusy(true);
    try { await runStockMutation(rpc, params); toast(success); }
    catch (e) { toast(`Gagal: ${e.message || e}`, 3500); }
    finally { setBusy(false); }
  };

  const addUsage = () => {
    if (!activeProjectOptions.length) return toast("Tidak ada project aktif");
    // Options contain immutable IDs, while the visible text still stays readable.
    const materialLabels = db.materials.filter((m) => m.isActive !== false).map((m) => `${m.nama} · ${m.id.slice(-6)}`);
    openForm({ title: "Catat Pemakaian Material", fields: [
      { name: "project", label: "Project", type: "select", options: activeProjectOptions },
      { name: "tanggal", label: "Tanggal pemakaian", type: "date", val: today },
      { name: "oleh", label: "Dipakai oleh", val: currentUser?.name || "" },
      { name: "notes", label: "Catatan pekerjaan / area", type: "textarea", ph: "Contoh: instalasi lantai 2 area meeting" },
      { name: "rows", label: "Material terpakai", type: "grid", hint: "Material stok wajib mempunyai alokasi yang cukup. Input manual tidak memengaruhi stok.", columns: [
        { key: "material", label: "Material", type: "select", options: [...materialLabels, MANUAL] },
        { key: "manual", label: "Nama jika manual" }, { key: "qty", label: "Qty", type: "number" }, { key: "satuan", label: "Satuan" },
      ] },
    ], onSubmit: (d) => {
      const project = projectByOption(d.project);
      if (!project) return toast("Project tidak ditemukan");
      if (isLocked(db, project.id, d.tanggal || today)) return toast("🔒 Tanggal project sudah dikunci");
      const rows = (d.rows || []).map((r) => {
        const manual = r.material === MANUAL;
        const mat = manual ? null : db.materials.find((m) => `${m.nama} · ${m.id.slice(-6)}` === r.material);
        return { materialId: mat?.id || null, material: manual ? r.manual?.trim() : mat?.nama, qty: n(r.qty), satuan: r.satuan || mat?.satuan || "" };
      }).filter((r) => r.material && r.qty > 0);
      if (!rows.length) return toast("Isi minimal satu material dan qty");
      const totals = rows.reduce((a, r) => { if (r.materialId) a[r.materialId]=(a[r.materialId]||0)+r.qty; return a; }, {});
      const insufficient = Object.entries(totals).map(([mid,want]) => {
        const mat=db.materials.find((m)=>m.id===mid); const left=n(db.alokasi.find((a)=>a.materialId===mid&&a.projectId===project.id)?.qty);
        return want>left ? `${mat?.nama}: perlu ${want}, alokasi tersisa ${left}` : null;
      }).filter(Boolean);
      if (insufficient.length) return toast(`Alokasi tidak cukup — ${insufficient.join("; ")}`, 4500);
      execute("record_project_material_usage_atomic", {
        p_project_id: project.id, p_date: d.tanggal || today, p_rows: rows,
        p_used_by: d.oleh || null, p_notes: d.notes || null, p_mutation_key: mutationId("project-usage"),
      }, `${rows.length} pemakaian tercatat`);
    } });
  };

  const voidUsage = (u) => openForm({
    title: `Batalkan Pemakaian — ${u.material}`,
    fields: [{ name: "reason", label: "Alasan pembatalan", type: "textarea", ph: "Contoh: salah pilih material pada input sebelumnya" }],
    onSubmit: (d) => execute("void_project_material_usage_atomic", {
      p_usage_id: u.id, p_reason: d.reason, p_mutation_key: mutationId("project-usage-void"),
    }, "Pemakaian dibatalkan; alokasi dikembalikan dan audit tetap tersimpan"),
  });

  const filtered = useMemo(() => {
    const needle=q.trim().toLowerCase();
    return db.usage.filter((u) => (showVoided || !u.voidedAt)
      && (projectFilter === "Semua Project" || u.projectId === projectFilter)
      && (!from || u.tanggal >= from) && (!to || u.tanggal <= to)
      && (!needle || [u.material,u.oleh,u.notes,pName(db,u.projectId)].some((v)=>String(v||"").toLowerCase().includes(needle))));
  }, [db, projectFilter, from, to, q, showVoided]);

  const summary = useMemo(() => filtered.reduce((a,u)=>{
    if(u.voidedAt){a.voided++;return a;} a.rows++;a.qty+=n(u.qtyNum||u.qty);a.value+=n(u.qtyNum||u.qty)*n(u.harga);a.projects.add(u.projectId);return a;
  },{rows:0,qty:0,value:0,voided:0,projects:new Set()}),[filtered]);
  const groups = useMemo(() => {
    const map=new Map(); filtered.forEach((u)=>map.set(u.projectId,[...(map.get(u.projectId)||[]),u])); return [...map.entries()];
  },[filtered]);

  const UsageTable = ({ rows }) => <div style={{ overflowX:"auto" }}><table style={S.tableStyles.table}><thead><tr>
    <th style={S.tableStyles.th}>Tanggal</th><th style={S.tableStyles.th}>Material</th><th style={S.tableStyles.th}>Qty</th><th style={S.tableStyles.th}>Oleh</th><th style={S.tableStyles.th}>Catatan</th><th style={S.tableStyles.th}>Nilai</th><th style={S.tableStyles.th}>Status / Aksi</th>
  </tr></thead><tbody>{rows.map((u)=><tr key={u.id} style={{opacity:u.voidedAt ? .65 : 1}}>
    <td style={S.tableStyles.td}>{u.tanggal || "-"}{isLocked(db,u.projectId,u.tanggal)&&<span style={{...S.pill("gray"),marginLeft:5}}>🔒</span>}</td>
    <td style={S.tableStyles.td}><b>{u.material}</b>{!u.materialId&&<div style={{...S.muted,fontSize:10}}>Input manual</div>}</td>
    <td style={S.tableStyles.td}><b>{n(u.qtyNum||u.qty)}</b> {u.satuan||""}</td><td style={S.tableStyles.td}>{u.oleh||"-"}</td>
    <td style={S.tableStyles.td}>{u.notes||"-"}</td><td style={S.tableStyles.td}>{u.voidedAt?"-":fmtRp(n(u.qtyNum||u.qty)*n(u.harga))}</td>
    <td style={S.tableStyles.td}>{u.voidedAt?<><span style={S.pill("gray")}>Dibatalkan</span><div style={{...S.muted,fontSize:10,marginTop:3}}>{u.voidReason}</div></>:can.manage?<button disabled={busy} style={S.btnSm("red")} onClick={()=>voidUsage(u)}>Batalkan</button>:<span style={S.pill("green")}>Tercatat</span>}</td>
  </tr>)}</tbody></table></div>;

  return <div style={{padding:22,maxWidth:1280}}>
    <div style={S.note}>Pemakaian stok mengurangi alokasi project secara atomik. Pembatalan tidak menghapus data: qty dikembalikan dan alasan tetap dapat diaudit.</div>
    <div style={{...S.between,marginBottom:14}}><div style={S.sectionTitle}><h2 style={S.sectionTitleH}>Pemakaian Material Project</h2></div>{can.manage&&<button disabled={busy} style={S.btn()} onClick={addUsage}>+ Catat Pemakaian</button>}</div>
    <div style={{...S.row,marginBottom:14}}>{[["Transaksi",summary.rows,cs.accent],["Project",summary.projects.size,cs.ara],["Total qty",summary.qty,cs.green],["Dibatalkan",summary.voided,cs.muted]].map(([l,v,c])=><div key={l} style={S.minicard}><div style={S.minicardL}>{l}</div><div style={{...S.minicardV,color:c}}>{v}</div></div>)}{can.finance&&<div style={S.minicard}><div style={S.minicardL}>Nilai terpakai</div><div style={{...S.minicardV,color:cs.green,fontSize:15}}>{fmtRp(summary.value)}</div></div>}</div>
    <div style={{...S.card,marginBottom:14}}><div style={{...S.row,gap:8}}>
      <select style={{...S.select,minWidth:220}} value={projectFilter} onChange={(e)=>setProjectFilter(e.target.value)}><option value="Semua Project">Semua Project</option>{db.projects.map((p)=><option key={p.id} value={p.id}>{p.nama}</option>)}</select>
      <input type="date" value={from} onChange={(e)=>setFrom(e.target.value)} style={S.select}/><span style={S.muted}>s/d</span><input type="date" value={to} onChange={(e)=>setTo(e.target.value)} style={S.select}/>
      <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Cari material, pemakai, catatan…" style={{...S.select,flex:"1 1 240px"}}/>
      <label style={{...S.row,fontSize:12,color:cs.muted}}><input type="checkbox" checked={showVoided} onChange={(e)=>setShowVoided(e.target.checked)}/> Tampilkan batal</label>
      <button style={S.btnSm("ghost")} onClick={()=>{setProjectFilter("Semua Project");setFrom("");setTo("");setQ("");setShowVoided(false);}}>Reset</button>
    </div><div style={{...S.row,marginTop:10}}><span style={S.chip(grouped)} onClick={()=>setGrouped(true)}>Kelompok per project</span><span style={S.chip(!grouped)} onClick={()=>setGrouped(false)}>Semua transaksi</span></div></div>
    {filtered.length===0?<div style={{...S.card,textAlign:"center",padding:30,...S.muted}}>Tidak ada pemakaian sesuai filter.</div>:grouped?<div style={{display:"grid",gap:10}}>{groups.map(([pid,rows])=>{const open=!collapsed[pid];const total=rows.filter((u)=>!u.voidedAt).reduce((s,u)=>s+n(u.qtyNum||u.qty)*n(u.harga),0);return <div key={pid} style={S.cardZero}>
      <div onClick={()=>setCollapsed((c)=>({...c,[pid]:!c[pid]}))} style={{...S.between,padding:"12px 14px",cursor:"pointer",background:"#0f1b30"}}><div><b style={{color:cs.text}}>{open?"▾":"▸"} {pName(db,pid)}</b><div style={{...S.muted,fontSize:11}}>{rows.length} catatan · {rows.reduce((s,u)=>s+n(u.qtyNum||u.qty),0)} qty</div></div>{can.finance&&<b style={{color:cs.green}}>{fmtRp(total)}</b>}</div>{open&&<UsageTable rows={rows}/>}</div>;})}</div>:<div style={S.cardZero}><UsageTable rows={filtered.map((u)=>({...u,material:`${u.material} · ${pName(db,u.projectId)}`}))}/></div>}
  </div>;
}
