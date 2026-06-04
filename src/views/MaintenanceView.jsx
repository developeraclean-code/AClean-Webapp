import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { cs } from "../theme/cs.js";

const QuotationModal = lazy(() => import("./QuotationModal.jsx"));
const QuotationPDFModule = lazy(() =>
  Promise.all([
    import("./QuotationModal.jsx"),
    import("@react-pdf/renderer"),
    import("../components/QuotationPDF.jsx"),
  ]).then(([, renderer, pdf]) => ({
    default: ({ quo, appSettings, logoUrl, onClose }) => {
      const { BlobProvider } = renderer;
      const QuotationPDF = pdf.default;
      const fmt = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
      return (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: cs.surface, borderRadius: 16, padding: 16, width: "100%", maxWidth: 540 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>👁 Preview PDF — {quo.id}</div>
              <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
            <BlobProvider document={<QuotationPDF quo={quo} appSettings={appSettings || {}} logoUrl={logoUrl} />}>
              {({ url, loading, error }) => {
                if (loading) return <div style={{ textAlign: "center", padding: 24, color: cs.muted }}>Membuat PDF…</div>;
                if (error) return <div style={{ textAlign: "center", padding: 24, color: cs.red }}>Gagal buat PDF</div>;
                return (
                  <div style={{ display: "flex", gap: 10 }}>
                    <a href={url} target="_blank" rel="noreferrer" style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: cs.accent, color: "#04121f", fontWeight: 700, fontSize: 13, textAlign: "center", textDecoration: "none" }}>🔗 Buka PDF</a>
                    <a href={url} download={`${quo.id}.pdf`} style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, fontWeight: 700, fontSize: 13, textAlign: "center", textDecoration: "none" }}>⬇️ Download</a>
                  </div>
                );
              }}
            </BlobProvider>
            <div style={{ marginTop: 10, padding: "8px 12px", background: cs.card, borderRadius: 8, fontSize: 12, color: cs.muted }}>
              Customer: <strong style={{ color: cs.text }}>{quo.customer}</strong> · Total: <strong style={{ color: cs.accent }}>{fmt(quo.total)}</strong>
            </div>
          </div>
        </div>
      );
    }
  }))
);

const PORTAL_BASE = "https://status.aclean.id/status/";
const AC_TYPES = ["split", "cassette", "standing", "floor"];
const AC_TYPE_LABELS = { split: "Split Wall", cassette: "Cassette", standing: "Floor Standing", floor: "Split Duct" };
const REFRIGERANTS = ["R32", "R410A", "R22"];
const STATUSES = ["active", "rusak", "retired"];
const SERVICE_TYPES_LOG = ["Cuci Rutin", "Cuci Besar", "Perbaikan", "Isi Freon", "Ganti Sparepart", "Instalasi", "Cek & Check-Up", "Lainnya"];
const MATERIAL_UNITS = ["kg", "gram", "liter", "pcs", "meter", "set"];

function fmtRp(n) { return n == null ? "—" : "Rp " + Number(n).toLocaleString("id-ID"); }
function fmtDate(d) { if (!d) return "—"; try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } }

function statusPill(s) {
  const map = { active: [cs.green, "Aktif"], rusak: [cs.red, "Rusak"], retired: [cs.muted, "Retired"] };
  const [c, l] = map[s] || [cs.muted, s];
  return <span style={{ background: c + "22", color: c, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{l}</span>;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

export default function MaintenanceView({
  currentUser, apiFetch, showNotif, showConfirm,
  quotationsData, setQuotationsData,
  supabase, customersData, priceListData, getLocalDate,
  appSettings, sendWAFn, uploadQuotationPDFFn,
}) {
  const isOwner = currentUser?.role === "Owner";
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
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

  const [clientModal, setClientModal] = useState(null);

  const saveClient = async (form) => {
    if (!form.name?.trim()) { showNotif("❌ Nama perusahaan wajib"); return; }
    setBusy(true);
    try {
      if (form.id) {
        const j = await call("update-client", { ...form });
        setClients(prev => prev.map(c => c.id === j.client.id ? j.client : c));
        if (sel?.id === j.client.id) setSel(j.client);
        showNotif("✅ Data perusahaan diperbarui");
      } else {
        const j = await call("create-client", form);
        setClientModal(null);
        await loadClients();
        openClient(j.client);
        showNotif("✅ Klien dibuat");
      }
      setClientModal(null);
    } catch (e) { showNotif("❌ " + e.message); }
    finally { setBusy(false); }
  };

  const deleteClient = async (c) => {
    const ok = await showConfirm({ title: "Hapus perusahaan?", message: `Hapus "${c.name}" beserta semua unit dan history-nya? Tindakan tidak bisa diurungkan.` });
    if (!ok) return;
    try { await call("delete-client", { id: c.id }); await loadClients(); setSel(null); showNotif("✅ Perusahaan dihapus"); }
    catch (e) { showNotif("❌ " + e.message); }
  };

  if (!sel) {
    return (
      <div style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ color: cs.text, margin: 0 }}>🏢 Maintenance — Customer Korporat</h2>
          <button onClick={() => setClientModal({})} style={{ ...btn, marginLeft: "auto" }}>+ Tambah Perusahaan</button>
        </div>
        {loading ? <div style={{ color: cs.muted }}>Memuat…</div> :
          clients.length === 0 ? <div style={{ color: cs.muted }}>Belum ada perusahaan. Klik "+ Tambah Perusahaan".</div> :
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(290px,1fr))", gap: 12 }}>
              {clients.map(c => {
                const contractDays = daysUntil(c.contract_end_date);
                const contractWarn = contractDays !== null && contractDays <= 30;
                return (
                  <div key={c.id} style={{ ...card, cursor: "pointer" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <div onClick={() => openClient(c)} style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: cs.text, fontSize: 15 }}>{c.name}</div>
                        <div style={{ color: cs.muted, fontSize: 12, marginTop: 4 }}>
                          {c.pic_name ? `PIC: ${c.pic_name}` : "PIC belum diisi"}{c.pic_phone ? ` · ${c.pic_phone}` : ""}
                        </div>
                        {c.address && <div style={{ color: cs.muted, fontSize: 11, marginTop: 2 }}>{c.address}</div>}
                        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                          <span style={c.contract_status === "active" ? pillGreen : pillGray}>
                            {c.contract_status === "active" ? "● Aktif" : "Nonaktif"}
                          </span>
                          <span style={{ ...pillGray, fontSize: 10 }}>{c.token_active ? "🔓 Portal aktif" : "🔒 Portal off"}</span>
                          {c.contract_value && <span style={{ ...pillBlue, fontSize: 10 }}>{fmtRp(c.contract_value)}/thn</span>}
                          {contractWarn && <span style={{ background: cs.yellow + "22", color: cs.yellow, padding: "2px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700 }}>⚠️ Kontrak {contractDays <= 0 ? "EXPIRED" : contractDays + "h lagi"}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                        <button onClick={e => { e.stopPropagation(); setClientModal(c); }} style={miniBtn} title="Edit perusahaan">✏️</button>
                        {isOwner && <button onClick={e => { e.stopPropagation(); deleteClient(c); }} style={{ ...miniBtn, color: cs.red }} title="Hapus perusahaan">🗑</button>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>}
        {clientModal !== null && (
          <ClientFormModal client={clientModal} onClose={() => setClientModal(null)} onSave={saveClient} busy={busy} />
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 18 }}>
      <button onClick={() => { setSel(null); loadClients(); }} style={{ ...btnGhost, marginBottom: 12 }}>← Semua Perusahaan</button>
      <ClientHeader sel={sel} units={units} isOwner={isOwner}
        onEdit={() => setClientModal(sel)}
        onDelete={() => deleteClient(sel).then(() => setSel(null)).catch(() => {})} />
      {clientModal !== null && (
        <ClientFormModal client={clientModal} onClose={() => setClientModal(null)} onSave={saveClient} busy={busy} />
      )}
      {(() => {
        const clientQuotations = (quotationsData || []).filter(q =>
          q.maintenance_client_id === sel.id ||
          (sel.pic_phone && (q.phone === sel.pic_phone || q.phone === sel.pic_phone?.replace(/^62/, "0")))
        );
        return (
          <>
            <div style={{ display: "flex", gap: 6, margin: "14px 0", flexWrap: "wrap" }}>
              {[
                ["unit", `📋 Unit (${units.length})`],
                ["history", "🕑 History"],
                ["stats", "📊 Statistik"],
                ["quotation", `📄 Quotasi (${clientQuotations.length})`],
                ["invoice", "🧾 Invoice B2B"],
                ["portal", "🔗 Portal & Akses"],
              ].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} style={tab === k ? tabActive : tabBtn}>{l}</button>
              ))}
            </div>
            {tab === "unit" && <UnitsTab sel={sel} units={units} setUnits={setUnits} call={call} showNotif={showNotif} showConfirm={showConfirm} isOwner={isOwner} apiFetch={apiFetch} />}
            {tab === "history" && <HistoryTab units={units} logs={logs} setLogs={setLogs} sel={sel} call={call} showNotif={showNotif} showConfirm={showConfirm} isOwner={isOwner} apiFetch={apiFetch} />}
            {tab === "stats" && <StatsTab units={units} logs={logs} sel={sel} />}
            {tab === "quotation" && (
              <QuotasiTab
                sel={sel} quotations={clientQuotations}
                quotationsData={quotationsData} setQuotationsData={setQuotationsData}
                supabase={supabase} customersData={customersData}
                priceListData={priceListData} getLocalDate={getLocalDate}
                showNotif={showNotif} showConfirm={showConfirm} isOwner={isOwner}
                appSettings={appSettings} sendWAFn={sendWAFn}
                uploadQuotationPDFFn={uploadQuotationPDFFn}
              />
            )}
            {tab === "invoice" && <InvoiceTab sel={sel} units={units} logs={logs} call={call} showNotif={showNotif} />}
            {tab === "portal" && <PortalTab sel={sel} setSel={setSel} call={call} showNotif={showNotif} showConfirm={showConfirm} isOwner={isOwner} onChanged={loadClients} />}
          </>
        );
      })()}
    </div>
  );
}

// ─────────── CLIENT HEADER ───────────
function ClientHeader({ sel, units, isOwner, onEdit, onDelete }) {
  const active = units.filter(u => u.status === "active").length;
  const rusak = units.filter(u => u.status === "rusak").length;
  const contractDays = daysUntil(sel.contract_end_date);
  const contractWarn = contractDays !== null && contractDays <= 30;
  return (
    <div style={{ ...card, marginBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: cs.text }}>🏢 {sel.name}</div>
            <span style={sel.contract_status === "active" ? { ...pillGreen, fontSize: 11 } : { ...pillGray, fontSize: 11 }}>
              {sel.contract_status === "active" ? "● Kontrak Aktif" : "Nonaktif"}
            </span>
            {contractWarn && (
              <span style={{ background: cs.yellow + "22", color: cs.yellow, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                ⚠️ Kontrak {contractDays <= 0 ? "EXPIRED" : `${contractDays} hari lagi`}
              </span>
            )}
          </div>
          <div style={{ color: cs.muted, fontSize: 12, marginTop: 5, display: "grid", gap: 2 }}>
            {sel.pic_name && <span>👤 PIC: <b style={{ color: cs.text }}>{sel.pic_name}</b>{sel.pic_phone ? ` · ${sel.pic_phone}` : ""}</span>}
            {sel.address && <span>📍 {sel.address}</span>}
            <span style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {sel.contract_value && <span>💰 Nilai: <b style={{ color: cs.accent }}>{fmtRp(sel.contract_value)}/thn</b></span>}
              {sel.contract_start_date && <span>📅 Mulai: <b style={{ color: cs.text }}>{fmtDate(sel.contract_start_date)}</b></span>}
              {sel.contract_end_date && <span>📅 Berakhir: <b style={{ color: contractWarn ? cs.yellow : cs.text }}>{fmtDate(sel.contract_end_date)}</b></span>}
            </span>
            {sel.notes && <span>📝 {sel.notes}</span>}
            {!sel.pic_name && !sel.address && <span style={{ color: cs.red }}>⚠️ Detail PIC & alamat belum diisi — klik Edit</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <Kpi n={units.length} l="Unit" />
          <Kpi n={active} l="Aktif" c={cs.green} />
          <Kpi n={rusak} l="Rusak" c={cs.red} />
          <div style={{ borderLeft: "1px solid " + cs.border, paddingLeft: 10, display: "flex", gap: 6 }}>
            <button onClick={onEdit} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }}>✏️ Edit</button>
            {isOwner && <button onClick={onDelete} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12, color: cs.red, borderColor: cs.red + "55" }}>🗑 Hapus</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ n, l, c }) {
  return <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 800, color: c || cs.text }}>{n}</div><div style={{ fontSize: 10, color: cs.muted, textTransform: "uppercase" }}>{l}</div></div>;
}

// ─────────── UNITS TAB ───────────
function UnitsTab({ sel, units, setUnits, call, showNotif, showConfirm, isOwner, apiFetch }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [edit, setEdit] = useState(null);
  const [qrUnit, setQrUnit] = useState(null);
  const [showCsv, setShowCsv] = useState(false);

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

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cari unit / lokasi / brand…" style={{ ...inp, flex: 1, minWidth: 160 }} />
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inp, maxWidth: 150 }}>
          <option value="">Semua Jenis</option>
          {AC_TYPES.map(t => <option key={t} value={t}>{AC_TYPE_LABELS[t]}</option>)}
        </select>
        {isOwner && <button onClick={() => setShowCsv(true)} style={{ ...btnGhost, fontSize: 12 }}>📥 Import CSV</button>}
        <button onClick={() => setEdit({})} style={btn}>+ Unit Baru</button>
      </div>

      {filtered.length === 0 ? <div style={{ color: cs.muted }}>Belum ada unit.</div> :
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
          {filtered.map(u => {
            const dueDays = daysUntil(u.next_service_date);
            const overdue = dueDays !== null && dueDays < 0;
            const dueSoon = dueDays !== null && dueDays >= 0 && dueDays <= 14;
            return (
              <div key={u.id} style={{ ...card, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <b style={{ color: cs.text }}>{u.unit_code}</b>
                      {statusPill(u.status)}
                      {overdue && <span style={{ background: cs.red + "22", color: cs.red, padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700 }}>🔴 PM Terlambat</span>}
                      {dueSoon && !overdue && <span style={{ background: cs.yellow + "22", color: cs.yellow, padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700 }}>⚠️ Due {dueDays}h</span>}
                    </div>
                    <div style={{ color: cs.muted, fontSize: 12, marginTop: 4 }}>
                      {u.location && <div>📍 {u.location}</div>}
                      <div>{u.brand || "—"} {u.capacity_pk ? u.capacity_pk + "PK" : ""} {u.ac_type ? "· " + (AC_TYPE_LABELS[u.ac_type] || u.ac_type) : ""} {u.refrigerant ? "· " + u.refrigerant : ""}</div>
                      {u.last_service_date && <div>Terakhir: {fmtDate(u.last_service_date)}</div>}
                      {u.next_service_date && <div style={{ color: overdue ? cs.red : dueSoon ? cs.yellow : cs.muted }}>PM Berikutnya: {fmtDate(u.next_service_date)}</div>}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button onClick={() => setQrUnit(u)} style={miniBtn} title="QR Unit">QR</button>
                    <button onClick={() => setEdit(u)} style={miniBtn} title="Edit">✏️</button>
                    {isOwner && <button onClick={() => del(u)} style={{ ...miniBtn, color: cs.red }}>🗑</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>}

      {edit !== null && <UnitFormModal unit={edit} onClose={() => setEdit(null)} onSave={save} />}
      {qrUnit && <UnitQrModal unit={qrUnit} sel={sel} onClose={() => setQrUnit(null)} />}
      {showCsv && <CsvImportModal sel={sel} call={call} setUnits={setUnits} showNotif={showNotif} onClose={() => setShowCsv(false)} />}
    </div>
  );
}

function UnitFormModal({ unit, onClose, onSave }) {
  const isEdit = !!unit.id;
  const [f, setF] = useState({
    unit_code: unit.unit_code || "", location: unit.location || "",
    brand: unit.brand || "", ac_type: unit.ac_type || "split",
    capacity_pk: unit.capacity_pk || "", refrigerant: unit.refrigerant || "R32",
    status: unit.status || "active", service_interval_months: unit.service_interval_months ?? 3,
    id: unit.id,
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Overlay onClose={onClose}>
      <div style={{ fontWeight: 700, color: cs.text, fontSize: 16, marginBottom: 12 }}>
        {isEdit ? "✏️ Edit Unit" : "➕ Tambah Unit"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Field l="Kode Unit *"><input value={f.unit_code} onChange={e => set("unit_code", e.target.value)} style={inp} placeholder="AC-01" /></Field>
        <Field l="Lokasi"><input value={f.location} onChange={e => set("location", e.target.value)} style={inp} placeholder="Lantai 2 — Ruang Rapat" /></Field>
        <Field l="Brand"><input value={f.brand} onChange={e => set("brand", e.target.value)} style={inp} placeholder="Daikin / Gree / LG…" /></Field>
        <Field l="Jenis AC"><select value={f.ac_type} onChange={e => set("ac_type", e.target.value)} style={inp}>{AC_TYPES.map(t => <option key={t} value={t}>{AC_TYPE_LABELS[t]}</option>)}</select></Field>
        <Field l="Kapasitas (PK)"><input type="number" value={f.capacity_pk || ""} onChange={e => set("capacity_pk", e.target.value)} style={inp} placeholder="1" step="0.5" /></Field>
        <Field l="Refrigerant"><select value={f.refrigerant} onChange={e => set("refrigerant", e.target.value)} style={inp}>{REFRIGERANTS.map(r => <option key={r}>{r}</option>)}</select></Field>
        <Field l="Status"><select value={f.status} onChange={e => set("status", e.target.value)} style={inp}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></Field>
        <Field l="Interval PM (bulan)">
          <input type="number" min="1" max="24" value={f.service_interval_months} onChange={e => set("service_interval_months", parseInt(e.target.value) || 3)} style={inp} />
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btnGhost}>Batal</button>
        <button onClick={() => onSave(f)} style={btn}>Simpan</button>
      </div>
    </Overlay>
  );
}

function UnitQrModal({ unit, sel, onClose }) {
  const portalBase = "https://status.aclean.id/status/";
  const url = portalBase + (sel.portal_token || "");
  const unitUrl = url + "?unit=" + encodeURIComponent(unit.unit_code);
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(unitUrl)}`;
  return (
    <Overlay onClose={onClose}>
      <div style={{ fontWeight: 700, color: cs.text, fontSize: 16, marginBottom: 12 }}>QR Unit — {unit.unit_code}</div>
      <div style={{ textAlign: "center" }}>
        <img alt="QR" src={qr} style={{ width: 200, height: 200, borderRadius: 12, background: "#fff", display: "block", margin: "0 auto 12px" }} />
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 8 }}>{unit.location && <b>{unit.location}</b>}</div>
        <div style={{ fontSize: 11, color: cs.muted, wordBreak: "break-all", padding: "4px 8px", background: cs.surface, borderRadius: 6, marginBottom: 12 }}>{unitUrl}</div>
        <button onClick={() => { navigator.clipboard?.writeText(unitUrl); }} style={{ ...btnGhost, fontSize: 12, width: "100%" }}>📋 Salin URL Unit</button>
      </div>
    </Overlay>
  );
}

const CSV_COLUMNS = ["unit_code", "location", "brand", "ac_type", "capacity_pk", "refrigerant", "status", "service_interval_months"];

function CsvImportModal({ sel, call, setUnits, showNotif, onClose }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const parseCsv = (text) => {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) { setErr("CSV minimal 1 baris header + 1 baris data"); return; }
    const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""));
    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      const row = {};
      header.forEach((h, idx) => { row[h] = cols[idx] || ""; });
      if (!row.unit_code) continue;
      parsed.push({
        unit_code: row.unit_code,
        location: row.location || "",
        brand: row.brand || "",
        ac_type: AC_TYPES.includes(row.ac_type) ? row.ac_type : "split",
        capacity_pk: parseFloat(row.capacity_pk) || null,
        refrigerant: REFRIGERANTS.includes(row.refrigerant) ? row.refrigerant : "R32",
        status: STATUSES.includes(row.status) ? row.status : "active",
        service_interval_months: parseInt(row.service_interval_months) || 3,
        client_id: sel.id,
      });
    }
    if (!parsed.length) { setErr("Tidak ada baris valid ditemukan (kolom unit_code wajib ada)"); return; }
    setRows(parsed); setErr("");
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => parseCsv(ev.target.result);
    reader.readAsText(file, "UTF-8");
  };

  const doImport = async () => {
    if (!rows?.length) return;
    setBusy(true);
    try {
      const BATCH = 20;
      let allSaved = [];
      for (let i = 0; i < rows.length; i += BATCH) {
        const j = await call("save-units", { client_id: sel.id, units: rows.slice(i, i + BATCH) });
        allSaved = allSaved.concat(j.units || []);
      }
      setUnits(prev => {
        const map = new Map(prev.map(u => [u.id, u]));
        allSaved.forEach(u => map.set(u.id, u));
        return [...map.values()].sort((a, b) => a.unit_code.localeCompare(b.unit_code));
      });
      showNotif(`✅ ${allSaved.length} unit berhasil diimport`);
      onClose();
    } catch (e) { showNotif("❌ " + e.message); setBusy(false); }
  };

  return (
    <Overlay onClose={onClose}>
      <div style={{ fontWeight: 700, color: cs.text, fontSize: 16, marginBottom: 10 }}>📥 Import Unit via CSV</div>
      <div style={{ fontSize: 12, color: cs.muted, marginBottom: 10 }}>
        Kolom CSV: <code style={{ color: cs.accent }}>unit_code, location, brand, ac_type, capacity_pk, refrigerant, status, service_interval_months</code><br />
        ac_type: split (Split Wall) / cassette / standing (Floor Standing) / floor (Split Duct) · status: active/rusak/retired · Kolom opsional boleh kosong
      </div>
      <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ fontSize: 13, color: cs.text, marginBottom: 8 }} />
      {err && <div style={{ color: cs.red, fontSize: 12, marginBottom: 8 }}>❌ {err}</div>}
      {rows && (
        <>
          <div style={{ fontSize: 12, color: cs.green, marginBottom: 8 }}>✅ {rows.length} unit siap diimport — preview:</div>
          <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 12, background: cs.surface, borderRadius: 8, border: "1px solid " + cs.border, marginBottom: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Kode", "Lokasi", "Brand", "Jenis", "PK", "Status"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 20).map((r, i) => (
                <tr key={i}>
                  <td style={td}>{r.unit_code}</td>
                  <td style={td}>{r.location || "—"}</td>
                  <td style={td}>{r.brand || "—"}</td>
                  <td style={td}>{r.ac_type}</td>
                  <td style={td}>{r.capacity_pk || "—"}</td>
                  <td style={td}>{r.status}</td>
                </tr>
              ))}{rows.length > 20 && <tr><td colSpan={6} style={{ ...td, color: cs.muted }}>…dan {rows.length - 20} unit lainnya</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btnGhost}>Batal</button>
        <button onClick={doImport} disabled={!rows || busy} style={{ ...btn, opacity: (!rows || busy) ? .5 : 1 }}>
          {busy ? "Mengimport…" : `Import ${rows?.length || 0} Unit`}
        </button>
      </div>
    </Overlay>
  );
}

// ─────────── HISTORY TAB ───────────
function HistoryTab({ units, logs, setLogs, sel, call, showNotif, showConfirm, isOwner, apiFetch }) {
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
                  ul.map(l => {
                    const mats = Array.isArray(l.materials) ? l.materials.filter(m => m.nama) : [];
                    const photos = Array.isArray(l.photos) ? l.photos.filter(Boolean) : [];
                    return (
                      <div key={l.id} style={{ borderLeft: "2px solid " + cs.border, paddingLeft: 12, marginBottom: 14 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <b style={{ color: cs.text }}>{l.service_type || "Servis"}</b>
                          <span style={{ color: cs.muted, fontSize: 12 }}>{fmtDate(l.service_date)}</span>
                          {l.cost > 0 && <span style={pillYellow}>{fmtRp(l.cost)}</span>}
                          {l.invoiced && <span style={pillGreen}>✓ Invoiced</span>}
                          {isOwner && (
                            <button onClick={async () => {
                              if (!(await showConfirm({ title: "Hapus log?", message: "Hapus riwayat ini?" }))) return;
                              try { await call("delete-log", { id: l.id }); setLogs(p => p.filter(x => x.id !== l.id)); showNotif("✅ Dihapus"); }
                              catch (e) { showNotif("❌ " + e.message); }
                            }} style={{ ...miniBtn, color: cs.red, marginLeft: "auto" }}>🗑</button>
                          )}
                        </div>
                        {l.description && <div style={{ fontSize: 13, color: cs.text, margin: "3px 0" }}>{l.description}</div>}
                        <div style={{ color: cs.muted, fontSize: 12 }}>👷 {l.technician || "—"}</div>
                        {mats.length > 0 && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
                            {mats.map((m, i) => (
                              <span key={i} style={{ background: cs.accent + "15", border: "1px solid " + cs.accent + "30", color: cs.accent, padding: "1px 8px", borderRadius: 6, fontSize: 11 }}>
                                {m.nama} {m.qty}{m.satuan || ""}
                              </span>
                            ))}
                          </div>
                        )}
                        {photos.length > 0 && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                            {photos.map((p, i) => (
                              <a key={i} href={`/api/foto?key=${encodeURIComponent(p)}`} target="_blank" rel="noreferrer"
                                style={{ width: 72, height: 54, borderRadius: 7, overflow: "hidden", display: "block", border: "1px solid " + cs.border }}>
                                <img alt="foto" src={`/api/foto?key=${encodeURIComponent(p)}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        );
      })}
      {addFor && (
        <LogModal unit={addFor} apiFetch={apiFetch} sel={sel} onClose={() => setAddFor(null)} onSave={async (payload) => {
          try {
            const j = await call("create-log", { ...payload, unit_id: addFor.id, client_id: sel.id });
            setLogs(p => [j.log, ...p]);
            setAddFor(null);
            showNotif("✅ Log ditambahkan");
          } catch (e) { showNotif("❌ " + e.message); }
        }} />
      )}
    </div>
  );
}

function LogModal({ unit, apiFetch, sel, onClose, onSave }) {
  const [f, setF] = useState({
    service_date: new Date().toISOString().slice(0, 10),
    service_type: "Cuci Rutin",
    technician: "", cost: "", description: "",
    materials: [],
    photos: [],
  });
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const addMaterial = () => setF(p => ({ ...p, materials: [...p.materials, { nama: "", qty: "", satuan: "pcs" }] }));
  const setMat = (i, k, v) => setF(p => {
    const m = [...p.materials];
    m[i] = { ...m[i], [k]: v };
    return { ...p, materials: m };
  });
  const removeMat = (i) => setF(p => ({ ...p, materials: p.materials.filter((_, idx) => idx !== i) }));

  const pickPhotos = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    const keys = [];
    for (const file of files.slice(0, 5)) {
      try {
        const b64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = rej;
          r.readAsDataURL(file);
        });
        const resp = await apiFetch("/api/upload-foto", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64: b64, filename: file.name, mimeType: file.type, folder: `maintenance/${sel.id}` }),
        });
        const j = await resp.json().catch(() => ({}));
        if (j.key) keys.push(j.key);
      } catch (e2) { console.warn("upload foto gagal:", e2.message); }
    }
    setF(p => ({ ...p, photos: [...p.photos, ...keys] }));
    setUploading(false);
  };

  const removePhoto = (idx) => setF(p => ({ ...p, photos: p.photos.filter((_, i) => i !== idx) }));

  return (
    <Overlay onClose={onClose}>
      <div style={{ fontWeight: 700, color: cs.text, fontSize: 16, marginBottom: 4 }}>Tambah Log — {unit.unit_code}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        <Field l="Tanggal *">
          <input type="date" value={f.service_date} onChange={e => set("service_date", e.target.value)} style={inp} />
        </Field>
        <Field l="Jenis Servis">
          <select value={f.service_type} onChange={e => set("service_type", e.target.value)} style={inp}>
            {SERVICE_TYPES_LOG.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field l="Teknisi">
          <input value={f.technician} onChange={e => set("technician", e.target.value)} style={inp} />
        </Field>
        <Field l="Biaya (Rp)">
          <input type="number" value={f.cost ?? ""} onChange={e => set("cost", e.target.value)} style={inp} />
        </Field>
      </div>
      <Field l="Deskripsi">
        <textarea value={f.description} onChange={e => set("description", e.target.value)} style={{ ...inp, minHeight: 56, resize: "vertical" }} />
      </Field>

      {/* Materials */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: cs.muted }}>🔧 Material / Bahan</span>
          <button type="button" onClick={addMaterial} style={{ ...miniBtn, marginLeft: "auto", fontSize: 11 }}>+ Tambah</button>
        </div>
        {f.materials.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 5, alignItems: "center" }}>
            <input placeholder="Nama material" value={m.nama} onChange={e => setMat(i, "nama", e.target.value)} style={{ ...inp, flex: 2 }} />
            <input placeholder="Qty" type="number" value={m.qty} onChange={e => setMat(i, "qty", e.target.value)} style={{ ...inp, width: 60, flex: "none" }} />
            <select value={m.satuan} onChange={e => setMat(i, "satuan", e.target.value)} style={{ ...inp, width: 70, flex: "none" }}>
              {MATERIAL_UNITS.map(u => <option key={u}>{u}</option>)}
            </select>
            <button type="button" onClick={() => removeMat(i)} style={{ ...miniBtn, color: cs.red, flexShrink: 0 }}>✕</button>
          </div>
        ))}
      </div>

      {/* Photo upload */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 6 }}>📷 Foto (maks 5)</div>
        {f.photos.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {f.photos.map((key, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img alt="preview" src={`/api/foto?key=${encodeURIComponent(key)}`} style={{ width: 72, height: 54, objectFit: "cover", borderRadius: 7, border: "1px solid " + cs.border }} />
                <button onClick={() => removePhoto(i)} style={{ position: "absolute", top: -6, right: -6, background: cs.red, color: "#fff", border: "none", borderRadius: "50%", width: 18, height: 18, fontSize: 10, cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}
        {f.photos.length < 5 && (
          <label style={{ display: "inline-block", cursor: "pointer" }}>
            <input type="file" accept="image/*" multiple onChange={pickPhotos} style={{ display: "none" }} />
            <span style={{ ...miniBtn, color: uploading ? cs.muted : cs.text, display: "inline-block" }}>
              {uploading ? "Mengupload…" : "📁 Pilih Foto"}
            </span>
          </label>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btnGhost}>Batal</button>
        <button onClick={() => onSave(f)} disabled={uploading} style={{ ...btn, opacity: uploading ? .5 : 1 }}>Simpan</button>
      </div>
    </Overlay>
  );
}

// ─────────── STATS TAB ───────────
function StatsTab({ units, logs, sel }) {
  const totalServis = logs.length;
  const totalCost = logs.reduce((s, l) => s + (Number(l.cost) || 0), 0);
  const invoiced = logs.filter(l => l.invoiced).length;
  const avgCost = totalServis ? Math.round(totalCost / totalServis) : 0;

  // Unit ranked by service count
  const unitCount = {};
  logs.forEach(l => { unitCount[l.unit_id] = (unitCount[l.unit_id] || 0) + 1; });
  const unitRanked = units
    .map(u => ({ ...u, count: unitCount[u.id] || 0, cost: logs.filter(l => l.unit_id === u.id).reduce((s, l) => s + (Number(l.cost) || 0), 0) }))
    .sort((a, b) => b.count - a.count);

  // Monthly cost (last 6 months)
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("id-ID", { month: "short", year: "2-digit" }) };
  });
  const monthCost = {};
  logs.forEach(l => {
    const mk = (l.service_date || "").slice(0, 7);
    monthCost[mk] = (monthCost[mk] || 0) + (Number(l.cost) || 0);
  });
  const maxM = Math.max(1, ...months.map(m => monthCost[m.key] || 0));

  // Next PM due
  const overdue = units.filter(u => u.next_service_date && u.next_service_date < new Date().toISOString().slice(0, 10));
  const dueSoon = units.filter(u => {
    if (!u.next_service_date) return false;
    const d = daysUntil(u.next_service_date);
    return d !== null && d >= 0 && d <= 14;
  });

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10, marginBottom: 16 }}>
        <KpiCard label="Total Servis" value={totalServis} sub="semua log" />
        <KpiCard label="Total Biaya" value={fmtRp(totalCost)} sub="semua log" color={cs.accent} />
        <KpiCard label="Rata-rata Biaya" value={fmtRp(avgCost)} sub="per servis" />
        <KpiCard label="Sudah Invoiced" value={invoiced} sub={`dari ${totalServis} log`} color={cs.green} />
        <KpiCard label="PM Terlambat" value={overdue.length} sub="unit" color={overdue.length ? cs.red : cs.green} />
        <KpiCard label="PM <14 Hari" value={dueSoon.length} sub="unit" color={dueSoon.length ? cs.yellow : cs.muted} />
      </div>

      {/* Monthly cost chart */}
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, color: cs.text, fontSize: 13, marginBottom: 12 }}>Biaya Servis 6 Bulan Terakhir</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 90 }}>
          {months.map(m => {
            const v = monthCost[m.key] || 0;
            const h = Math.round((v / maxM) * 70) || 2;
            return (
              <div key={m.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ fontSize: 10, color: cs.muted }}>{v ? (v >= 1000000 ? (v / 1000000).toFixed(1) + "M" : (v / 1000).toFixed(0) + "K") : ""}</div>
                <div style={{ width: "100%", height: h, background: cs.accent, borderRadius: "4px 4px 0 0", transition: ".3s" }} />
                <div style={{ fontSize: 10, color: cs.muted, whiteSpace: "nowrap" }}>{m.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Unit ranking */}
      <div style={{ ...card }}>
        <div style={{ fontWeight: 700, color: cs.text, fontSize: 13, marginBottom: 10 }}>Ranking Unit — Frekuensi Servis</div>
        {unitRanked.length === 0 ? <div style={{ color: cs.muted, fontSize: 12 }}>Belum ada data.</div> :
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Unit", "Lokasi", "Servis", "Total Biaya", "Terakhir PM", "PM Berikutnya"].map(h => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {unitRanked.map(u => (
                <tr key={u.id}>
                  <td style={td}><b>{u.unit_code}</b> {statusPill(u.status)}</td>
                  <td style={td}><span style={{ color: cs.muted, fontSize: 12 }}>{u.location || "—"}</span></td>
                  <td style={td}><b style={{ color: u.count > 3 ? cs.red : cs.text }}>{u.count}×</b></td>
                  <td style={td}><span style={{ color: cs.accent }}>{fmtRp(u.cost)}</span></td>
                  <td style={td}><span style={{ color: cs.muted, fontSize: 12 }}>{fmtDate(u.last_service_date)}</span></td>
                  <td style={td}>
                    {u.next_service_date ? (
                      <span style={{ color: daysUntil(u.next_service_date) < 0 ? cs.red : daysUntil(u.next_service_date) <= 14 ? cs.yellow : cs.muted, fontSize: 12 }}>
                        {fmtDate(u.next_service_date)}
                      </span>
                    ) : <span style={{ color: cs.muted, fontSize: 12 }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>}
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{ ...card, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: cs.muted, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || cs.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: cs.muted }}>{sub}</div>}
    </div>
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
      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 12 }}>Pilih servis yang belum di-invoice untuk dijadikan 1 invoice B2B.</div>
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
function PortalTab({ sel, setSel, call, showNotif, showConfirm, isOwner, onChanged }) {
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

// ─────────── CLIENT FORM MODAL ───────────
function ClientFormModal({ client, onClose, onSave, busy }) {
  const isEdit = !!client.id;
  const [f, setF] = useState({
    name: client.name || "",
    address: client.address || "",
    pic_name: client.pic_name || "",
    pic_phone: client.pic_phone || "",
    contract_status: client.contract_status || "active",
    notes: client.notes || "",
    contract_start_date: client.contract_start_date || "",
    contract_end_date: client.contract_end_date || "",
    contract_value: client.contract_value || "",
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Overlay onClose={onClose}>
      <div style={{ fontWeight: 700, color: cs.text, fontSize: 16, marginBottom: 14 }}>
        {isEdit ? "✏️ Edit Perusahaan" : "🏢 Tambah Perusahaan Baru"}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <Field l="Nama Perusahaan *">
          <input value={f.name} onChange={e => set("name", e.target.value)} style={inp} placeholder="PT. Contoh Indonesia" />
        </Field>
        <Field l="Alamat">
          <textarea value={f.address} onChange={e => set("address", e.target.value)} style={{ ...inp, minHeight: 56, resize: "vertical" }} placeholder="Jl. Contoh No. 1…" />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Field l="Nama PIC / Kontak">
            <input value={f.pic_name} onChange={e => set("pic_name", e.target.value)} style={inp} placeholder="Budi Santoso" />
          </Field>
          <Field l="No. HP PIC">
            <input value={f.pic_phone} onChange={e => set("pic_phone", e.target.value)} style={inp} placeholder="08xx / +62…" />
          </Field>
        </div>

        <div style={{ borderTop: "1px solid " + cs.border, paddingTop: 10, marginTop: 2 }}>
          <div style={{ fontSize: 11, color: cs.muted, textTransform: "uppercase", marginBottom: 8 }}>Detail Kontrak</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <Field l="Status">
              <select value={f.contract_status} onChange={e => set("contract_status", e.target.value)} style={inp}>
                <option value="active">Aktif</option>
                <option value="inactive">Nonaktif</option>
              </select>
            </Field>
            <Field l="Nilai Kontrak/Thn (Rp)">
              <input type="number" value={f.contract_value} onChange={e => set("contract_value", e.target.value)} style={inp} placeholder="12000000" />
            </Field>
            <div />
            <Field l="Tanggal Mulai">
              <input type="date" value={f.contract_start_date} onChange={e => set("contract_start_date", e.target.value)} style={inp} />
            </Field>
            <Field l="Tanggal Berakhir">
              <input type="date" value={f.contract_end_date} onChange={e => set("contract_end_date", e.target.value)} style={inp} />
            </Field>
          </div>
        </div>

        <Field l="Catatan Internal (tidak tampil ke customer)">
          <textarea value={f.notes} onChange={e => set("notes", e.target.value)} style={{ ...inp, minHeight: 44, resize: "vertical" }} placeholder="Opsional…" />
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btnGhost}>Batal</button>
        <button onClick={() => onSave(isEdit ? { ...f, id: client.id } : f)} disabled={busy} style={btn}>
          {busy ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Buat Perusahaan"}
        </button>
      </div>
    </Overlay>
  );
}

// ─────────── QUOTASI TAB ───────────
const QUO_STATUS_COLOR = {
  DRAFT:     { bg: cs.muted + "22", color: cs.muted },
  SENT:      { bg: "#3b82f622",     color: "#60a5fa" },
  APPROVED:  { bg: cs.green + "22", color: cs.green },
  EXPIRED:   { bg: cs.yellow + "22",color: cs.yellow },
  CANCELLED: { bg: cs.red + "22",   color: cs.red },
};
const QUO_LABEL = { DRAFT: "📝 Draft", SENT: "📤 Terkirim", APPROVED: "✅ Disetujui", EXPIRED: "⏰ Kadaluarsa", CANCELLED: "❌ Dibatalkan" };

function QuotasiTab({ sel, quotations, quotationsData, setQuotationsData, supabase, customersData, priceListData, getLocalDate, showNotif, showConfirm, isOwner, appSettings, sendWAFn, uploadQuotationPDFFn }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editQ, setEditQ] = useState(null);
  const [previewQ, setPreviewQ] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const today = typeof getLocalDate === "function" ? getLocalDate() : new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let alive = true;
    fetch("/aclean-logo.png").then(r => r.ok ? r.blob() : null).then(blob => {
      if (!blob || !alive) return;
      const reader = new FileReader();
      reader.onload = () => { if (alive) setLogoUrl(reader.result); };
      reader.readAsDataURL(blob);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const delQ = async (q) => {
    const ok = await showConfirm({ title: "Hapus Quotation?", message: `Hapus ${q.id}? Tindakan tidak bisa diurungkan.` });
    if (!ok) return;
    const { error } = await supabase.from("quotations").delete().eq("id", q.id);
    if (error) { showNotif("❌ " + error.message); return; }
    setQuotationsData(prev => prev.filter(x => x.id !== q.id));
    showNotif("✅ Quotation dihapus");
  };

  const markSent = async (q) => {
    const { error } = await supabase.from("quotations").update({ status: "SENT", updated_at: new Date().toISOString() }).eq("id", q.id);
    if (error) { showNotif("❌ " + error.message); return; }
    setQuotationsData(prev => prev.map(x => x.id === q.id ? { ...x, status: "SENT" } : x));
    showNotif("✅ Status berubah ke Terkirim");
  };

  const handleSendWA = async (q) => {
    if (!q.phone) { showNotif("❌ Nomor HP PIC belum diisi di perusahaan"); return; }
    setSendingId(q.id);
    try {
      let pdfAttachment = null;
      if (uploadQuotationPDFFn) {
        try { pdfAttachment = await uploadQuotationPDFFn(q); } catch (_) {}
      }
      const fmt = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
      const msg = `Halo ${q.customer},\n\nBerikut penawaran dari AClean:\n📄 ${q.id}\nTotal: ${fmt(q.total)}\nBerlaku s/d: ${q.valid_until || "-"}\n\nTerima kasih 🙏`;
      await sendWAFn?.(q.phone, msg, pdfAttachment ? { url: pdfAttachment.url, filename: pdfAttachment.filename } : {});
      if (q.status === "DRAFT") await markSent(q);
      showNotif("📱 WA terkirim" + (pdfAttachment ? " + PDF terlampir" : ""));
    } catch (e) { showNotif("❌ " + e.message); }
    finally { setSendingId(null); }
  };

  const prefill = { name: sel.name, phone: sel.pic_phone || "", address: sel.address || "" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <div style={{ color: cs.muted, fontSize: 12 }}>
          Semua quotation untuk <b style={{ color: cs.text }}>{sel.name}</b>
        </div>
        <button onClick={() => { setEditQ(null); setShowCreate(true); }} style={{ ...btn, marginLeft: "auto" }}>+ Buat Quotation</button>
      </div>

      {quotations.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "36px 16px", color: cs.muted }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
          Belum ada quotation untuk perusahaan ini.<br />
          <span style={{ fontSize: 12 }}>Klik "+ Buat Quotation" untuk membuat penawaran baru.</span>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {quotations.map(q => {
            const isExpired = q.valid_until && q.valid_until < today && !["APPROVED", "CANCELLED"].includes(q.status);
            const effectiveStatus = isExpired && q.status === "SENT" ? "EXPIRED" : q.status;
            const sc = QUO_STATUS_COLOR[effectiveStatus] || QUO_STATUS_COLOR.DRAFT;
            const items = Array.isArray(q.items) ? q.items : [];
            return (
              <div key={q.id} style={{ ...card, padding: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", padding: "12px 14px", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <b style={{ color: cs.text, fontFamily: "monospace" }}>{q.id}</b>
                      <span style={{ background: sc.bg, color: sc.color, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                        {QUO_LABEL[effectiveStatus] || effectiveStatus}
                      </span>
                      {q.invoice_id && <span style={{ ...pillGreen, fontSize: 10 }}>Invoice: {q.invoice_id}</span>}
                    </div>
                    <div style={{ color: cs.muted, fontSize: 12, marginTop: 4 }}>
                      {items.length} item · Valid s/d {q.valid_until || "—"} · Dibuat {q.created_at?.slice(0, 10) || "—"}
                    </div>
                    {q.notes && <div style={{ color: cs.muted, fontSize: 11, marginTop: 2 }}>📝 {q.notes}</div>}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>{fmtRp(q.total)}</div>
                    <div style={{ display: "flex", gap: 5, marginTop: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button onClick={() => setPreviewQ(q)} style={{ ...miniBtn, color: cs.accent }}>👁 Preview</button>
                      {sendWAFn && q.phone && (
                        <button onClick={() => handleSendWA(q)} disabled={sendingId === q.id}
                          style={{ ...miniBtn, color: "#25D366", borderColor: "#25D36655" }}>
                          {sendingId === q.id ? "…" : "📱 Kirim WA"}
                        </button>
                      )}
                      {q.status === "DRAFT" && (
                        <button onClick={() => markSent(q)} style={{ ...miniBtn, color: "#60a5fa" }}>📤 Sent</button>
                      )}
                      <button onClick={() => { setEditQ(q); setShowCreate(true); }} style={miniBtn}>✏️</button>
                      {isOwner && <button onClick={() => delQ(q)} style={{ ...miniBtn, color: cs.red }}>🗑</button>}
                    </div>
                  </div>
                </div>
                {items.length > 0 && (
                  <div style={{ borderTop: "1px solid " + cs.border, padding: "8px 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {items.map((it, i) => (
                      <span key={i} style={{ background: cs.surface, border: "1px solid " + cs.border, padding: "2px 8px", borderRadius: 6, fontSize: 11, color: cs.text }}>
                        {it.description || it.nama || "Item"} {it.qty > 1 ? `×${it.qty}` : ""} · {fmtRp(it.subtotal || it.harga)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 500, overflowY: "auto" }} onClick={() => setShowCreate(false)}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: 780, margin: "24px auto", padding: "0 16px 80px" }}>
            <Suspense fallback={<div style={{ color: cs.muted, padding: 40, textAlign: "center" }}>Memuat form quotation…</div>}>
              <QuotationModal
                onClose={() => { setShowCreate(false); setEditQ(null); }}
                supabase={supabase}
                customersData={customersData}
                showNotif={showNotif}
                setQuotationsData={setQuotationsData}
                getLocalDate={getLocalDate}
                priceListData={priceListData}
                editData={editQ}
                maintenanceClientId={sel.id}
                maintenancePrefill={editQ ? undefined : prefill}
              />
            </Suspense>
          </div>
        </div>
      )}

      {previewQ && (
        <Suspense fallback={
          <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ color: cs.muted }}>Memuat PDF…</div>
          </div>
        }>
          <QuotationPDFModule quo={previewQ} appSettings={appSettings || {}} logoUrl={logoUrl} onClose={() => setPreviewQ(null)} />
        </Suspense>
      )}
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
const pillYellow = { background: (cs.yellow || "#eab308") + "22", color: cs.yellow || "#eab308", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 };
