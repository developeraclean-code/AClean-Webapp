import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { cs } from "../theme/cs.js";

// Pill styles — didefinisikan di atas karena dirujuk oleh const module-level
// INV_STATUS_STYLE (TDZ: dev/esbuild eval source-order, beda dari Rollup build).
const pillGreen = { background: cs.green + "22", color: cs.green, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 };
const pillGray = { background: cs.muted + "22", color: cs.muted, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 };
const pillBlue = { background: cs.accent + "22", color: cs.accent, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 };
const pillYellow = { background: (cs.yellow || "#eab308") + "22", color: cs.yellow || "#eab308", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 };

const QuotationModal = lazy(() => import("./QuotationModal.jsx"));
const MaintenanceDocsView = lazy(() => import("./MaintenanceDocsView.jsx"));
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
const STATUSES = ["active", "baru", "perlu_perbaikan", "dalam_perbaikan", "nonaktif", "rusak", "retired"];
const SERVICE_TYPES_LOG = ["Cuci Rutin", "Cuci Besar", "Perbaikan", "Isi Freon", "Ganti Sparepart", "Instalasi", "Cek & Check-Up", "Lainnya"];
const SERVICE_CATEGORY_LABELS = { cuci_rutin: "Cuci Rutin", inspeksi: "Inspeksi", perbaikan: "Perbaikan", pengecekan: "Cek Saja" };
const MATERIAL_UNITS = ["kg", "gram", "liter", "pcs", "meter", "set"];

function fmtRp(n) { return n == null ? "—" : "Rp " + Number(n).toLocaleString("id-ID"); }
function fmtDate(d) { if (!d) return "—"; try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } }

function statusPill(s) {
  const map = {
    active:          [cs.green,              "Aktif"],
    baru:            [cs.accent,             "AC Baru"],
    perlu_perbaikan: [cs.red,                "Perlu Perbaikan"],
    dalam_perbaikan: [cs.yellow || "#eab308","Dikerjakan"],
    nonaktif:        [cs.muted,              "Nonaktif"],
    rusak:           [cs.red,                "Rusak"],
    retired:         [cs.muted,              "Retired"],
  };
  const [c, l] = map[s] || [cs.muted, s];
  return <span style={{ background: c + "22", color: c, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{l}</span>;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

export default function MaintenanceView({
  currentUser, apiFetch, showNotif, showConfirm,
  quotationsData, setQuotationsData, setOrdersData,
  teknisiData, createOrderFn, createTeamSplitFn,
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
  const [docsMode, setDocsMode] = useState(false);
  const [ppmMode, setPpmMode] = useState(false);

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

  if (docsMode) {
    return (
      <Suspense fallback={<div style={{ color: cs.muted, padding: 40, textAlign: "center" }}>Memuat dokumen…</div>}>
        <MaintenanceDocsView
          clients={clients} call={call} showNotif={showNotif} showConfirm={showConfirm}
          isOwner={isOwner} canManage={isOwner || currentUser?.role === "Admin"} appSettings={appSettings} onBack={() => setDocsMode(false)}
        />
      </Suspense>
    );
  }

  if (ppmMode) {
    return <PPMCalendar call={call} showNotif={showNotif} onBack={() => setPpmMode(false)} />;
  }

  if (!sel) {
    return (
      <div style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <h2 style={{ color: cs.text, margin: 0 }}>🏢 Maintenance — Customer Korporat</h2>
          <button onClick={() => setPpmMode(true)} style={{ ...btnGhost }}>📅 PPM Calendar</button>
          <button onClick={() => setDocsMode(true)} style={{ ...btnGhost }}>📄 Dokumen</button>
          <button onClick={() => setClientModal({})} style={btn}>+ Tambah Perusahaan</button>
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
      <ClientHeader sel={sel} units={units} logs={logs} call={call} showNotif={showNotif} isOwner={isOwner}
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
                ["unit",      `📋 Unit (${units.length})`],
                ["history",   "🕑 History"],
                ["followup",  "🔧 Follow-up"],
                ["manifest",  "📋 Manifest"],
                ["contract",  "📝 Kontrak"],
                ["workorder", "🔨 Work Order"],
                ["svchistory","🧾 History Service"],
                ["stats",     "📊 Statistik"],
                ["quotation", `📄 Quotasi (${clientQuotations.length})`],
                ["invoice",   "🧾 Invoice B2B"],
                ["portal",    "🔗 Portal & Akses"],
              ].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} style={tab === k ? tabActive : tabBtn}>{l}</button>
              ))}
            </div>
            {tab === "unit"     && <UnitsTab sel={sel} units={units} setUnits={setUnits} call={call} showNotif={showNotif} showConfirm={showConfirm} isOwner={isOwner} apiFetch={apiFetch} supabase={supabase} setOrdersData={setOrdersData} getLocalDate={getLocalDate} teknisiData={teknisiData} createOrderFn={createOrderFn} createTeamSplitFn={createTeamSplitFn} />}
            {tab === "history"  && <HistoryTab units={units} logs={logs} setLogs={setLogs} sel={sel} call={call} showNotif={showNotif} showConfirm={showConfirm} isOwner={isOwner} apiFetch={apiFetch} />}
            {tab === "followup" && <FollowupTab sel={sel} units={units} logs={logs} call={call} showNotif={showNotif} showConfirm={showConfirm} isOwner={isOwner} currentUser={currentUser} />}
            {tab === "manifest"  && <ManifestTab sel={sel} units={units} call={call} showNotif={showNotif} />}
            {tab === "contract"  && <ContractTab sel={sel} units={units} call={call} showNotif={showNotif} showConfirm={showConfirm} isOwner={isOwner} currentUser={currentUser} />}
            {tab === "workorder" && <WorkOrderTab sel={sel} units={units} call={call} showNotif={showNotif} showConfirm={showConfirm} isOwner={isOwner} currentUser={currentUser} />}
            {tab === "svchistory" && <HistoryServiceTab sel={sel} call={call} showNotif={showNotif} />}
            {tab === "stats"    && <StatsTab units={units} logs={logs} sel={sel} />}
            {tab === "quotation" && (
              <QuotasiTab
                sel={sel} quotations={clientQuotations}
                quotationsData={quotationsData} setQuotationsData={setQuotationsData}
                setOrdersData={setOrdersData}
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
function ClientHeader({ sel, units, logs, call, showNotif, isOwner, onEdit, onDelete }) {
  const active = units.filter(u => u.status === "active").length;
  const rusak = units.filter(u => u.status === "rusak").length;
  const contractDays = daysUntil(sel.contract_end_date);
  const contractWarn = contractDays !== null && contractDays <= 30;
  const [exporting, setExporting] = useState(false);

  const exportExcel = async () => {
    setExporting(true);
    try {
      if (!window.XLSX) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      const XLSX = window.XLSX;
      let invoices = [];
      try { const j = await call("list-invoices", { client_id: sel.id }); invoices = j.invoices || []; }
      catch { /* tetap lanjut export tanpa sheet invoice penuh */ }

      const unitRows = units.map((u, i) => ({
        "No": i + 1, "Kode Unit": u.unit_code || "-", "Lokasi": u.location || "-",
        "Brand": u.brand || "-", "Tipe AC": u.ac_type || "-", "Kapasitas (PK)": u.capacity_pk || "-",
        "Refrigerant": u.refrigerant || "-", "Status": u.status || "-",
        "Tahun Instalasi": u.year_installed || "-", "No Seri": u.serial_no || "-",
        "Interval Servis (bulan)": u.service_interval_months || "-",
        "Servis Terakhir": fmtDate(u.last_service_date), "Servis Berikutnya": fmtDate(u.next_service_date),
        "Catatan": u.notes || "-",
      }));

      const unitById = Object.fromEntries(units.map(u => [u.id, u]));
      const logRows = [...logs]
        .sort((a, b) => (b.service_date || "").localeCompare(a.service_date || ""))
        .map((l, i) => {
          const u = unitById[l.unit_id];
          return {
            "No": i + 1, "Kode Unit": u?.unit_code || "-", "Lokasi": u?.location || "-",
            "Tanggal Servis": fmtDate(l.service_date), "Jenis Servis": l.service_type || "-",
            "Teknisi": l.technician || "-", "Biaya (Rp)": l.cost || 0,
            "Invoiced": l.invoiced ? "Ya" : "Belum", "Order/Job ID": l.order_id || "-",
            "Deskripsi": l.description || "-",
          };
        });

      const invoiceRows = invoices.map((iv, i) => ({
        "No": i + 1, "ID Invoice": iv.id || "-", "Tanggal": fmtDate(iv.created_at),
        "Layanan": iv.service || "-", "Job ID": iv.job_id || "-",
        "Unit": Array.isArray(iv.units) ? iv.units.length : (iv.units || 0),
        "Total (Rp)": iv.total || 0, "Status": iv.status || "-",
      }));

      const recapRows = units.map((u, i) => {
        const ul = logs.filter(l => l.unit_id === u.id);
        const lastLog = ul.slice().sort((a, b) => (b.service_date || "").localeCompare(a.service_date || ""))[0];
        return {
          "No": i + 1, "Kode Unit": u.unit_code || "-", "Lokasi": u.location || "-",
          "Status Unit": u.status || "-", "Jumlah Log": ul.length,
          "Servis Terakhir (Log)": lastLog ? fmtDate(lastLog.service_date) : "-",
          "Total Biaya Log (Rp)": ul.reduce((s, l) => s + (Number(l.cost) || 0), 0),
          "Log Belum Invoiced": ul.filter(l => !l.invoiced).length,
        };
      });

      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.json_to_sheet(unitRows);
      ws1["!cols"] = [{ wch: 4 }, { wch: 12 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 9 }, { wch: 13 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 26 }];
      const ws2 = XLSX.utils.json_to_sheet(logRows);
      ws2["!cols"] = [{ wch: 4 }, { wch: 12 }, { wch: 22 }, { wch: 13 }, { wch: 14 }, { wch: 12 }, { wch: 13 }, { wch: 9 }, { wch: 16 }, { wch: 34 }];
      const ws3 = XLSX.utils.json_to_sheet(invoiceRows);
      ws3["!cols"] = [{ wch: 4 }, { wch: 22 }, { wch: 13 }, { wch: 30 }, { wch: 16 }, { wch: 6 }, { wch: 14 }, { wch: 16 }];
      const ws4 = XLSX.utils.json_to_sheet(recapRows);
      ws4["!cols"] = [{ wch: 4 }, { wch: 12 }, { wch: 22 }, { wch: 11 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 14 }];

      XLSX.utils.book_append_sheet(wb, ws1, "Unit");
      XLSX.utils.book_append_sheet(wb, ws2, "Log Servis");
      XLSX.utils.book_append_sheet(wb, ws3, "Invoice");
      XLSX.utils.book_append_sheet(wb, ws4, "Rekap per Unit");

      const fname = `Maintenance_${sel.name.replace(/[^a-z0-9]+/gi, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fname);
      showNotif("✅ Export Excel berhasil!");
    } catch (err) { showNotif("❌ Export gagal: " + err.message); }
    finally { setExporting(false); }
  };

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
            <button onClick={exportExcel} disabled={exporting} style={{ ...btnGhost, padding: "6px 12px", fontSize: 12, color: cs.green, borderColor: cs.green + "55", opacity: exporting ? 0.6 : 1 }} title="Export Unit, Log Servis, Invoice & Rekap ke Excel">
              {exporting ? "⏳ Export…" : "📊 Export Excel"}
            </button>
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
function UnitsTab({ sel, units, setUnits, call, showNotif, showConfirm, isOwner, apiFetch, supabase, setOrdersData, getLocalDate, teknisiData, createOrderFn, createTeamSplitFn }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [edit, setEdit] = useState(null);
  const [qrUnit, setQrUnit] = useState(null);
  const [showCsv, setShowCsv] = useState(false);
  // ── Buat Order (opsi A): pilih unit → order PENDING masuk Planning Order ──
  const [orderMode, setOrderMode] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [showOrderModal, setShowOrderModal] = useState(false);
  const togglePick = (id) => setPicked(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

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

  const pickedUnits = units.filter(u => picked.has(u.id));

  const createOrder = async ({ date, service, time, notes, teknisi, helper, teamCount, teamAssign }) => {
    if (picked.size === 0) { showNotif("❌ Pilih minimal 1 unit"); return false; }
    const locs = [...new Set(pickedUnits.map(u => u.location).filter(Boolean))];
    const locNote = locs.length ? "Lokasi: " + locs.join(", ") : "";
    const noteStr = [`Maintenance ${sel.name}`, locNote, notes].filter(Boolean).join(" · ");

    // ── Multi-tim (job ramai): 1 project → N sub-order paralel via createTeamSplitFn. ──
    if (teamCount > 1 && createTeamSplitFn) {
      const ids = [...picked];
      // Bagi rata (contiguous chunk) ke tiap tim.
      const per = Math.ceil(ids.length / teamCount);
      const teams = Array.from({ length: teamCount }, (_, i) => ({
        teknisi: teamAssign?.[i]?.teknisi || "",
        helper:  teamAssign?.[i]?.helper || "",
        unitIds: ids.slice(i * per, (i + 1) * per),
      })).filter(t => t.unitIds.length > 0);
      const base = {
        customer: sel.name, phone: sel.pic_phone || "", address: sel.address || "", area: sel.area || "",
        service, type: service, date, time: time || "09:00", notes: noteStr,
        maintenance_client_id: sel.id,
      };
      const groupId = await createTeamSplitFn({ base, teams });
      if (!groupId) return false;
      setShowOrderModal(false); setOrderMode(false); setPicked(new Set());
      return true;
    }

    const baseForm = {
      customer: sel.name,
      phone:    sel.pic_phone || "",
      address:  sel.address || "",
      area:     sel.area || "",
      service,
      type:     service,
      units:    picked.size,
      date,
      time:     time || "09:00",
      notes:    noteStr,
      maintenance_client_id: sel.id,
      maintenance_unit_ids:  [...picked],
    };

    // ── Opsi B: teknisi dipilih → reuse createOrder App.jsx (cek konflik DB,
    //    time_end otomatis, status CONFIRMED + auto-dispatch + autolog hook). ──
    if (teknisi && createOrderFn) {
      const res = await createOrderFn({ ...baseForm, teknisi, helper: helper || "" });
      if (!res) return false; // gagal / bentrok — createOrderFn sudah kasih notif, modal tetap terbuka
      setShowOrderModal(false); setOrderMode(false); setPicked(new Set());
      return true;
    }

    // ── Opsi A: tanpa teknisi → order PENDING, assign di Planning Order. ──
    const jobId = "JOB-" + Date.now().toString(36).toUpperCase().slice(-6) + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
    const orderPayload = {
      id: jobId, customer: sel.name, phone: sel.pic_phone || null,
      address: sel.address || "", area: sel.area || "",
      service, type: service, units: picked.size,
      date, time: time || "09:00", time_end: "11:00",
      status: "PENDING", dispatch: false, source: "maintenance",
      maintenance_client_id: sel.id, maintenance_unit_ids: [...picked],
      notes: noteStr,
    };
    const { error } = await supabase.from("orders").insert(orderPayload);
    if (error) { showNotif("❌ Gagal buat order: " + error.message); return false; }
    setOrdersData?.(prev => prev.some(o => o.id === jobId) ? prev : [orderPayload, ...prev]);
    setShowOrderModal(false); setOrderMode(false); setPicked(new Set());
    showNotif(`✅ Order ${jobId} (${picked.size} unit) masuk Planning Order. Assign teknisi di sana.`);
    return true;
  };

  const today = typeof getLocalDate === "function" ? getLocalDate() : new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Cari unit / lokasi / brand…" style={{ ...inp, flex: 1, minWidth: 160 }} />
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inp, maxWidth: 150 }}>
          <option value="">Semua Jenis</option>
          {AC_TYPES.map(t => <option key={t} value={t}>{AC_TYPE_LABELS[t]}</option>)}
        </select>
        {isOwner && <button onClick={() => setShowCsv(true)} style={{ ...btnGhost, fontSize: 12 }}>📥 Import CSV</button>}
        <button onClick={() => { setOrderMode(m => !m); setPicked(new Set()); }}
          style={orderMode ? { ...btn, background: cs.green } : { ...btnGhost, fontSize: 12, color: cs.green, borderColor: cs.green + "55" }}>
          {orderMode ? "✕ Batal Pilih" : "🛠 Buat Order"}
        </button>
        <button onClick={() => setEdit({})} style={btn}>+ Unit Baru</button>
      </div>

      {orderMode && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: cs.green + "12", border: "1px solid " + cs.green + "44", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: cs.text }}>
            <b style={{ color: cs.green }}>{picked.size}</b> unit terpilih
          </span>
          <button onClick={() => setPicked(new Set(filtered.map(u => u.id)))} style={{ ...miniBtn, color: cs.accent }}>Pilih semua ({filtered.length})</button>
          <button onClick={() => setShowOrderModal(true)} disabled={picked.size === 0}
            style={{ ...btn, marginLeft: "auto", opacity: picked.size === 0 ? 0.5 : 1, cursor: picked.size === 0 ? "not-allowed" : "pointer" }}>
            Lanjut Buat Order →
          </button>
        </div>
      )}

      {filtered.length === 0 ? <div style={{ color: cs.muted }}>Belum ada unit.</div> :
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
          {filtered.map(u => {
            const dueDays = daysUntil(u.next_service_date);
            const overdue = dueDays !== null && dueDays < 0;
            const dueSoon = dueDays !== null && dueDays >= 0 && dueDays <= 14;
            const isPicked = picked.has(u.id);
            return (
              <div key={u.id}
                onClick={orderMode ? () => togglePick(u.id) : undefined}
                style={{ ...card, padding: 12, cursor: orderMode ? "pointer" : "default",
                  ...(orderMode && isPicked ? { border: "2px solid " + cs.green, background: cs.green + "0d" } : {}) }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {orderMode && <span style={{ fontSize: 14 }}>{isPicked ? "☑️" : "⬜"}</span>}
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
                  {!orderMode && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <button onClick={() => setQrUnit(u)} style={miniBtn} title="QR Unit">QR</button>
                      <button onClick={() => setEdit(u)} style={miniBtn} title="Edit">✏️</button>
                      {isOwner && <button onClick={() => del(u)} style={{ ...miniBtn, color: cs.red }}>🗑</button>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>}

      {edit !== null && <UnitFormModal unit={edit} onClose={() => setEdit(null)} onSave={save} />}
      {qrUnit && <UnitQrModal unit={qrUnit} sel={sel} onClose={() => setQrUnit(null)} />}
      {showCsv && <CsvImportModal sel={sel} call={call} setUnits={setUnits} showNotif={showNotif} onClose={() => setShowCsv(false)} />}
      {showOrderModal && <CreateOrderModal sel={sel} pickedUnits={pickedUnits} today={today} teknisiData={teknisiData} onClose={() => setShowOrderModal(false)} onCreate={createOrder} />}
    </div>
  );
}

// Modal buat order dari unit terpilih.
// Teknisi opsional: kosong → order PENDING (opsi A, assign di Planning Order);
// dipilih → order CONFIRMED + cek konflik DB + auto-dispatch (opsi B).
function CreateOrderModal({ sel, pickedUnits, today, teknisiData, onClose, onCreate }) {
  const [date, setDate] = useState(today);
  const [service, setService] = useState("Cleaning");
  const [time, setTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [teknisi, setTeknisi] = useState("");
  const [helper, setHelper] = useState("");
  const [teamCount, setTeamCount] = useState(1);
  const [teamAssign, setTeamAssign] = useState([]); // [{teknisi, helper}] per tim
  const [busy, setBusy] = useState(false);
  const teknisiOpts = (teknisiData || []).filter(t => t.role === "Teknisi" || t.role === "Helper");
  const multi = teamCount > 1;
  const setTA = (i, key, val) => setTeamAssign(prev => {
    const n = prev.slice();
    n[i] = { ...(n[i] || {}), [key]: val };
    return n;
  });
  // Pratinjau pembagian unit per tim (contiguous chunk, sama dgn createOrder).
  const per = multi ? Math.ceil(pickedUnits.length / teamCount) : pickedUnits.length;
  const submit = async () => {
    if (!date) return;
    setBusy(true);
    await onCreate({ date, service, time, notes, teknisi, helper, teamCount, teamAssign });
    setBusy(false);
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: cs.surface, borderRadius: 16, padding: 18, width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ margin: 0, color: cs.text, fontSize: 16 }}>🛠 Buat Order</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 12 }}>
          {sel.name} · <b style={{ color: cs.green }}>{pickedUnits.length} unit</b>
        </div>
        <div style={{ maxHeight: 140, overflowY: "auto", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "6px 10px", marginBottom: 12 }}>
          {pickedUnits.map(u => (
            <div key={u.id} style={{ fontSize: 12, color: cs.text, padding: "3px 0" }}>
              • {u.unit_code}{u.location ? <span style={{ color: cs.muted }}> — {u.location}</span> : ""}
            </div>
          ))}
        </div>
        <Field l="Tanggal"><input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} /></Field>
        <Field l="Jam"><input type="time" value={time} onChange={e => setTime(e.target.value)} style={inp} /></Field>
        <Field l="Jenis Servis">
          <select value={service} onChange={e => setService(e.target.value)} style={inp}>
            {["Cleaning", "Repair", "Install", "Maintenance"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field l="Jumlah Tim">
          <select value={teamCount} onChange={e => setTeamCount(parseInt(e.target.value))} style={inp}>
            {[1, 2, 3, 4].map(n => (
              <option key={n} value={n} disabled={n > pickedUnits.length}>
                {n === 1 ? "1 tim (1 order)" : `${n} tim paralel (~${Math.ceil(pickedUnits.length / n)} unit/tim)`}
              </option>
            ))}
          </select>
        </Field>

        {!multi && (
          <>
            <Field l="Teknisi (opsional)">
              <select value={teknisi} onChange={e => setTeknisi(e.target.value)} style={inp}>
                <option value="">— Assign nanti di Planning Order —</option>
                {teknisiOpts.map(t => <option key={t.id} value={t.name}>{t.name}{t.role === "Helper" ? " [H]" : ""}</option>)}
              </select>
            </Field>
            {teknisi && (
              <Field l="Helper (opsional)">
                <select value={helper} onChange={e => setHelper(e.target.value)} style={inp}>
                  <option value="">— Tanpa helper —</option>
                  {teknisiOpts.filter(t => t.name !== teknisi).map(t => <option key={t.id} value={t.name}>{t.name}{t.role === "Helper" ? " [H]" : ""}</option>)}
                </select>
              </Field>
            )}
          </>
        )}

        {multi && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 12, color: cs.muted, marginBottom: 8 }}>
              {pickedUnits.length} unit dibagi rata ke {teamCount} tim (~{per} unit/tim). Tiap tim = 1 sub-order & 1 laporan sendiri.
            </div>
            {Array.from({ length: teamCount }, (_, i) => {
              const cnt = pickedUnits.slice(i * per, (i + 1) * per).length;
              if (cnt === 0) return null;
              const tk = teamAssign[i]?.teknisi || "";
              return (
                <div key={i} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.green, marginBottom: 6 }}>Tim {i + 1} · {cnt} unit</div>
                  <select value={tk} onChange={e => setTA(i, "teknisi", e.target.value)} style={{ ...inp, marginBottom: 6 }}>
                    <option value="">— Teknisi (assign nanti) —</option>
                    {teknisiOpts.map(t => <option key={t.id} value={t.name}>{t.name}{t.role === "Helper" ? " [H]" : ""}</option>)}
                  </select>
                  {tk && (
                    <select value={teamAssign[i]?.helper || ""} onChange={e => setTA(i, "helper", e.target.value)} style={inp}>
                      <option value="">— Tanpa helper —</option>
                      {teknisiOpts.filter(t => t.name !== tk).map(t => <option key={t.id} value={t.name}>{t.name}{t.role === "Helper" ? " [H]" : ""}</option>)}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <Field l="Catatan (opsional)"><input value={notes} onChange={e => setNotes(e.target.value)} style={inp} placeholder="cth: bawa tangga, akses lewat lobby" /></Field>
        <div style={{ fontSize: 11, color: cs.muted, marginTop: 6 }}>
          {multi
            ? `🏢 ${teamCount} sub-order paralel dibuat. Tim dgn teknisi → CONFIRMED (cek bentrok otomatis); kosong → PENDING.`
            : teknisi
              ? `⚡ Order langsung CONFIRMED ke ${teknisi}. Sistem cek bentrok jadwal otomatis.`
              : "ℹ️ Tanpa teknisi → order PENDING, assign nanti di Planning Order."}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Batal</button>
          <button onClick={submit} disabled={busy || !date}
            style={{ ...btn, flex: 2, background: cs.green, opacity: busy || !date ? 0.6 : 1, cursor: busy || !date ? "not-allowed" : "pointer" }}>
            {busy ? "Proses…" : multi ? `✅ Buat ${teamCount} Sub-Order Tim` : teknisi ? `✅ Buat & Tugaskan ke ${teknisi.split(" ")[0]}` : "✅ Buat Order → Planning Order"}
          </button>
        </div>
      </div>
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
  const [catFilter, setCatFilter] = useState("all");
  const [uploadingLogId, setUploadingLogId] = useState(null);

  const logsByUnit = (uid) => {
    let ul = logs.filter(l => l.unit_id === uid);
    if (catFilter !== "all") ul = ul.filter(l => (l.service_category || "cuci_rutin") === catFilter);
    return ul.sort((a, b) => (b.service_date || "").localeCompare(a.service_date || ""));
  };

  const uploadLogPhoto = async (logId, currentPhotos, file) => {
    setUploadingLogId(logId);
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      const up = await apiFetch("/api/upload-foto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64: b64, filename: file.name, mimeType: file.type, folder: `maintenance/${sel.id}` }) });
      const uj = await up.json().catch(() => ({}));
      if (!uj.key) { showNotif("❌ Upload gagal"); return; }
      const newPhotos = [...(Array.isArray(currentPhotos) ? currentPhotos : []), uj.key];
      const j = await call("update-log", { id: logId, photos: newPhotos });
      setLogs(p => p.map(l => l.id === logId ? { ...l, photos: newPhotos } : l));
      showNotif("✅ Foto ditambahkan");
    } catch (e) { showNotif("❌ " + e.message); }
    finally { setUploadingLogId(null); }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: cs.muted, marginRight: 4 }}>Filter:</span>
        {[["all","Semua"],["cuci_rutin","Cuci Rutin"],["inspeksi","Inspeksi"],["perbaikan","Perbaikan"],["pengecekan","Cek Saja"]].map(([k,l]) => (
          <button key={k} onClick={() => setCatFilter(k)} style={catFilter === k ? { ...tabActive, padding: "4px 10px", fontSize: 12 } : { ...tabBtn, padding: "4px 10px", fontSize: 12 }}>{l}</button>
        ))}
      </div>
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
                          {l.service_category && l.service_category !== "cuci_rutin" && (
                            <span style={{ background: cs.accent + "15", color: cs.accent, padding: "1px 8px", borderRadius: 6, fontSize: 11 }}>
                              {SERVICE_CATEGORY_LABELS[l.service_category] || l.service_category}
                            </span>
                          )}
                          {l.service_category === "pengecekan" && <span style={pillGray}>Non-billable</span>}
                          {l.cost > 0 && <span style={pillYellow}>{fmtRp(l.cost)}</span>}
                          {l.invoiced && <span style={pillGreen}>✓ Invoiced</span>}
                          <label style={{ ...miniBtn, cursor: "pointer", opacity: uploadingLogId === l.id ? .5 : 1, marginLeft: "auto" }} title="Tambah foto">
                            {uploadingLogId === l.id ? "⏳" : "📷"}
                            <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploadingLogId === l.id}
                              onChange={e => { if (e.target.files[0]) uploadLogPhoto(l.id, l.photos, e.target.files[0]); e.target.value = ""; }} />
                          </label>
                          {isOwner && (
                            <button onClick={async () => {
                              if (!(await showConfirm({ title: "Hapus log?", message: "Hapus riwayat ini?" }))) return;
                              try { await call("delete-log", { id: l.id }); setLogs(p => p.filter(x => x.id !== l.id)); showNotif("✅ Dihapus"); }
                              catch (e) { showNotif("❌ " + e.message); }
                            }} style={{ ...miniBtn, color: cs.red }}>🗑</button>
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

// ─────────── HISTORY SERVICE TAB (kumpulan invoice per perusahaan) ───────────
const INV_STATUS_STYLE = {
  PAID: pillGreen,
  PARTIAL_PAID: pillYellow,
  UNPAID: pillYellow,
  OVERDUE: { background: (cs.red || "#ef4444") + "22", color: cs.red || "#ef4444", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 },
  PENDING_APPROVAL: pillBlue,
  APPROVED: pillBlue,
  DRAFT: pillGray,
};
function svcCategory(inv) {
  const s = ((inv.service || "") + " " + (inv.invoice_type || "")).toLowerCase();
  if (/clean|cuci/.test(s)) return "Cleaning";
  if (/install|pasang|instalasi/.test(s)) return "Install";
  if (/complain|komplain|keluhan/.test(s)) return "Complain";
  if (/repair|perbaik|freon|sparepart|servis|service/.test(s)) return "Repair";
  return "Lainnya";
}
function HistoryServiceTab({ sel, call, showNotif }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState("Semua");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    call("list-invoices", { client_id: sel.id })
      .then(j => { if (alive) setInvoices(j.invoices || []); })
      .catch(e => { if (alive) showNotif("❌ " + e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sel.id, call, showNotif]);

  const CATS = ["Semua", "Cleaning", "Install", "Repair", "Complain", "Lainnya"];
  const counts = {};
  invoices.forEach(iv => { const c = svcCategory(iv); counts[c] = (counts[c] || 0) + 1; });
  const shown = cat === "Semua" ? invoices : invoices.filter(iv => svcCategory(iv) === cat);

  const paidOf = (iv) => {
    const pa = Number(iv.paid_amount) || 0;
    if (pa > 0) return pa;
    return iv.status === "PAID" ? (Number(iv.total) || 0) : 0;
  };
  const totalBilled = shown.reduce((s, iv) => s + (Number(iv.total) || 0), 0);
  const totalPaid = shown.reduce((s, iv) => s + paidOf(iv), 0);
  const outstanding = totalBilled - totalPaid;

  if (loading) return <div style={{ color: cs.muted, padding: 16 }}>Memuat invoice…</div>;

  return (
    <div>
      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 12 }}>
        Semua invoice yang tersambung ke <b style={{ color: cs.text }}>{sel.name}</b> — dari jalur Order/Report maupun Invoice B2B.
      </div>

      {/* Ringkasan */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
        <KpiCard label="Total Invoice" value={shown.length} sub={`dari ${invoices.length} total`} color={cs.accent} />
        <KpiCard label="Total Ditagih" value={fmtRp(totalBilled)} sub="nilai invoice" color={cs.text} />
        <KpiCard label="Sudah Dibayar" value={fmtRp(totalPaid)} sub="terlunasi" color={cs.green} />
        <KpiCard label="Outstanding" value={fmtRp(outstanding)} sub="belum dibayar" color={outstanding > 0 ? (cs.yellow || "#eab308") : cs.muted} />
      </div>

      {/* Filter kategori */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {CATS.map(c => (
          <button key={c} onClick={() => setCat(c)} style={cat === c ? tabActive : tabBtn}>
            {c}{c !== "Semua" && counts[c] ? ` (${counts[c]})` : ""}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div style={{ color: cs.muted, padding: 16 }}>Belum ada invoice{cat !== "Semua" ? ` kategori ${cat}` : ""}.</div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          {shown.map(iv => {
            const stStyle = INV_STATUS_STYLE[iv.status] || pillGray;
            const c = svcCategory(iv);
            return (
              <div key={iv.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 14px", borderBottom: "1px solid " + cs.border, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: cs.accent, fontSize: 12 }}>{iv.id}</span>
                    <span style={pillBlue}>{c}</span>
                    {iv.job_id && <span style={{ fontSize: 10, color: cs.muted, fontFamily: "monospace" }}>{iv.job_id}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: cs.muted, marginTop: 3 }}>
                    {iv.service || "—"} · {iv.units || 1} unit · {fmtDate(iv.created_at)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, color: cs.text }}>{fmtRp(iv.total)}</div>
                  {paidOf(iv) > 0 && paidOf(iv) < (Number(iv.total) || 0) && (
                    <div style={{ fontSize: 10, color: cs.muted }}>dibayar {fmtRp(paidOf(iv))}</div>
                  )}
                </div>
                <span style={stStyle}>{iv.status}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
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
// Harga fallback per PK (sinkron dengan price_list DB)
const MAINT_PRICE = { p1: 95000, p2: 100000, p3: 300000, p4: 400000 };
function maintPrice(pk) {
  const n = parseFloat(pk) || 1;
  if (n <= 1) return MAINT_PRICE.p1;
  if (n <= 2.5) return MAINT_PRICE.p2;
  if (n <= 3.5) return MAINT_PRICE.p3;
  return MAINT_PRICE.p4;
}

function InvoiceTab({ sel, units, logs, call, showNotif }) {
  const [picked, setPicked] = useState({});
  const [filterDate, setFilterDate] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [preview, setPreview] = useState(null);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const unitById = Object.fromEntries(units.map(u => [u.id, u]));
  const calcPrice = (l) => Number(l.cost) > 0 ? Number(l.cost) : maintPrice(unitById[l.unit_id]?.capacity_pk);

  // Semua log belum di-invoice; showAll juga tampilkan yang sudah di-invoice (untuk re-group)
  const eligible = logs.filter(l => showAll ? true : !l.invoiced);
  const filtered = filterDate ? eligible.filter(l => l.service_date?.startsWith(filterDate)) : eligible;

  const pickedIds = Object.keys(picked).filter(k => picked[k]);
  const pickedLogs = filtered.filter(l => picked[l.id]);
  const subtotal = pickedLogs.reduce((s, l) => s + calcPrice(l), 0);
  const totalAfterDisc = Math.max(0, subtotal - Number(discount));

  // Group picked logs by service_date untuk preview
  const byDate = {};
  for (const l of pickedLogs) {
    const d = l.service_date || "-";
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(l);
  }

  const toggleAll = () => {
    if (pickedIds.length === filtered.length) {
      setPicked({});
    } else {
      const all = {};
      filtered.forEach(l => { all[l.id] = true; });
      setPicked(all);
    }
  };

  const doPreview = async () => {
    if (!pickedIds.length) { showNotif("❌ Pilih minimal 1 servis"); return; }
    try {
      const j = await call("preview-invoice", { client_id: sel.id, log_ids: pickedIds, discount: Number(discount) });
      setPreview(j);
    } catch (e) { showNotif("❌ " + e.message); }
  };

  const create = async () => {
    if (!pickedIds.length) { showNotif("❌ Pilih minimal 1 servis"); return; }
    setBusy(true);
    try {
      const j = await call("create-invoice", { client_id: sel.id, log_ids: pickedIds, discount: Number(discount), notes: notes || null });
      showNotif(`✅ Invoice ${j.invoice.id} dibuat (Rp ${j.total.toLocaleString("id")}) — cek menu Invoice`);
      setPicked({}); setPreview(null); setDiscount(0); setNotes("");
    } catch (e) { showNotif("❌ " + e.message); }
    finally { setBusy(false); }
  };

  // Tanggal-tanggal unik untuk quick filter
  const availDates = [...new Set(eligible.map(l => l.service_date?.slice(0, 7)).filter(Boolean))].sort().reverse();

  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
      {/* Kiri: daftar log */}
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        {/* Filter bar */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ color: cs.muted, fontSize: 12 }}>Filter bulan:</span>
          <select value={filterDate} onChange={e => setFilterDate(e.target.value)}
            style={{ ...inp, width: "auto", fontSize: 12, padding: "4px 8px" }}>
            <option value="">Semua</option>
            {availDates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: cs.muted, cursor: "pointer" }}>
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            Tampilkan yg sudah di-invoice
          </label>
          <button onClick={toggleAll} style={{ ...btnGhost, fontSize: 12, padding: "4px 10px", marginLeft: "auto" }}>
            {pickedIds.length === filtered.length && filtered.length > 0 ? "Batal semua" : `Pilih semua (${filtered.length})`}
          </button>
        </div>

        {filtered.length === 0
          ? <div style={{ color: cs.muted, padding: 16 }}>Tidak ada servis yang memenuhi filter.</div>
          : <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            {filtered.map(l => {
              const u = unitById[l.unit_id] || {};
              const price = calcPrice(l);
              return (
                <label key={l.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 14px", borderBottom: "1px solid " + cs.border, cursor: "pointer", opacity: l.invoiced ? 0.6 : 1 }}>
                  <input type="checkbox" checked={!!picked[l.id]} onChange={e => setPicked(p => ({ ...p, [l.id]: e.target.checked }))} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: cs.text, fontWeight: 600, fontSize: 13 }}>{u.unit_code || "?"}</div>
                    <div style={{ color: cs.muted, fontSize: 11 }}>{u.location} · {u.brand} {u.capacity_pk}PK · {l.service_type} · {l.service_date}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ color: cs.green, fontWeight: 600, fontSize: 13 }}>{fmtRp(price)}</div>
                    {l.invoiced && <div style={{ color: cs.muted, fontSize: 10 }}>✓ invoiced</div>}
                  </div>
                </label>
              );
            })}
          </div>
        }
      </div>

      {/* Kanan: ringkasan & aksi */}
      <div style={{ width: 260, flexShrink: 0 }}>
        <div style={{ ...card }}>
          <div style={{ fontWeight: 700, color: cs.text, marginBottom: 12 }}>🧾 Ringkasan Invoice</div>

          {pickedIds.length === 0
            ? <div style={{ color: cs.muted, fontSize: 13 }}>Belum ada unit dipilih</div>
            : <>
              {Object.entries(byDate).map(([d, items]) => (
                <div key={d} style={{ marginBottom: 8 }}>
                  <div style={{ color: cs.muted, fontSize: 11, marginBottom: 3 }}>{d}</div>
                  {items.map(l => {
                    const u = unitById[l.unit_id] || {};
                    return (
                      <div key={l.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: cs.text, padding: "2px 0" }}>
                        <span>{u.unit_code} {u.brand} {u.capacity_pk}PK</span>
                        <span>{fmtRp(calcPrice(l))}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div style={{ borderTop: "1px solid " + cs.border, paddingTop: 8, marginTop: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: cs.text }}>
                  <span>Subtotal ({pickedIds.length} unit)</span>
                  <span style={{ fontWeight: 600 }}>{fmtRp(subtotal)}</span>
                </div>
              </div>
            </>
          }

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: cs.muted, marginBottom: 4 }}>Diskon (Rp)</div>
            <input type="number" min="0" value={discount} onChange={e => setDiscount(e.target.value)}
              style={{ ...inp, fontSize: 13 }} placeholder="0" />
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: cs.muted, marginBottom: 4 }}>Catatan invoice</div>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              style={{ ...inp, fontSize: 13 }} placeholder="Opsional" />
          </div>

          {pickedIds.length > 0 && (
            <div style={{ marginTop: 10, padding: "8px 0", borderTop: "1px solid " + cs.border, display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <b style={{ color: cs.text }}>Total</b>
              <b style={{ color: cs.green }}>{fmtRp(totalAfterDisc)}</b>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            <button onClick={doPreview} disabled={!pickedIds.length} style={{ ...btnGhost, opacity: pickedIds.length ? 1 : .4, fontSize: 13 }}>
              👁 Preview (dari server)
            </button>
            <button onClick={create} disabled={!pickedIds.length || busy} style={{ ...btn, opacity: (pickedIds.length && !busy) ? 1 : .4, fontSize: 13 }}>
              {busy ? "Membuat..." : "🧾 Buat Invoice Grup"}
            </button>
          </div>

          {preview && (
            <div style={{ marginTop: 14, fontSize: 12, color: cs.muted }}>
              <div style={{ fontWeight: 600, color: cs.text, marginBottom: 6 }}>Preview server:</div>
              {preview.line_items?.map((i, idx) => (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>{i.unit_code} {i.brand} {i.pk}PK</span>
                  <span style={{ color: cs.green }}>{fmtRp(i.price)}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid " + cs.border, marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                <span style={{ color: cs.text }}>Total</span>
                <span style={{ color: cs.green }}>{fmtRp(preview.total)}</span>
              </div>
            </div>
          )}
        </div>
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

function QuotasiTab({ sel, quotations, quotationsData, setQuotationsData, setOrdersData, supabase, customersData, priceListData, getLocalDate, showNotif, showConfirm, isOwner, appSettings, sendWAFn, uploadQuotationPDFFn }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editQ, setEditQ] = useState(null);
  const [previewQ, setPreviewQ] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [approveTargetId, setApproveTargetId] = useState(null);
  const [approveDate, setApproveDate] = useState("");
  const [approvingId, setApprovingId] = useState(null);
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

  // ── Approve: convert quotation → order masuk Planning Order, di-link ke
  //    maintenance client (sel.id) supaya autolog order→unit B2B tetap jalan.
  //    Invoice TIDAK dibuat di sini (flow: order → laporan teknisi → invoice).
  const handleApprove = async (quo, scheduledDate) => {
    setApprovingId(quo.id);
    setApproveTargetId(null);
    setApproveDate("");
    try {
      const orderDate = scheduledDate || today;
      const jobId = "JOB-" + Date.now().toString(36).toUpperCase().slice(-6) + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();

      const totalUnits = (quo.items || []).filter(i => i.item_type === "unit_ac").reduce((s, i) => s + (i.qty || 1), 0) || 1;
      const itemDescs = (quo.items || []).map(i => (i.description || "").toLowerCase()).join(" ");
      const detectedService = (() => {
        if ((quo.items || []).some(i => i.item_type === "unit_ac")) return "Install";
        if (/cuci|cleaning|maintenance|rutin/.test(itemDescs)) return "Cleaning";
        if (/repair|perbaik|freon|isi gas/.test(itemDescs)) return "Repair";
        if (/pasang|install/.test(itemDescs)) return "Install";
        return "Cleaning";
      })();
      const _nLow = (quo.notes || "").toLowerCase();
      const isPresetNote = _nLow.includes("jasa perapian tembok") && _nLow.includes("term of payment");
      const customNote = quo.notes && !isPresetNote ? quo.notes : "";
      const orderPayload = {
        id:         jobId,
        customer:   quo.customer,
        phone:      quo.phone || null,
        address:    quo.address || "",
        area:       quo.area || "",
        service:    detectedService,
        type:       detectedService,
        units:      totalUnits,
        date:       orderDate,
        time:       "09:00",
        time_end:   "11:00",
        status:     "PENDING",
        dispatch:   false,
        source:     "quotation",
        maintenance_client_id: sel.id,
        notes:      `Auto dari Quotation ${quo.id}${customNote ? " · " + customNote : ""}`,
      };
      const { error: orderErr } = await supabase.from("orders").insert(orderPayload);
      if (orderErr) throw new Error("Gagal buat order: " + orderErr.message);

      const { error: quoErr } = await supabase.from("quotations").update({
        status: "APPROVED", job_id: jobId, updated_at: new Date().toISOString()
      }).eq("id", quo.id);
      if (quoErr) {
        await supabase.from("orders").delete().eq("id", jobId);
        throw new Error("Gagal update quotation: " + quoErr.message);
      }

      setQuotationsData(prev => prev.map(x => x.id === quo.id ? { ...x, status: "APPROVED", job_id: jobId } : x));
      setOrdersData?.(prev => prev.some(o => o.id === jobId) ? prev : [orderPayload, ...prev]);
      showNotif(`✅ ${quo.id} approved — Order ${jobId} masuk Planning Order. Invoice dibuat setelah laporan teknisi.`);
    } catch (err) {
      showNotif("❌ " + (err.message || err));
    } finally {
      setApprovingId(null);
    }
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
                      {q.job_id && <span style={{ ...pillGreen, fontSize: 10 }}>Order: {q.job_id}</span>}
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
                      {!["APPROVED", "CANCELLED"].includes(q.status) && approveTargetId !== q.id && (
                        <button onClick={() => { setApproveTargetId(q.id); setApproveDate(today); }} disabled={approvingId === q.id}
                          style={{ ...miniBtn, color: cs.green, borderColor: cs.green + "55" }}>
                          {approvingId === q.id ? "…" : "✅ Approve"}
                        </button>
                      )}
                      <button onClick={() => { setEditQ(q); setShowCreate(true); }} style={miniBtn}>✏️</button>
                      {isOwner && <button onClick={() => delQ(q)} style={{ ...miniBtn, color: cs.red }}>🗑</button>}
                    </div>
                  </div>
                </div>
                {approveTargetId === q.id && !["APPROVED", "CANCELLED"].includes(q.status) && (
                  <div style={{ borderTop: "1px solid " + cs.border, background: cs.green + "0d", padding: "10px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: cs.muted }}>Tgl jadwal order:</span>
                    <input type="date" value={approveDate} onChange={e => setApproveDate(e.target.value)}
                      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid " + cs.border, background: cs.surface, color: cs.text, fontSize: 12 }} />
                    <button onClick={() => handleApprove(q, approveDate)} disabled={approvingId === q.id || !approveDate}
                      style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: cs.green, color: "#fff", fontWeight: 700, fontSize: 12, cursor: approvingId === q.id || !approveDate ? "not-allowed" : "pointer", opacity: approvingId === q.id || !approveDate ? 0.6 : 1 }}>
                      {approvingId === q.id ? "Proses…" : "✅ Konfirmasi → Buat Order"}
                    </button>
                    <button onClick={() => { setApproveTargetId(null); setApproveDate(""); }}
                      style={{ ...miniBtn, color: cs.muted }}>Batal</button>
                  </div>
                )}
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

// ─────────── FOLLOWUP TAB ───────────
const ISSUE_LABELS = { kapasitor_rusak: "⚡ Kapasitor Rusak", bocor_freon: "❄️ Bocor Freon", kompresor_lemah: "🔧 Kompresor Lemah", drain_tersumbat: "💧 Drain Tersumbat", pcb_rusak: "🔌 PCB Rusak", filter_buntu: "🌫️ Filter Buntu", fan_motor_lemah: "💨 Fan Motor Lemah", lainnya: "📋 Lainnya" };
const PRIORITY_COLORS = { critical: "#ef4444", high: "#f97316", normal: "#eab308", low: "#6b7280" };
const FU_STATUS_LABELS = { open: "Terbuka", scheduled: "Terjadwal", in_progress: "Dikerjakan", done: "Selesai", cancelled: "Dibatalkan" };
const FU_STATUS_COLORS = { open: "#ef4444", scheduled: "#38bdf8", in_progress: "#eab308", done: "#22c55e", cancelled: "#6b7280" };

function FollowupTab({ sel, units, logs, call, showNotif, showConfirm, isOwner, currentUser }) {
  const [followups, setFollowups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState("open");
  const [addModal, setAddModal] = useState(false);

  const load = useCallback(async () => {
    if (!sel) return;
    setLoading(true);
    try {
      const payload = { client_id: sel.id };
      if (catFilter !== "all") payload.status = catFilter;
      const j = await call("list-followups", payload);
      setFollowups(j.followups || []);
    } catch (e) { showNotif("❌ " + e.message); }
    finally { setLoading(false); }
  }, [sel, call, showNotif, catFilter]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id, newStatus) => {
    try {
      const patch = { id, status: newStatus };
      if (newStatus === "done") patch.resolved_by = currentUser?.name || "Admin";
      await call("update-followup", patch);
      setFollowups(p => catFilter !== "all"
        ? p.filter(x => x.id !== id)
        : p.map(x => x.id === id ? { ...x, status: newStatus } : x));
      showNotif("✅ Status diperbarui");
    } catch (e) { showNotif("❌ " + e.message); }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {[["open","🔴 Terbuka"],["scheduled","📅 Terjadwal"],["in_progress","🔧 Dikerjakan"],["done","✅ Selesai"],["all","Semua"]].map(([k,l]) => (
          <button key={k} onClick={() => setCatFilter(k)} style={catFilter === k ? { ...tabActive, padding: "5px 12px", fontSize: 12 } : { ...tabBtn, padding: "5px 12px", fontSize: 12 }}>{l}</button>
        ))}
        <button onClick={() => setAddModal(true)} style={{ ...btn, marginLeft: "auto" }}>+ Catat Temuan</button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 32, color: cs.muted }}>Memuat…</div>
      ) : followups.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: cs.muted }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{catFilter === "open" ? "✅" : "📋"}</div>
          {catFilter === "open" ? "Tidak ada temuan yang perlu ditindaklanjuti" : "Tidak ada data"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {followups.map(f => {
            const unit = f.maintenance_units || units.find(u => u.id === f.unit_id);
            const prioColor = PRIORITY_COLORS[f.priority] || cs.muted;
            const stColor = FU_STATUS_COLORS[f.status] || cs.muted;
            return (
              <div key={f.id} style={{ ...card, borderLeft: "4px solid " + prioColor }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start", justifyContent: "space-between" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>{ISSUE_LABELS[f.issue_type] || f.issue_type}</span>
                      <span style={{ background: stColor + "22", color: stColor, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{FU_STATUS_LABELS[f.status] || f.status}</span>
                      <span style={{ background: prioColor + "22", color: prioColor, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600 }}>{f.priority}</span>
                    </div>
                    <div style={{ color: cs.muted, fontSize: 12 }}>📍 {unit?.unit_code || "?"} — {unit?.location || ""} · {unit?.brand} {unit?.capacity_pk}PK</div>
                    {f.description && <div style={{ fontSize: 13, color: cs.text, marginTop: 5 }}>{f.description}</div>}
                    <div style={{ color: cs.muted, fontSize: 12, marginTop: 4 }}>
                      Ditemukan: {fmtDate(f.found_date)}{f.found_by ? ` oleh ${f.found_by}` : ""}
                    </div>
                    {f.estimated_cost > 0 && <div style={{ fontSize: 12, color: cs.yellow || "#eab308", marginTop: 2 }}>💰 Est. biaya: {fmtRp(f.estimated_cost)}</div>}
                    {f.status === "done" && f.resolution && (
                      <div style={{ marginTop: 8, padding: "6px 10px", background: cs.green + "11", borderRadius: 8, fontSize: 12, color: cs.green }}>
                        ✅ Resolusi: {f.resolution} {f.resolved_date ? `(${fmtDate(f.resolved_date)})` : ""}
                      </div>
                    )}
                  </div>
                  {f.status !== "done" && f.status !== "cancelled" && (
                    <select value={f.status} onChange={e => updateStatus(f.id, e.target.value)}
                      style={{ ...inp, width: "auto", fontSize: 12, padding: "5px 8px", flexShrink: 0 }}>
                      {["open","scheduled","in_progress","done","cancelled"].map(s => (
                        <option key={s} value={s}>{FU_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addModal && (
        <FollowupModal units={units} sel={sel} call={call} showNotif={showNotif}
          onClose={() => setAddModal(false)}
          onSave={f => { if (catFilter === "open" || catFilter === "all") setFollowups(p => [f, ...p]); setAddModal(false); showNotif("✅ Temuan dicatat"); }} />
      )}
    </div>
  );
}

function FollowupModal({ units, sel, call, showNotif, onClose, onSave }) {
  const [f, setF] = useState({ unit_id: "", issue_type: "kapasitor_rusak", description: "", found_by: "", priority: "normal", found_date: new Date().toISOString().slice(0, 10), estimated_cost: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const doSave = async () => {
    if (!f.unit_id || !f.issue_type) { showNotif("❌ Unit dan jenis masalah wajib"); return; }
    setBusy(true);
    try {
      const payload = { unit_id: f.unit_id, client_id: sel.id, issue_type: f.issue_type, found_by: f.found_by || null, priority: f.priority, found_date: f.found_date };
      if (f.description) payload.description = f.description;
      if (f.estimated_cost) payload.estimated_cost = Number(f.estimated_cost);
      const j = await call("create-followup", payload);
      onSave(j.followup);
    } catch (e) { showNotif("❌ " + e.message); setBusy(false); }
  };

  return (
    <Overlay onClose={onClose}>
      <div style={{ fontWeight: 700, color: cs.text, fontSize: 16, marginBottom: 12 }}>Catat Temuan Lapangan</div>
      <Field l="Unit *">
        <select value={f.unit_id} onChange={e => set("unit_id", e.target.value)} style={inp}>
          <option value="">— Pilih Unit —</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.unit_code} — {u.location}</option>)}
        </select>
      </Field>
      <Field l="Jenis Masalah *">
        <select value={f.issue_type} onChange={e => set("issue_type", e.target.value)} style={inp}>
          {Object.entries(ISSUE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field l="Tanggal Ditemukan">
          <input type="date" value={f.found_date} onChange={e => set("found_date", e.target.value)} style={inp} />
        </Field>
        <Field l="Prioritas">
          <select value={f.priority} onChange={e => set("priority", e.target.value)} style={inp}>
            <option value="critical">🔴 Critical</option>
            <option value="high">🟠 High</option>
            <option value="normal">🟡 Normal</option>
            <option value="low">⚪ Low</option>
          </select>
        </Field>
      </div>
      <Field l="Ditemukan oleh (Teknisi)">
        <input value={f.found_by} onChange={e => set("found_by", e.target.value)} placeholder="Nama teknisi" style={inp} />
      </Field>
      <Field l="Deskripsi / Detail Masalah">
        <textarea value={f.description} onChange={e => set("description", e.target.value)} rows={3} placeholder="Jelaskan kondisi yang ditemukan di lapangan..." style={{ ...inp, resize: "vertical" }} />
      </Field>
      <Field l="Estimasi Biaya Perbaikan (opsional)">
        <input type="number" value={f.estimated_cost} onChange={e => set("estimated_cost", e.target.value)} placeholder="0" style={inp} />
      </Field>
      <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btnGhost}>Batal</button>
        <button onClick={doSave} disabled={busy} style={{ ...btn, opacity: busy ? .5 : 1 }}>{busy ? "Menyimpan…" : "💾 Simpan Temuan"}</button>
      </div>
    </Overlay>
  );
}

// ─────────── MANIFEST TAB ───────────
function ManifestTab({ sel, units, call, showNotif }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [manifest, setManifest] = useState(null);
  const [assignments, setAssignments] = useState({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!sel || !date) return;
    setLoaded(false);
    try {
      const j = await call("get-manifest", { client_id: sel.id, service_date: date });
      setManifest(j.manifest || null);
      const map = {};
      (j.manifest?.pre_service_manifest_items || []).forEach(it => {
        map[it.unit_id] = { team_label: it.team_label || "", technician: it.technician || "", service_category: it.service_category || "cuci_rutin" };
      });
      setAssignments(map);
    } catch (e) { showNotif("❌ " + e.message); }
    finally { setLoaded(true); }
  }, [sel, date, call, showNotif]);

  useEffect(() => { load(); }, [load]);

  const setAssign = (uid, key, val) => setAssignments(p => ({ ...p, [uid]: { ...(p[uid] || {}), [key]: val } }));

  const activeUnits = units.filter(u => u.status !== "baru" && u.status !== "retired" && u.status !== "nonaktif");
  const baruUnits = units.filter(u => u.status === "baru");

  const doSave = async () => {
    setBusy(true);
    try {
      const items = activeUnits.filter(u => assignments[u.id]?.team_label || assignments[u.id]?.technician)
        .map(u => ({ unit_id: u.id, team_label: assignments[u.id]?.team_label || null, technician: assignments[u.id]?.technician || null, service_category: assignments[u.id]?.service_category || "cuci_rutin" }));
      const j = await call("create-manifest", { client_id: sel.id, service_date: date, items, created_by: "admin" });
      setManifest(j.manifest);
      showNotif("✅ Manifest disimpan — " + items.length + " unit terassign");
    } catch (e) { showNotif("❌ " + e.message); }
    finally { setBusy(false); }
  };

  const teams = [...new Set(Object.values(assignments).map(a => a.team_label).filter(Boolean))];
  const assigned = activeUnits.filter(u => assignments[u.id]?.team_label).length;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: cs.muted, marginBottom: 4 }}>Tanggal Servis</div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, width: "auto" }} />
        </div>
        {manifest && <span style={{ ...pillGreen }}>✅ Tersimpan</span>}
        {assigned > 0 && !manifest && <span style={{ ...pillBlue }}>{assigned} unit terassign</span>}
        {teams.length > 0 && <span style={{ color: cs.muted, fontSize: 12 }}>Tim: {teams.join(", ")}</span>}
        <button onClick={doSave} disabled={busy} style={{ ...btn, marginLeft: "auto", opacity: busy ? .5 : 1 }}>
          {busy ? "Menyimpan…" : "💾 Simpan Manifest"}
        </button>
      </div>

      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 10 }}>
        Isi kolom Tim (misal: Tim Rey, LT1) dan Teknisi per unit sebelum berangkat.
        Unit berstatus <strong>AC Baru</strong> otomatis di-skip dari penugasan.
      </div>

      {!loaded ? <div style={{ textAlign: "center", padding: 24, color: cs.muted }}>Memuat…</div> : (
        <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Unit","Lokasi","PK","Status","Tim","Teknisi","Kategori"].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {activeUnits.map(u => {
                const a = assignments[u.id] || {};
                return (
                  <tr key={u.id}>
                    <td style={td}><b>{u.unit_code}</b></td>
                    <td style={{ ...td, color: cs.muted, fontSize: 12 }}>{u.location || "—"}</td>
                    <td style={td}>{u.capacity_pk}PK</td>
                    <td style={td}>{statusPill(u.status)}</td>
                    <td style={td}>
                      <input value={a.team_label || ""} onChange={e => setAssign(u.id, "team_label", e.target.value)}
                        placeholder="Tim A" style={{ ...inp, width: 80, padding: "4px 7px", fontSize: 12 }} />
                    </td>
                    <td style={td}>
                      <input value={a.technician || ""} onChange={e => setAssign(u.id, "technician", e.target.value)}
                        placeholder="Nama" style={{ ...inp, width: 90, padding: "4px 7px", fontSize: 12 }} />
                    </td>
                    <td style={td}>
                      <select value={a.service_category || "cuci_rutin"} onChange={e => setAssign(u.id, "service_category", e.target.value)}
                        style={{ ...inp, width: 110, padding: "4px 7px", fontSize: 12 }}>
                        <option value="cuci_rutin">Cuci Rutin</option>
                        <option value="inspeksi">Inspeksi</option>
                        <option value="perbaikan">Perbaikan</option>
                        <option value="pengecekan">Cek Saja</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
              {baruUnits.length > 0 && (
                <tr>
                  <td colSpan={7} style={{ ...td, color: cs.muted, fontSize: 12, fontStyle: "italic", textAlign: "center", paddingTop: 12 }}>
                    {baruUnits.length} unit AC Baru ({baruUnits.map(u => u.unit_code).join(", ")}) — otomatis di-skip, tidak memerlukan penugasan
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────── PPM CALENDAR (global lintas klien) ───────────
function PPMCalendar({ call, showNotif, onBack }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(3);
  const [filterClient, setFilterClient] = useState("");

  useEffect(() => {
    setLoading(true);
    call("ppm-calendar", { months_ahead: months })
      .then(j => setEvents(j.events || []))
      .catch(e => showNotif("❌ " + e.message))
      .finally(() => setLoading(false));
  }, [call, months, showNotif]);

  const clients = [...new Set(events.map(e => e.client_name))].sort();
  const filtered = filterClient ? events.filter(e => e.client_name === filterClient) : events;

  // Group by month
  const byMonth = {};
  filtered.forEach(ev => {
    const m = ev.next_service_date?.slice(0, 7) || "?";
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(ev);
  });

  const today = new Date().toISOString().slice(0, 10);
  const statusDot = (s) => ({ active: "🟢", baru: "🔵", perlu_perbaikan: "🔴", dalam_perbaikan: "🟡", nonaktif: "⚫", rusak: "🔴", retired: "⚫" }[s] || "⚪");

  return (
    <div style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={onBack} style={btnGhost}>← Semua Perusahaan</button>
        <h2 style={{ color: cs.text, margin: 0, flex: 1 }}>📅 PPM Calendar — Jadwal Maintenance Semua Klien</h2>
        <select value={months} onChange={e => setMonths(Number(e.target.value))} style={{ ...inp, width: "auto" }}>
          <option value={1}>1 bulan ke depan</option>
          <option value={2}>2 bulan ke depan</option>
          <option value={3}>3 bulan ke depan</option>
          <option value={6}>6 bulan ke depan</option>
        </select>
        <select value={filterClient} onChange={e => setFilterClient(e.target.value)} style={{ ...inp, width: "auto" }}>
          <option value="">Semua klien</option>
          {clients.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? <div style={{ color: cs.muted, textAlign: "center", padding: 40 }}>Memuat…</div> : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: cs.muted }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <div>Tidak ada unit yang jatuh tempo dalam periode ini</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, evs]) => {
            const [y, m] = month.split("-");
            const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
            const isOverdue = month < today.slice(0, 7);
            const clientGroups = {};
            evs.forEach(e => {
              if (!clientGroups[e.client_name]) clientGroups[e.client_name] = [];
              clientGroups[e.client_name].push(e);
            });
            return (
              <div key={month}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: isOverdue ? cs.red : cs.text }}>{label}</div>
                  {isOverdue && <span style={{ background: cs.red + "22", color: cs.red, padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>OVERDUE</span>}
                  <div style={{ background: cs.accent + "22", color: cs.accent, padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>{evs.length} unit</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
                  {Object.entries(clientGroups).map(([cname, cevs]) => (
                    <div key={cname} style={{ ...card, borderLeft: `3px solid ${isOverdue ? cs.red : cs.accent}` }}>
                      <div style={{ fontWeight: 700, color: cs.text, fontSize: 13, marginBottom: 8 }}>🏢 {cname}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {cevs.map(ev => (
                          <span key={ev.unit_id} title={`${ev.location} — Due: ${ev.next_service_date}`}
                            style={{ background: cs.surface, border: "1px solid " + cs.border, padding: "3px 7px", borderRadius: 6, fontSize: 11, color: cs.text }}>
                            {statusDot(ev.status)} {ev.unit_code}
                          </span>
                        ))}
                      </div>
                      <div style={{ color: cs.muted, fontSize: 11, marginTop: 8 }}>
                        Due: {fmtDate(cevs[0].next_service_date)} · {cevs.length} unit
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────── CONTRACT TAB ───────────
const BILLING_CYCLE_LABELS = { monthly: "Bulanan", quarterly: "Kuartalan", biannual: "6 Bulanan", annual: "Tahunan", per_visit: "Per Kunjungan" };

function ContractTab({ sel, call, showNotif, showConfirm, isOwner, currentUser }) {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [genModal, setGenModal] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const j = await call("list-contracts", { client_id: sel.id }); setContracts(j.contracts || []); }
    catch (e) { showNotif("❌ " + e.message); }
    finally { setLoading(false); }
  }, [call, sel.id, showNotif]);

  useEffect(() => { load(); }, [load]);

  const saveContract = async (form) => {
    setBusy(true);
    try {
      if (form.id) {
        const j = await call("update-contract", { ...form });
        setContracts(p => p.map(c => c.id === j.contract.id ? j.contract : c));
        showNotif("✅ Kontrak diperbarui");
      } else {
        const j = await call("create-contract", { ...form, client_id: sel.id, created_by: currentUser?.name || "admin" });
        setContracts(p => [j.contract, ...p]);
        showNotif("✅ Kontrak dibuat");
      }
      setModal(null);
    } catch (e) { showNotif("❌ " + e.message); }
    finally { setBusy(false); }
  };

  const deleteContract = async (c) => {
    const ok = await showConfirm({ title: "Hapus kontrak?", message: `Hapus kontrak ${c.contract_number}? Tindakan tidak bisa diurungkan.` });
    if (!ok) return;
    try { await call("delete-contract", { id: c.id }); setContracts(p => p.filter(x => x.id !== c.id)); showNotif("✅ Kontrak dihapus"); }
    catch (e) { showNotif("❌ " + e.message); }
  };

  const generateInvoice = async (form) => {
    setBusy(true);
    try {
      const j = await call("generate-contract-invoice", { ...form, client_id: sel.id });
      showNotif("✅ Invoice " + (j.invoice?.id || "") + " berhasil dibuat");
      setGenModal(null);
    } catch (e) { showNotif("❌ " + e.message); }
    finally { setBusy(false); }
  };

  if (loading) return <div style={{ color: cs.muted, padding: 24, textAlign: "center" }}>Memuat…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 14 }}>
        {isOwner && <button onClick={() => setModal({})} style={btn}>+ Tambah Kontrak</button>}
      </div>

      {contracts.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: cs.muted }}>
          <div style={{ fontSize: 36 }}>📝</div>
          <div>Belum ada kontrak. Klik "+ Tambah Kontrak" untuk membuat.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {contracts.map(c => {
            const days = daysUntil(c.end_date);
            const expired = days !== null && days < 0;
            const warn = days !== null && days <= 30 && days >= 0;
            const statusColor = c.status === "active" ? cs.green : c.status === "expired" ? cs.red : cs.muted;
            return (
              <div key={c.id} style={{ ...card, borderLeft: `3px solid ${statusColor}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>{c.contract_number}</span>
                      <span style={{ background: statusColor + "22", color: statusColor, padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                        {c.status === "active" ? "● Aktif" : c.status === "expired" ? "Expired" : c.status}
                      </span>
                      {warn && <span style={{ background: (cs.yellow || "#eab308") + "22", color: cs.yellow || "#eab308", padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>⚠️ {days}h lagi</span>}
                      {expired && <span style={{ background: cs.red + "22", color: cs.red, padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>🔴 EXPIRED</span>}
                    </div>
                    {c.title && <div style={{ color: cs.muted, fontSize: 13, marginBottom: 6 }}>{c.title}</div>}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: "4px 16px", fontSize: 12 }}>
                      <div><span style={{ color: cs.muted }}>Periode: </span><b style={{ color: cs.text }}>{fmtDate(c.start_date)} – {fmtDate(c.end_date)}</b></div>
                      <div><span style={{ color: cs.muted }}>Nilai: </span><b style={{ color: cs.accent }}>{fmtRp(c.value)}</b></div>
                      <div><span style={{ color: cs.muted }}>Siklus: </span><b style={{ color: cs.text }}>{BILLING_CYCLE_LABELS[c.billing_cycle] || c.billing_cycle} · {fmtRp(c.billing_amount)}</b></div>
                      <div><span style={{ color: cs.muted }}>Kunjungan: </span><b style={{ color: cs.text }}>{c.visits_per_year}x/tahun</b></div>
                      <div><span style={{ color: cs.muted }}>Layanan: </span><b style={{ color: cs.text }}>{(c.services_included || []).join(", ")}</b></div>
                    </div>
                    {c.notes && <div style={{ marginTop: 6, fontSize: 12, color: cs.muted, fontStyle: "italic" }}>{c.notes}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => setGenModal({ contract_id: c.id, amount: c.billing_amount, billing_cycle: c.billing_cycle })} style={{ ...miniBtn, color: cs.accent }} title="Generate Invoice">💰 Invoice</button>
                    {isOwner && <button onClick={() => setModal(c)} style={miniBtn} title="Edit">✏️</button>}
                    {isOwner && <button onClick={() => deleteContract(c)} style={{ ...miniBtn, color: cs.red }} title="Hapus">🗑</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal !== null && (
        <ContractModal contract={modal} onClose={() => setModal(null)} onSave={saveContract} busy={busy} clientId={sel.id} />
      )}
      {genModal !== null && (
        <GenInvoiceModal data={genModal} onClose={() => setGenModal(null)} onGenerate={generateInvoice} busy={busy} clientName={sel.name} />
      )}
    </div>
  );
}

function ContractModal({ contract, onClose, onSave, busy, clientId }) {
  const isNew = !contract.id;
  const [form, setForm] = useState({
    contract_number: contract.contract_number || "",
    title: contract.title || "",
    start_date: contract.start_date || new Date().toISOString().slice(0, 10),
    end_date: contract.end_date || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    value: contract.value || "",
    billing_cycle: contract.billing_cycle || "quarterly",
    billing_amount: contract.billing_amount || "",
    visits_per_year: contract.visits_per_year || 4,
    services_included: (contract.services_included || ["cuci_rutin"]).join(", "),
    notes: contract.notes || "",
    status: contract.status || "active",
    auto_invoice: contract.auto_invoice || false,
    ...(contract.id ? { id: contract.id } : {}),
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <Overlay onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <b style={{ color: cs.text }}>{isNew ? "Tambah Kontrak" : "Edit Kontrak"}</b>
        <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field l="No. Kontrak"><input value={form.contract_number} onChange={e => set("contract_number", e.target.value)} style={inp} placeholder="KTR-2026-01" /></Field>
          <Field l="Status">
            <select value={form.status} onChange={e => set("status", e.target.value)} style={inp}>
              {["draft","active","expired","cancelled","renewed"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field l="Judul Kontrak"><input value={form.title} onChange={e => set("title", e.target.value)} style={inp} placeholder="Kontrak Maintenance AC 2026" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field l="Tanggal Mulai"><input type="date" value={form.start_date} onChange={e => set("start_date", e.target.value)} style={inp} /></Field>
          <Field l="Tanggal Selesai"><input type="date" value={form.end_date} onChange={e => set("end_date", e.target.value)} style={inp} /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field l="Nilai Kontrak (Rp)"><input type="number" value={form.value} onChange={e => set("value", e.target.value)} style={inp} placeholder="32520000" /></Field>
          <Field l="Siklus Billing">
            <select value={form.billing_cycle} onChange={e => set("billing_cycle", e.target.value)} style={inp}>
              {Object.entries(BILLING_CYCLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field l="Nominal per Siklus (Rp)"><input type="number" value={form.billing_amount} onChange={e => set("billing_amount", e.target.value)} style={inp} placeholder="8130000" /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field l="Kunjungan per Tahun"><input type="number" min={1} max={52} value={form.visits_per_year} onChange={e => set("visits_per_year", e.target.value)} style={inp} /></Field>
          <Field l="Layanan Tercakup (pisah koma)"><input value={form.services_included} onChange={e => set("services_included", e.target.value)} style={inp} placeholder="cuci_rutin, inspeksi" /></Field>
        </div>
        <Field l="Catatan"><textarea value={form.notes} onChange={e => set("notes", e.target.value)} style={{ ...inp, minHeight: 60 }} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Batal</button>
        <button disabled={busy} onClick={() => onSave({ ...form, value: Number(form.value) || null, billing_amount: Number(form.billing_amount) || null, visits_per_year: Number(form.visits_per_year), services_included: form.services_included.split(",").map(s => s.trim()).filter(Boolean) })}
          style={{ ...btn, flex: 2, opacity: busy ? .5 : 1 }}>
          {busy ? "Menyimpan…" : isNew ? "Buat Kontrak" : "Simpan Perubahan"}
        </button>
      </div>
    </Overlay>
  );
}

function GenInvoiceModal({ data, onClose, onGenerate, busy, clientName }) {
  const today = new Date();
  const monthNames = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const defaultLabel = `Maintenance ${monthNames[today.getMonth()]} ${today.getFullYear()}`;
  const [form, setForm] = useState({
    contract_id: data.contract_id || null,
    amount: data.amount || "",
    period_label: defaultLabel,
    unit_count: "",
    notes: "",
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <Overlay onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <b style={{ color: cs.text }}>💰 Generate Invoice dari Kontrak</b>
        <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
      </div>
      <div style={{ color: cs.muted, fontSize: 12, marginBottom: 12 }}>Klien: <b style={{ color: cs.text }}>{clientName}</b></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field l="Label Periode"><input value={form.period_label} onChange={e => set("period_label", e.target.value)} style={inp} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field l="Jumlah Unit Aktual"><input type="number" value={form.unit_count} onChange={e => set("unit_count", e.target.value)} style={inp} placeholder="28" /></Field>
          <Field l="Nominal Invoice (Rp)"><input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} style={inp} /></Field>
        </div>
        <Field l="Catatan tambahan"><textarea value={form.notes} onChange={e => set("notes", e.target.value)} style={{ ...inp, minHeight: 50 }} placeholder="Opsional — muncul di invoice" /></Field>
        <div style={{ background: cs.surface, borderRadius: 8, padding: 10, fontSize: 12, color: cs.muted }}>
          Invoice akan dibuat dengan status <b style={{ color: cs.text }}>UNPAID</b> dan bisa diedit sebelum dikirim ke klien.
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Batal</button>
        <button disabled={busy || !form.amount} onClick={() => onGenerate(form)} style={{ ...btn, flex: 2, opacity: (busy || !form.amount) ? .5 : 1 }}>
          {busy ? "Membuat…" : "🧾 Buat Invoice"}
        </button>
      </div>
    </Overlay>
  );
}

// ─────────── WORK ORDER TAB ───────────
const WO_TYPE_LABELS = { preventive: "Preventif", corrective: "Korektif", emergency: "Darurat", inspection: "Inspeksi" };
const WO_STATUS_COLOR = { draft: cs.muted, approved: cs.accent, in_progress: cs.yellow || "#eab308", done: cs.green, cancelled: cs.red };

function WorkOrderTab({ sel, units, call, showNotif, showConfirm, isOwner, currentUser }) {
  const [wos, setWos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const j = await call("list-work-orders", { client_id: sel.id }); setWos(j.work_orders || []); }
    catch (e) { showNotif("❌ " + e.message); }
    finally { setLoading(false); }
  }, [call, sel.id, showNotif]);

  useEffect(() => { load(); }, [load]);

  const saveWO = async (form) => {
    setBusy(true);
    try {
      if (form.id) {
        const j = await call("update-work-order", { ...form });
        setWos(p => p.map(w => w.id === j.work_order.id ? j.work_order : w));
        showNotif("✅ Work Order diperbarui");
      } else {
        const j = await call("create-work-order", { ...form, client_id: sel.id, created_by: currentUser?.name || "admin" });
        setWos(p => [j.work_order, ...p]);
        showNotif("✅ Work Order " + j.work_order.wo_number + " dibuat");
      }
      setModal(null);
    } catch (e) { showNotif("❌ " + e.message); }
    finally { setBusy(false); }
  };

  const updateStatus = async (wo, status) => {
    try {
      const j = await call("update-work-order", { id: wo.id, status, ...(status === "approved" ? { approved_by: currentUser?.name || "Owner" } : {}) });
      setWos(p => p.map(w => w.id === j.work_order.id ? j.work_order : w));
      showNotif("✅ Status diperbarui");
    } catch (e) { showNotif("❌ " + e.message); }
  };

  if (loading) return <div style={{ color: cs.muted, padding: 24, textAlign: "center" }}>Memuat…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setModal({})} style={btn}>+ Buat Work Order</button>
      </div>

      {wos.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: cs.muted }}>
          <div style={{ fontSize: 36 }}>🔨</div>
          <div>Belum ada Work Order. Buat WO baru untuk merencanakan kunjungan servis.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {wos.map(wo => {
            const sc = WO_STATUS_COLOR[wo.status] || cs.muted;
            const unitCodes = (wo.unit_ids || []).map(uid => units.find(u => u.id === uid)?.unit_code || uid.slice(0, 6)).join(", ");
            return (
              <div key={wo.id} style={{ ...card, borderLeft: `3px solid ${sc}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: cs.accent, fontSize: 13 }}>{wo.wo_number}</span>
                      <span style={{ background: sc + "22", color: sc, padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                        {wo.status === "draft" ? "Draft" : wo.status === "approved" ? "Disetujui" : wo.status === "in_progress" ? "Berjalan" : wo.status === "done" ? "Selesai" : "Dibatalkan"}
                      </span>
                      <span style={{ background: cs.surface, padding: "2px 8px", borderRadius: 99, fontSize: 11, color: cs.muted }}>
                        {WO_TYPE_LABELS[wo.wo_type] || wo.wo_type}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, color: cs.text, fontSize: 14, marginBottom: 4 }}>{wo.title}</div>
                    {wo.description && <div style={{ color: cs.muted, fontSize: 12, marginBottom: 4 }}>{wo.description}</div>}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: "3px 12px", fontSize: 12 }}>
                      {wo.scheduled_date && <div><span style={{ color: cs.muted }}>Jadwal: </span><b style={{ color: cs.text }}>{fmtDate(wo.scheduled_date)}</b></div>}
                      {wo.assigned_to && <div><span style={{ color: cs.muted }}>Teknisi: </span><b style={{ color: cs.text }}>{wo.assigned_to}</b></div>}
                      {wo.estimated_cost && <div><span style={{ color: cs.muted }}>Estimasi: </span><b style={{ color: cs.text }}>{fmtRp(wo.estimated_cost)}</b></div>}
                      {unitCodes && <div><span style={{ color: cs.muted }}>Unit: </span><span style={{ color: cs.text, fontSize: 11 }}>{unitCodes || "—"}</span></div>}
                    </div>
                    {wo.approved_by && <div style={{ fontSize: 11, color: cs.muted, marginTop: 4 }}>Disetujui oleh: {wo.approved_by} · {fmtDate(wo.approved_at)}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                    {wo.status === "draft" && isOwner && <button onClick={() => updateStatus(wo, "approved")} style={{ ...miniBtn, color: cs.green, fontSize: 11 }}>✅ Approve</button>}
                    {wo.status === "approved" && <button onClick={() => updateStatus(wo, "in_progress")} style={{ ...miniBtn, color: cs.accent, fontSize: 11 }}>▶️ Mulai</button>}
                    {wo.status === "in_progress" && <button onClick={() => updateStatus(wo, "done")} style={{ ...miniBtn, color: cs.green, fontSize: 11 }}>✔️ Selesai</button>}
                    <button onClick={() => setModal(wo)} style={{ ...miniBtn, fontSize: 11 }}>✏️ Edit</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal !== null && (
        <WorkOrderModal wo={modal} units={units} onClose={() => setModal(null)} onSave={saveWO} busy={busy} />
      )}
    </div>
  );
}

function WorkOrderModal({ wo, units, onClose, onSave, busy }) {
  const isNew = !wo.id;
  const [form, setForm] = useState({
    title: wo.title || "",
    description: wo.description || "",
    wo_type: wo.wo_type || "preventive",
    scheduled_date: wo.scheduled_date || "",
    assigned_to: wo.assigned_to || "",
    estimated_cost: wo.estimated_cost || "",
    unit_ids: wo.unit_ids || [],
    notes: wo.notes || "",
    status: wo.status || "draft",
    ...(wo.id ? { id: wo.id } : {}),
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const toggleUnit = (uid) => setForm(p => ({ ...p, unit_ids: p.unit_ids.includes(uid) ? p.unit_ids.filter(x => x !== uid) : [...p.unit_ids, uid] }));

  const activeUnits = units.filter(u => u.status !== "retired");

  return (
    <Overlay onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <b style={{ color: cs.text }}>{isNew ? "Buat Work Order" : "Edit Work Order"}</b>
        <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field l="Judul WO"><input value={form.title} onChange={e => set("title", e.target.value)} style={inp} placeholder="Cuci Rutin Q3 2026" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field l="Tipe WO">
            <select value={form.wo_type} onChange={e => set("wo_type", e.target.value)} style={inp}>
              {Object.entries(WO_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field l="Tanggal Jadwal"><input type="date" value={form.scheduled_date} onChange={e => set("scheduled_date", e.target.value)} style={inp} /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field l="Teknisi Assigned"><input value={form.assigned_to} onChange={e => set("assigned_to", e.target.value)} style={inp} placeholder="Rey" /></Field>
          <Field l="Estimasi Biaya (Rp)"><input type="number" value={form.estimated_cost} onChange={e => set("estimated_cost", e.target.value)} style={inp} /></Field>
        </div>
        <Field l="Deskripsi"><textarea value={form.description} onChange={e => set("description", e.target.value)} style={{ ...inp, minHeight: 50 }} /></Field>
        <div>
          <div style={{ fontSize: 12, color: cs.muted, marginBottom: 6 }}>Unit yang dikerjakan ({form.unit_ids.length} dipilih)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 120, overflowY: "auto" }}>
            {activeUnits.map(u => {
              const sel = form.unit_ids.includes(u.id);
              return (
                <button key={u.id} onClick={() => toggleUnit(u.id)}
                  style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: sel ? 700 : 400, background: sel ? cs.accent + "33" : cs.surface, color: sel ? cs.accent : cs.muted, border: `1px solid ${sel ? cs.accent : cs.border}` }}>
                  {u.unit_code}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={onClose} style={{ ...btnGhost, flex: 1 }}>Batal</button>
        <button disabled={busy || !form.title} onClick={() => onSave({ ...form, estimated_cost: Number(form.estimated_cost) || null })}
          style={{ ...btn, flex: 2, opacity: (busy || !form.title) ? .5 : 1 }}>
          {busy ? "Menyimpan…" : isNew ? "Buat WO" : "Simpan"}
        </button>
      </div>
    </Overlay>
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
