import { useEffect, useState, useCallback } from "react";
import { cs } from "../theme/cs.js";

// Modul Maintenance (B2B Asset Registry) — internal (Owner/Admin).
// Semua data via backend /api/maintenance (tabel RLS-restrictive, anon diblok).
// Props: currentUser, apiFetch, showNotif, showConfirm

const PORTAL_BASE = (typeof window !== "undefined" ? window.location.origin : "") + "/m/";
const AC_TYPES = ["split", "cassette", "standing", "floor"];
const REFRIGERANTS = ["R32", "R410A", "R22"];
const STATUSES = ["active", "rusak", "retired"];

function fmtRp(n) { return n == null ? "—" : "Rp " + Number(n).toLocaleString("id-ID"); }
function statusPill(s) {
  const map = { active: [cs.green, "Aktif"], rusak: [cs.red, "Rusak"], retired: [cs.muted, "Retired"] };
  const [c, l] = map[s] || [cs.muted, s];
  return <span style={{ background: c + "22", color: c, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{l}</span>;
}

export default function MaintenanceView({ currentUser, apiFetch, showNotif, showConfirm }) {
  const isOwner = currentUser?.role === "Owner";
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);          // selected client object
  const [tab, setTab] = useState("unit");
  const [units, setUnits] = useState([]);
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (action, payload = {}) => {
    const r = await apiFetch("/api/maintenance", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Gagal");
    return j;
  }, [apiFetch]);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try { const j = await call("list-clients"); setClients(j.clients || []); }
    catch (e) { showNotif("❌ " + e.message); }
    finally { setLoading(false); }
  }, [call, showNotif]);

  useEffect(() => { loadClients(); }, [loadClients]);

  const openClient = useCallback(async (c) => {
    setSel(c); setTab("unit"); setUnits([]); setLogs([]);
    try {
      const [u, l] = await Promise.all([call("list-units", { client_id: c.id }), call("list-logs", { client_id: c.id })]);
      setUnits(u.units || []); setLogs(l.logs || []);
    } catch (e) { showNotif("❌ " + e.message); }
  }, [call, showNotif]);

  // ---------- create client ----------
  const [newName, setNewName] = useState("");
  const addClient = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try { const j = await call("create-client", { name: newName.trim() }); setNewName(""); await loadClients(); openClient(j.client); showNotif("✅ Klien dibuat"); }
    catch (e) { showNotif("❌ " + e.message); }
    finally { setBusy(false); }
  };

  if (!sel) {
    return (
      <div style={{ padding: 18 }}>
        <h2 style={{ color: cs.text, margin: "0 0 14px" }}>🏢 Maintenance — Customer Korporat</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, maxWidth: 480 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nama perusahaan baru…"
            onKeyDown={e => e.key === "Enter" && addClient()}
            style={inp} />
          <button onClick={addClient} disabled={busy} style={btn}>+ Tambah</button>
        </div>
        {loading ? <div style={{ color: cs.muted }}>Memuat…</div> :
          clients.length === 0 ? <div style={{ color: cs.muted }}>Belum ada perusahaan. Tambahkan di atas.</div> :
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
              {clients.map(c => (
                <div key={c.id} onClick={() => openClient(c)} style={{ ...card, cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 700, color: cs.text, fontSize: 15 }}>{c.name}</div>
                    <span style={{ marginLeft: "auto", ...(c.contract_status === "active" ? pillGreen : pillGray) }}>
                      {c.contract_status === "active" ? "● Aktif" : "Nonaktif"}
                    </span>
                  </div>
                  <div style={{ color: cs.muted, fontSize: 12, marginTop: 6 }}>
                    {c.pic_name ? `PIC: ${c.pic_name}` : "PIC belum diisi"} {c.pic_phone ? `· ${c.pic_phone}` : ""}
                  </div>
                  <div style={{ color: cs.muted, fontSize: 11, marginTop: 6 }}>
                    {c.token_active ? "🔓 Portal aktif" : "🔒 Portal off"} · {c.hide_costs ? "Biaya disembunyikan" : "Biaya tampil"}
                  </div>
                </div>
              ))}
            </div>}
      </div>
    );
  }

  return (
    <div style={{ padding: 18 }}>
      <button onClick={() => { setSel(null); loadClients(); }} style={{ ...btnGhost, marginBottom: 12 }}>← Semua Perusahaan</button>
      <ClientHeader sel={sel} units={units} />
      <div style={{ display: "flex", gap: 6, margin: "14px 0" }}>
        {[["unit", `📋 Unit (${units.length})`], ["history", "🕑 History"], ["invoice", "🧾 Invoice B2B"], ["portal", "🔗 Portal & Akses"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={tab === k ? tabActive : tabBtn}>{l}</button>
        ))}
      </div>
      {tab === "unit" && <UnitsTab sel={sel} units={units} setUnits={setUnits} call={call} showNotif={showNotif} showConfirm={showConfirm} isOwner={isOwner} />}
      {tab === "history" && <HistoryTab units={units} logs={logs} setLogs={setLogs} sel={sel} call={call} showNotif={showNotif} showConfirm={showConfirm} isOwner={isOwner} />}
      {tab === "invoice" && <InvoiceTab sel={sel} units={units} logs={logs} call={call} showNotif={showNotif} />}
      {tab === "portal" && <PortalTab sel={sel} setSel={setSel} call={call} showNotif={showNotif} showConfirm={showConfirm} isOwner={isOwner} onChanged={loadClients} />}
    </div>
  );
}

function ClientHeader({ sel, units }) {
  const active = units.filter(u => u.status === "active").length;
  const rusak = units.filter(u => u.status === "rusak").length;
  return (
    <div style={{ ...card, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: cs.text }}>🏢 {sel.name}</div>
        <div style={{ color: cs.muted, fontSize: 12 }}>{[sel.pic_name && "PIC: " + sel.pic_name, sel.pic_phone, sel.address].filter(Boolean).join(" · ") || "Detail PIC belum diisi"}</div>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 18 }}>
        <Kpi n={units.length} l="Unit" />
        <Kpi n={active} l="Aktif" c={cs.green} />
        <Kpi n={rusak} l="Rusak" c={cs.red} />
      </div>
    </div>
  );
}
function Kpi({ n, l, c }) {
  return <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 800, color: c || cs.text }}>{n}</div><div style={{ fontSize: 10, color: cs.muted, textTransform: "uppercase" }}>{l}</div></div>;
}

// ─────────── UNITS TAB ───────────
function UnitsTab({ sel, units, setUnits, call, showNotif, showConfirm, isOwner }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [edit, setEdit] = useState(null); // unit being edited (or {} for new)
  const filtered = units.filter(u =>
    (u.unit_code + (u.location || "") + (u.brand || "")).toLowerCase().includes(q.toLowerCase()) &&
    (!filter || u.ac_type === filter));

  const save = async (u) => {
    if (!u.unit_code?.trim()) { showNotif("❌ Kode unit wajib"); return; }
    try {
      const j = await call("save-units", { client_id: sel.id, units: [{ ...u, client_id: sel.id }] });
      const saved = (j.units || [])[0];
      setUnits(prev => {
        const others = prev.filter(x => x.id !== saved.id && x.unit_code !== saved.unit_code);
        return [...others, saved].sort((a, b) => a.unit_code.localeCompare(b.unit_code));
      });
      setEdit(null); showNotif("✅ Unit disimpan");
    } catch (e) { showNotif("❌ " + e.message); }
  };
  const del = async (u) => {
    const ok = await showConfirm({ title: "Hapus unit?", message: `Hapus ${u.unit_code} beserta semua history-nya?` });
    if (!ok) return;
    try { await call("delete-unit", { id: u.id }); setUnits(prev => prev.filter(x => x.id !== u.id)); showNotif("✅ Unit dihapus"); }
    catch (e) { showNotif("❌ " + e.message); }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari kode / lokasi / brand…" style={inp} />
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inp, maxWidth: 160 }}>
          <option value="">Semua jenis</option>{AC_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <button onClick={() => setEdit({ unit_code: "", status: "active" })} style={btnGhost}>+ Tambah Unit</button>
      </div>
      <div style={{ ...card, padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Kode", "Lokasi", "Brand", "Jenis", "Kapasitas", "Freon", "Status", "Servis Terakhir", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.length === 0 ? <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: cs.muted, padding: 24 }}>Tidak ada unit.</td></tr> :
              filtered.map(u => (
                <tr key={u.id}>
                  <td style={td}><b style={{ color: cs.text }}>{u.unit_code}</b></td>
                  <td style={td}>{u.location || "—"}</td>
                  <td style={td}>{u.brand || "—"}</td>
                  <td style={td}>{u.ac_type ? <span style={pillBlue}>{u.ac_type}</span> : "—"}</td>
                  <td style={td}>{u.capacity_pk ? u.capacity_pk + " PK" : "—"}</td>
                  <td style={td}>{u.refrigerant || "—"}</td>
                  <td style={td}>{statusPill(u.status)}</td>
                  <td style={{ ...td, color: cs.muted }}>{u.last_service_date || "—"}</td>
                  <td style={td}>
                    <button onClick={() => setEdit(u)} style={miniBtn}>✏️</button>
                    {isOwner && <button onClick={() => del(u)} style={{ ...miniBtn, color: cs.red }}>🗑</button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {edit && <UnitModal unit={edit} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  );
}

function UnitModal({ unit, onClose, onSave }) {
  const [f, setF] = useState(unit);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Overlay onClose={onClose}>
      <div style={{ fontWeight: 700, color: cs.text, fontSize: 16, marginBottom: 14 }}>{unit.id ? "Edit Unit" : "Tambah Unit"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field l="Kode Unit *"><input value={f.unit_code || ""} onChange={e => set("unit_code", e.target.value)} style={inp} /></Field>
        <Field l="Lokasi"><input value={f.location || ""} onChange={e => set("location", e.target.value)} style={inp} /></Field>
        <Field l="Brand"><input value={f.brand || ""} onChange={e => set("brand", e.target.value)} style={inp} /></Field>
        <Field l="Jenis"><select value={f.ac_type || ""} onChange={e => set("ac_type", e.target.value)} style={inp}><option value="">—</option>{AC_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
        <Field l="Kapasitas (PK)"><input type="number" step="0.5" value={f.capacity_pk ?? ""} onChange={e => set("capacity_pk", e.target.value)} style={inp} /></Field>
        <Field l="Freon"><select value={f.refrigerant || ""} onChange={e => set("refrigerant", e.target.value)} style={inp}><option value="">—</option>{REFRIGERANTS.map(t => <option key={t}>{t}</option>)}</select></Field>
        <Field l="Tahun Pasang"><input type="number" value={f.year_installed ?? ""} onChange={e => set("year_installed", e.target.value)} style={inp} /></Field>
        <Field l="Serial No"><input value={f.serial_no || ""} onChange={e => set("serial_no", e.target.value)} style={inp} /></Field>
        <Field l="Status"><select value={f.status || "active"} onChange={e => set("status", e.target.value)} style={inp}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btnGhost}>Batal</button>
        <button onClick={() => onSave(f)} style={btn}>Simpan</button>
      </div>
    </Overlay>
  );
}

// ─────────── HISTORY TAB ───────────
function HistoryTab({ units, logs, setLogs, sel, call, showNotif, showConfirm, isOwner }) {
  const [open, setOpen] = useState(null);
  const [addFor, setAddFor] = useState(null);
  const logsByUnit = (uid) => logs.filter(l => l.unit_id === uid).sort((a, b) => (b.service_date || "").localeCompare(a.service_date || ""));

  return (
    <div>
      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 10 }}>Klik unit untuk lihat riwayat servis. Tombol + untuk tambah log.</div>
      {units.map(u => {
        const ul = logsByUnit(u.id);
        const isOpen = open === u.id;
        return (
          <div key={u.id} style={{ ...card, padding: 0, marginBottom: 10 }}>
            <div onClick={() => setOpen(isOpen ? null : u.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer" }}>
              <b style={{ color: cs.text }}>{u.unit_code}</b>
              <span style={{ color: cs.muted, fontSize: 12 }}>{u.location} · {u.brand} {u.capacity_pk}PK</span>
              {statusPill(u.status)}
              <span style={{ color: cs.muted, fontSize: 12 }}>{ul.length} riwayat</span>
              <button onClick={e => { e.stopPropagation(); setAddFor(u); }} style={{ ...miniBtn, marginLeft: "auto" }}>+ Log</button>
              <span style={{ color: cs.muted, transform: isOpen ? "rotate(90deg)" : "none", transition: ".2s" }}>▶</span>
            </div>
            {isOpen && (
              <div style={{ borderTop: "1px solid " + cs.border, padding: 14 }}>
                {ul.length === 0 ? <div style={{ color: cs.muted, fontSize: 12 }}>Belum ada riwayat.</div> :
                  ul.map(l => (
                    <div key={l.id} style={{ borderLeft: "2px solid " + cs.border, paddingLeft: 12, marginBottom: 12 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <b style={{ color: cs.text }}>{l.service_type || "Servis"}</b>
                        <span style={{ color: cs.muted, fontSize: 12 }}>{l.service_date}</span>
                        {l.cost > 0 && <span style={pillYellow}>{fmtRp(l.cost)}</span>}
                        {l.invoiced && <span style={pillGreen}>✓ Invoiced</span>}
                        {isOwner && <button onClick={async () => { if (!(await showConfirm({ title: "Hapus log?", message: "Hapus riwayat ini?" }))) return; try { await call("delete-log", { id: l.id }); setLogs(p => p.filter(x => x.id !== l.id)); showNotif("✅ Dihapus"); } catch (e) { showNotif("❌ " + e.message); } }} style={{ ...miniBtn, color: cs.red, marginLeft: "auto" }}>🗑</button>}
                      </div>
                      {l.description && <div style={{ fontSize: 13, color: cs.text, margin: "3px 0" }}>{l.description}</div>}
                      <div style={{ color: cs.muted, fontSize: 12 }}>👷 {l.technician || "—"}</div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        );
      })}
      {addFor && <LogModal unit={addFor} onClose={() => setAddFor(null)} onSave={async (payload) => {
        try { const j = await call("create-log", { ...payload, unit_id: addFor.id, client_id: sel.id }); setLogs(p => [j.log, ...p]); setAddFor(null); showNotif("✅ Log ditambahkan"); }
        catch (e) { showNotif("❌ " + e.message); }
      }} />}
    </div>
  );
}

function LogModal({ unit, onClose, onSave }) {
  const [f, setF] = useState({ service_date: new Date().toISOString().slice(0, 10), service_type: "Cuci Rutin" });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Overlay onClose={onClose}>
      <div style={{ fontWeight: 700, color: cs.text, fontSize: 16, marginBottom: 4 }}>Tambah Log — {unit.unit_code}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        <Field l="Tanggal *"><input type="date" value={f.service_date} onChange={e => set("service_date", e.target.value)} style={inp} /></Field>
        <Field l="Jenis Servis"><input value={f.service_type || ""} onChange={e => set("service_type", e.target.value)} style={inp} placeholder="Cuci / Perbaikan / Isi Freon" /></Field>
        <Field l="Teknisi"><input value={f.technician || ""} onChange={e => set("technician", e.target.value)} style={inp} /></Field>
        <Field l="Biaya (Rp)"><input type="number" value={f.cost ?? ""} onChange={e => set("cost", e.target.value)} style={inp} /></Field>
      </div>
      <Field l="Deskripsi"><textarea value={f.description || ""} onChange={e => set("description", e.target.value)} style={{ ...inp, minHeight: 64, resize: "vertical" }} /></Field>
      <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btnGhost}>Batal</button>
        <button onClick={() => onSave(f)} style={btn}>Simpan</button>
      </div>
    </Overlay>
  );
}

// ─────────── INVOICE B2B TAB ───────────
function InvoiceTab({ sel, units, logs, call, showNotif }) {
  const [picked, setPicked] = useState({});
  const uncosted = logs.filter(l => !l.invoiced);
  const unitName = (uid) => units.find(u => u.id === uid)?.unit_code || "?";
  const total = uncosted.filter(l => picked[l.id]).reduce((s, l) => s + (Number(l.cost) || 0), 0);
  const count = Object.values(picked).filter(Boolean).length;

  const create = async () => {
    const ids = Object.keys(picked).filter(k => picked[k]);
    if (!ids.length) { showNotif("❌ Pilih minimal 1 servis"); return; }
    try {
      const j = await call("create-invoice", { client_id: sel.id, log_ids: ids });
      showNotif(`✅ Invoice ${j.invoice.id} dibuat (PENDING_APPROVAL) — cek menu Invoice`);
      setPicked({});
    } catch (e) { showNotif("❌ " + e.message); }
  };

  return (
    <div>
      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 12 }}>Pilih servis yang belum di-invoice untuk dijadikan 1 invoice B2B. Invoice masuk ke menu Invoice (status PENDING_APPROVAL) dan mengikuti alur approve/bayar/PDF biasa.</div>
      {uncosted.length === 0 ? <div style={{ color: cs.muted }}>Tidak ada servis yang belum di-invoice.</div> :
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          {uncosted.map(l => (
            <label key={l.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid " + cs.border, cursor: "pointer" }}>
              <input type="checkbox" checked={!!picked[l.id]} onChange={e => setPicked(p => ({ ...p, [l.id]: e.target.checked }))} />
              <b style={{ color: cs.text }}>{unitName(l.unit_id)}</b>
              <span style={{ color: cs.muted, fontSize: 12 }}>{l.service_type} · {l.service_date}</span>
              <span style={{ marginLeft: "auto", color: cs.text }}>{fmtRp(l.cost)}</span>
            </label>
          ))}
        </div>}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
        <div style={{ color: cs.text }}>Dipilih: <b>{count}</b> servis · Total <b style={{ color: cs.green }}>{fmtRp(total)}</b></div>
        <button onClick={create} disabled={!count} style={{ ...btn, marginLeft: "auto", opacity: count ? 1 : .5 }}>🧾 Buat Invoice B2B</button>
      </div>
    </div>
  );
}

// ─────────── PORTAL & AKSES TAB ───────────
function PortalTab({ sel, setSel, call, showNotif, showConfirm, isOwner }) {
  const [c, setC] = useState(sel);
  useEffect(() => { setC(sel); }, [sel]);
  const url = PORTAL_BASE + (c.portal_token || "");
  const patch = async (upd) => {
    try {
      const j = await call("update-client", { id: c.id, ...upd });
      setC(j.client); setSel(j.client); showNotif("✅ Tersimpan");
    } catch (e) { showNotif("❌ " + e.message); }
  };
  const regen = async () => {
    const ok = await showConfirm({ title: "Regenerate token?", message: "URL & QR lama akan langsung mati. Customer perlu link baru." });
    if (!ok) return;
    try { const j = await call("regen-token", { id: c.id }); setC(j.client); setSel(j.client); showNotif("✅ Token baru dibuat"); }
    catch (e) { showNotif("❌ " + e.message); }
  };

  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      <div style={{ ...card, flex: 1, minWidth: 320 }}>
        <div style={{ fontWeight: 700, color: cs.text, marginBottom: 12 }}>🔗 Token Portal Customer (Permanen)</div>
        <div style={{ color: cs.muted, fontSize: 12 }}>URL akses customer</div>
        <div style={{ display: "flex", gap: 8, margin: "6px 0 16px" }}>
          <input readOnly value={url} style={inp} />
          <button onClick={() => { navigator.clipboard?.writeText(url); showNotif("✅ URL disalin"); }} style={btnGhost}>Salin</button>
        </div>
        <ToggleRow label="Akses portal aktif" desc="Matikan jika kerjasama berakhir → customer kena 403"
          checked={!!c.token_active} onChange={v => patch({ token_active: v })} />
        <ToggleRow label="Sembunyikan biaya" desc="Customer lihat riwayat tanpa nominal (di-strip backend)"
          checked={!!c.hide_costs} onChange={v => patch({ hide_costs: v })} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0" }}>
          <div><div style={{ fontWeight: 600, color: cs.text }}>Masa berlaku</div><div style={{ color: cs.muted, fontSize: 12 }}>Kosong = permanen</div></div>
          <input type="date" value={(c.token_expires_at || "").slice(0, 10)} onChange={e => patch({ token_expires_at: e.target.value ? e.target.value + "T23:59:59Z" : null })} style={{ ...inp, maxWidth: 180, marginLeft: "auto" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <div><div style={{ fontWeight: 600, color: cs.text }}>Status kontrak</div></div>
          <select value={c.contract_status} onChange={e => patch({ contract_status: e.target.value })} style={{ ...inp, maxWidth: 180, marginLeft: "auto" }}>
            <option value="active">Aktif</option><option value="inactive">Nonaktif</option>
          </select>
        </div>
        {isOwner && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16 }}>
            <button onClick={regen} style={{ ...btn, background: cs.red, color: "#fff" }}>♻️ Regenerate Token</button>
            <span style={{ color: cs.muted, fontSize: 12 }}>URL & QR lama langsung mati</span>
          </div>
        )}
      </div>
      <div style={{ ...card, width: 220, textAlign: "center" }}>
        <div style={{ fontWeight: 700, color: cs.text, marginBottom: 10 }}>QR Akses</div>
        <img alt="QR" style={{ width: 160, height: 160, borderRadius: 10, background: "#fff" }}
          src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}`} />
        <div style={{ color: cs.muted, fontSize: 12, marginTop: 10 }}>Tempel di ruang teknik customer</div>
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0" }}>
      <div><div style={{ fontWeight: 600, color: cs.text }}>{label}</div><div style={{ color: cs.muted, fontSize: 12 }}>{desc}</div></div>
      <label style={{ marginLeft: "auto", position: "relative", width: 42, height: 24, flexShrink: 0 }}>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ display: "none" }} />
        <span style={{ position: "absolute", inset: 0, background: checked ? cs.green : "#334155", borderRadius: 24, transition: ".2s", cursor: "pointer" }}>
          <span style={{ position: "absolute", width: 18, height: 18, left: checked ? 21 : 3, top: 3, background: "#fff", borderRadius: "50%", transition: ".2s" }} />
        </span>
      </label>
    </div>
  );
}

// ─────────── shared bits ───────────
function Field({ l, children }) { return <label style={{ display: "block", marginTop: 8 }}><div style={{ fontSize: 12, color: cs.muted, marginBottom: 4 }}>{l}</div>{children}</label>; }
function Overlay({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto" }}>{children}</div>
    </div>
  );
}

const inp = { background: cs.surface, border: "1px solid " + cs.border, color: cs.text, borderRadius: 8, padding: "8px 10px", fontSize: 13, width: "100%", boxSizing: "border-box" };
const card = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 16 };
const btn = { background: cs.accent, color: "#04121f", border: 0, borderRadius: 9, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" };
const btnGhost = { ...btn, background: "transparent", color: cs.text, border: "1px solid " + cs.border };
const miniBtn = { background: "transparent", border: "1px solid " + cs.border, color: cs.text, borderRadius: 7, padding: "3px 7px", cursor: "pointer", fontSize: 12 };
const tabBtn = { background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 600, fontSize: 13 };
const tabActive = { ...tabBtn, color: cs.accent, borderColor: cs.accent };
const th = { textAlign: "left", padding: "9px 10px", borderBottom: "1px solid " + cs.border, color: cs.muted, fontSize: 11, textTransform: "uppercase", whiteSpace: "nowrap" };
const td = { padding: "9px 10px", borderBottom: "1px solid " + cs.border, color: cs.text };
const pillGreen = { background: cs.green + "22", color: cs.green, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 };
const pillGray = { background: cs.muted + "22", color: cs.muted, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 };
const pillBlue = { background: cs.accent + "22", color: cs.accent, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 };
const pillYellow = { background: cs.yellow + "22", color: cs.yellow, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 };
