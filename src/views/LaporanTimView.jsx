import { memo, useState, useEffect } from "react";
import { cs } from "../theme/cs.js";
import { normalizePhone } from "../lib/phone.js";
import { resolveMultiDayInvoiceAction, mergeInvoiceDetail, tagDetailSource, recomputeInvoiceTotals } from "../lib/invoiceMultiDay.js";
import { summarize, checkInvoiceConsistency, describeInconsistency, normalizeLines, buildWarrantyDiscountLine, categoryFromCatalog } from "../lib/invoicing.js";
import { clientCleaningUnitPrice } from "../lib/maintClientPrice.js";

// ── Survey Kirim Modal ─────────────────────────────────────────────────────────
function SurveyKirimModal({ r, onClose, sendWA, showNotif, addAgentLog, auditUserName, updateServiceReport, supabase, fotoSrc, downloadServiceReportPDF, invoicesData }) {
  const fmtTgl = (d) => { try { return new Date(d + "T00:00:00+07:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); } catch { return d || "—"; } };
  const team = [r.teknisi, r.helper].filter(Boolean).join(" & ");
  const fotos = (r.fotos || []).filter(f => f.url);
  const fotoNote = fotos.length > 0 ? `\n📸 ${fotos.length} foto dokumentasi tersedia.` : "";

  const defaultMsg =
    `📋 *Laporan Hasil Survey AC*\n` +
    `AClean Service — Profesional Maintenance Company\n\n` +
    `👤 Customer   : ${r.customer}\n` +
    `📅 Tgl Survey : ${fmtTgl(r.date)}\n` +
    `👷 Teknisi    : ${team || r.teknisi || "—"}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n📝 *HASIL SURVEY*\n━━━━━━━━━━━━━━━━━━━━\n` +
    `${r.hasil_survey || "(tidak ada catatan)"}\n\n` +
    (r.catatan_rekomendasi
      ? `━━━━━━━━━━━━━━━━━━━━\n💡 *REKOMENDASI*\n━━━━━━━━━━━━━━━━━━━━\n${r.catatan_rekomendasi}\n\n`
      : "") +
    `${fotoNote}Untuk penawaran / tindak lanjut, silakan balas pesan ini.\n— AClean Service`;

  const [msg, setMsg] = useState(defaultMsg);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const phone = r.phone || "";

  const doSend = async () => {
    if (!phone) { showNotif("⚠️ Nomor HP customer tidak tersedia"); return; }
    setSending(true);
    try {
      const ok = await sendWA(phone, msg);
      if (ok !== false) {
        await updateServiceReport(supabase, r.id, { survey_sent_at: new Date().toISOString() }, auditUserName());
        addAgentLog("SURVEY_SENT", `Hasil survey dikirim ke ${r.customer} (${phone})`, "SUCCESS");
        showNotif(`✅ Hasil survey terkirim ke ${r.customer}`);
        setSent(true);
        setTimeout(onClose, 1500);
      } else {
        showNotif("📱 WA dibuka manual di browser");
        setSent(true);
        setTimeout(onClose, 1000);
      }
    } catch (e) { showNotif("❌ Gagal kirim: " + e.message); }
    finally { setSending(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 580, maxHeight: "92vh", overflowY: "auto", padding: 24 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>📤 Kirim Hasil Survey</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{r.job_id} — {r.customer}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* Preview card — tampilan profesional */}
        <div style={{ background: "linear-gradient(135deg,#0369a1,#0c4a6e)", borderRadius: 14, padding: "18px 20px", marginBottom: 16, color: "#fff" }}>
          <div style={{ fontWeight: 800, fontSize: 13, opacity: .85, marginBottom: 4 }}>AClean Service — Profesional Maintenance Company</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 2 }}>📋 Laporan Hasil Survey</div>
          <div style={{ fontSize: 12, opacity: .8, marginBottom: 14 }}>{fmtTgl(r.date)} · {team || r.teknisi}</div>
          <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "12px 14px", marginBottom: r.catatan_rekomendasi ? 10 : 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, opacity: .7, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Hasil Survey</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{r.hasil_survey || "(belum diisi)"}</div>
          </div>
          {r.catatan_rekomendasi && (
            <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "12px 14px", marginBottom: fotos.length > 0 ? 10 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 800, opacity: .7, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>💡 Rekomendasi</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{r.catatan_rekomendasi}</div>
            </div>
          )}
          {/* Foto dokumentasi */}
          {fotos.length > 0 && (
            <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, fontWeight: 800, opacity: .7, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>📸 Foto Dokumentasi ({fotos.length})</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                {fotos.slice(0, 6).map((f, fi) => (
                  <div key={fi} style={{ position: "relative", cursor: "pointer" }} onClick={() => window.open(fotoSrc(f.url), "_blank")}>
                    <img src={fotoSrc(f.url)} alt={f.label || "foto " + (fi + 1)}
                      style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", borderRadius: 8, border: "2px solid rgba(255,255,255,.2)" }} />
                    {f.label && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,.55)", fontSize: 9, color: "#fff", padding: "2px 4px", borderRadius: "0 0 6px 6px", textAlign: "center" }}>{f.label}</div>}
                  </div>
                ))}
              </div>
              {fotos.length > 6 && <div style={{ fontSize: 10, opacity: .6, marginTop: 6, textAlign: "center" }}>+{fotos.length - 6} foto lainnya di Report Card PDF</div>}
            </div>
          )}
          {r.survey_sent_at && (
            <div style={{ fontSize: 10, color: "rgba(255,255,255,.55)", marginTop: 10 }}>
              ✅ Terakhir dikirim: {new Date(r.survey_sent_at).toLocaleString("id-ID")}
            </div>
          )}
        </div>

        {/* PDF Download */}
        {downloadServiceReportPDF && (
          <button onClick={() => { const relInv = (invoicesData || []).find(i => i.job_id === r.job_id) || {}; downloadServiceReportPDF(r, relInv); }}
            style={{ width: "100%", background: "#1e3a5f", border: "none", color: "#93c5fd", padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12, marginBottom: 12 }}>
            📋 Download PDF Survey Report
          </button>
        )}

        {/* Pesan WA yang bisa diedit */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>
            📱 Pesan WA ke Customer
            {phone ? <span style={{ color: cs.green, marginLeft: 6 }}>+{phone}</span> : <span style={{ color: cs.red, marginLeft: 6 }}>⚠️ Nomor HP tidak tersedia</span>}
          </div>
          <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={10}
            style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 12px", color: cs.text, fontSize: 12, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "monospace", lineHeight: 1.5 }} />
          <div style={{ fontSize: 10, color: cs.muted, marginTop: 4 }}>Pesan bisa diedit sebelum dikirim. Foto dikirim terpisah via PDF.</div>
        </div>

        {/* Buttons */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
          <button onClick={onClose} style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Batal</button>
          <button onClick={doSend} disabled={sending || sent || !phone}
            style={{ background: sent ? cs.green : (phone ? "linear-gradient(135deg,#16a34a,#15803d)" : cs.surface), border: "none", color: sent ? "#fff" : (phone ? "#fff" : cs.muted), padding: "11px", borderRadius: 10, cursor: (sending || !phone) ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13, opacity: (sending || !phone) ? .6 : 1 }}>
            {sent ? "✅ Terkirim!" : sending ? "⏳ Mengirim..." : `📤 Kirim ke ${r.customer}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function LaporanTimView({ laporanReports, setLaporanReports, ordersData, setOrdersData, invoicesData, setInvoicesData, priceListData, currentUser, isMobile, laporanDateFilter, setLaporanDateFilter, laporanDateFrom, setLaporanDateFrom, laporanDateTo, setLaporanDateTo, laporanSvcFilter, setLaporanSvcFilter, laporanStatusFilter, setLaporanStatusFilter, laporanTeamFilter, setLaporanTeamFilter, searchLaporan, setSearchLaporan, searchLoading, laporanPage, setLaporanPage, userAccounts, setSelectedLaporan, setEditLaporanMode, setModalLaporanDetail, setEditLaporanForm, setLaporanBarangItems, setEditRepairType, setEditGratisAlasan, setActiveEditUnitIdx, setEditPhotoMode, setEditLaporanFotos, setEditStockMats, setLaporanInstallItems, setActiveMenu, safeArr, fotoSrc, showConfirm, showNotif, addAgentLog, auditUserName, getLocalDate, fmt, updateServiceReport, deleteServiceReport, insertInvoice, deleteInvoice, updateOrder, updateOrderStatus, markInvoicePaid, lookupHargaGlobal, hargaPerUnitFromTipe, getBracketKey, hitungLabor, sendWA, supabase, LAP_PAGE_SIZE, INSTALL_ITEMS, downloadServiceReportPDF, setInvTxData, setInventoryData, updateCustomerTierAfterOrder, customersData, setCustomersData, apiFetch }) {
const _todayLap = getLocalDate?.() || new Date().toISOString().slice(0, 10);
const [lapViewMode, setLapViewMode] = useState("detail"); // "rekap" | "detail" — default detail
const [rekapDate, setRekapDate]     = useState(_todayLap);
const [surveyKirimModal, setSurveyKirimModal] = useState(null);

// Terima event dari LaporanDetailModal yang minta buka SurveyKirimModal
useEffect(() => {
  const handler = (e) => setSurveyKirimModal(e.detail);
  window.addEventListener("open-survey-kirim", handler);
  return () => window.removeEventListener("open-survey-kirim", handler);
}, []);

// Realtime/WAL dimatikan (hemat compute Supabase). Data laporan di-refresh terpusat oleh
// App.jsx (polling service_reports tiap 90 dtk, jam kerja + tab aktif) — parsed + dedup by job_id.
const [liveActive] = useState(true);

// ── Harga deal per-klien maintenance (price book) — override biaya cleaning ──
// per unit di builder verify & badge estimasi. Match STRICT tipe+PK (lihat
// lib/maintClientPrice.js); tanpa baris cocok → harga global (perilaku lama).
// Cache per client_id; undefined = belum di-fetch, [] = sudah (termasuk gagal).
const [maintPricesByClient, setMaintPricesByClient] = useState({});
const fetchMaintPrices = async (clientId) => {
  try {
    const resp = await apiFetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list-prices", client_id: clientId }) });
    const j = resp.ok ? await resp.json().catch(() => ({})) : {};
    return Array.isArray(j.prices) ? j.prices : [];
  } catch { return []; }
};
// Prefetch untuk badge ≈ Invoice (dihitung sinkron saat render kartu)
useEffect(() => {
  if (!apiFetch) return;
  const ids = [...new Set((ordersData || []).map(o => o?.maintenance_client_id).filter(Boolean))]
    .filter(id => maintPricesByClient[id] === undefined);
  if (!ids.length) return;
  let alive = true;
  (async () => {
    const entries = await Promise.all(ids.map(async (id) => [id, await fetchMaintPrices(id)]));
    if (alive) setMaintPricesByClient(prev => ({ ...prev, ...Object.fromEntries(entries) }));
  })();
  return () => { alive = false; };
  // maintPricesByClient sengaja di luar deps — guard `undefined` di atas mencegah refetch loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [ordersData, apiFetch]);
// Jaminan saat verify (kalau prefetch belum selesai / client baru muncul)
const ensureMaintPrices = async (clientId) => {
  if (!clientId || !apiFetch) return null;
  if (maintPricesByClient[clientId] !== undefined) return maintPricesByClient[clientId];
  const prices = await fetchMaintPrices(clientId);
  setMaintPricesByClient(prev => ({ ...prev, [clientId]: prices }));
  return prices;
};

// Toggle tampilan — dipakai di mode rekap & detail
const _viewToggle = (
  <div style={{ display: "flex", gap: 6, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 12, padding: 4, width: "fit-content" }}>
    {[["detail", "📋 Detail Laporan"], ["rekap", "📊 Rekap Harian"]].map(([m, lbl]) => (
      <button key={m} onClick={() => setLapViewMode(m)}
        style={{ padding: "7px 15px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
          background: lapViewMode === m ? cs.accent : "transparent",
          color: lapViewMode === m ? "#fff" : cs.muted }}>
        {lbl}
      </button>
    ))}
  </div>
);

// ─── REKAP HARIAN: ringkasan per hari (customer, telp, laporan/invoice/approved checklist) ───
if (lapViewMode === "rekap") {
  const orderDatesR = [...new Set(ordersData.map(o => o.date).filter(Boolean))].sort();
  const navR = (cur, dir) => {
    if (dir === -1) { const p = orderDatesR.filter(d => d < cur); return p.length ? p[p.length - 1] : cur; }
    const n = orderDatesR.filter(d => d > cur); return n.length ? n[0] : cur;
  };
  const hasPrevR = orderDatesR.some(d => d < rekapDate);
  const hasNextR = orderDatesR.some(d => d > rekapDate);
  const rekapOrders = ordersData.filter(o => o.date === rekapDate)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  const lapByJob = {}; laporanReports.forEach(r => { if (r.job_id) lapByJob[r.job_id] = r; });
  const invByJob = {}; invoicesData.forEach(i => { if (i.job_id) invByJob[i.job_id] = i; });
  const isApproved = (inv) => !!inv && !["DRAFT", "PENDING_APPROVAL"].includes((inv.status || "").toUpperCase());

  const dateLabel = new Date(rekapDate + "T00:00:00+07:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const isToday   = rekapDate === _todayLap;
  const cLaporan  = rekapOrders.filter(o => lapByJob[o.id]).length;
  const cInvoice  = rekapOrders.filter(o => invByJob[o.id]).length;
  const cApproved = rekapOrders.filter(o => isApproved(invByJob[o.id])).length;

  const chk = (ok) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 20,
      color: ok ? cs.green : cs.muted, background: (ok ? cs.green : cs.muted) + "18", border: "1px solid " + (ok ? cs.green : cs.muted) + "40" }}>
      {ok ? "✓ Ya" : "✕ Belum"}
    </span>
  );
  const navBtn = (enabled) => ({ background: cs.surface, border: "1px solid " + cs.border, color: enabled ? cs.text : cs.border, padding: "8px 13px", borderRadius: 9, cursor: enabled ? "pointer" : "default", fontSize: 13, fontWeight: 700, opacity: enabled ? 1 : 0.35 });
  const hdr = { fontSize: 10, fontWeight: 700, color: cs.muted, textTransform: "uppercase", letterSpacing: "0.5px" };
  const COLS = "2.2fr 1.3fr 1fr 1fr 1fr";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, color: cs.text }}>📋 Rekap Laporan Tim Harian</div>
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Ringkasan status per hari — geser tanggal untuk cek hari lain</div>
        </div>
        {_viewToggle}
      </div>

      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
        {/* Navigasi tanggal */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid " + cs.border, flexWrap: "wrap" }}>
          <button onClick={() => hasPrevR && setRekapDate(navR(rekapDate, -1))} style={navBtn(hasPrevR)}>◀</button>
          <div style={{ flex: 1, textAlign: "center", minWidth: 180 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>
              📋 {dateLabel}
              {isToday && <span style={{ marginLeft: 8, fontSize: 10, background: cs.accent + "22", color: cs.accent, border: "1px solid " + cs.accent + "44", borderRadius: 99, padding: "2px 8px", fontWeight: 700 }}>Hari Ini</span>}
            </div>
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 3 }}>
              {rekapOrders.length} job · {cLaporan} laporan masuk · {cInvoice} invoice
            </div>
          </div>
          {!isToday && orderDatesR.includes(_todayLap) && (
            <button onClick={() => setRekapDate(_todayLap)} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "8px 13px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Hari Ini</button>
          )}
          <button onClick={() => hasNextR && setRekapDate(navR(rekapDate, 1))} style={navBtn(hasNextR)}>▶</button>
        </div>

        {/* Ringkasan */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderBottom: "1px solid " + cs.border }}>
          {[
            { v: rekapOrders.length, l: "Total Job",      c: cs.accent },
            { v: cLaporan,           l: "Laporan Masuk",   c: cs.green },
            { v: cInvoice,           l: "Invoice Dibuat",  c: cs.yellow },
            { v: cApproved,          l: "Sudah Approved",  c: cs.green },
          ].map((s, i) => (
            <div key={s.l} style={{ padding: "12px 14px", borderRight: i < 3 ? "1px solid " + cs.border : "none" }}>
              <div style={{ fontWeight: 800, fontSize: 22, color: s.c }}>{s.v}</div>
              <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Header tabel */}
        <div style={{ display: "grid", gridTemplateColumns: COLS, background: cs.surface, borderBottom: "1px solid " + cs.border, padding: "11px 16px" }}>
          <div style={hdr}>Customer</div>
          <div style={hdr}>No. Telp</div>
          <div style={{ ...hdr, textAlign: "center" }}>Laporan</div>
          <div style={{ ...hdr, textAlign: "center" }}>Invoice Dibuat</div>
          <div style={{ ...hdr, textAlign: "center" }}>Approved</div>
        </div>

        {/* Baris */}
        {rekapOrders.length === 0 ? (
          <div style={{ padding: "44px 0", textAlign: "center", color: cs.muted, fontSize: 13 }}>Tidak ada job pada tanggal ini</div>
        ) : rekapOrders.map(o => {
          const lap = lapByJob[o.id]; const inv = invByJob[o.id];
          return (
            <div key={o.id} style={{ display: "grid", gridTemplateColumns: COLS, padding: "14px 16px", borderBottom: "1px solid " + cs.border + "88", alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>{o.customer}</div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 3 }}>
                  {o.service} · {o.units || 1} unit · {o.time || "—"}{o.teknisi ? " · " + o.teknisi : ""}{o.helper ? " + " + o.helper : ""}
                </div>
              </div>
              <div style={{ fontSize: 13, color: cs.text, fontFamily: "ui-monospace, monospace" }}>{normalizePhone(o.phone || "") || "—"}</div>
              <div style={{ textAlign: "center" }}>{chk(!!lap)}</div>
              <div style={{ textAlign: "center" }}>{chk(!!inv)}</div>
              <div style={{ textAlign: "center" }}>{chk(isApproved(inv))}</div>
            </div>
          );
        })}

        {/* Footer */}
        <div style={{ display: "flex", gap: 20, padding: "14px 16px", background: cs.surface, fontSize: 13, color: cs.muted, flexWrap: "wrap" }}>
          <div>Total: <b style={{ color: cs.text }}>{rekapOrders.length}</b> job</div>
          <div>Laporan: <b style={{ color: cs.green }}>{cLaporan}</b></div>
          <div>Invoice: <b style={{ color: cs.yellow }}>{cInvoice}</b></div>
          <div>Approved: <b style={{ color: cs.green }}>{cApproved}</b></div>
        </div>
      </div>
    </div>
  );
}

const sMap = { SUBMITTED: [cs.accent, "Submitted"], VERIFIED: [cs.green, "Terverifikasi"], REVISION: [cs.yellow, "Perlu Revisi"], REJECTED: [cs.red, "Ditolak"] };
const badge = (s) => {
  // Case insensitive status lookup
  const statusKey = (s || "").toUpperCase();
  const [col, lbl] = sMap[statusKey] || [cs.muted, s];
  return <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: col + "22", color: col, fontWeight: 700 }}>{lbl}</span>;
};
const statusOrder = { SUBMITTED: 0, REVISION: 1, VERIFIED: 2, REJECTED: 3 };
// Fix sort to handle case-insensitive status
const getStatusOrder = (status) => statusOrder[(status || "").toUpperCase()] || 9;
// techColors — warna per teknisi (konsisten dengan kalender & dashboard)
const techColors = Object.fromEntries(
  [...new Set(ordersData.map(o => o.teknisi).filter(Boolean))].map((n, i) => [
    n, ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"][i % 8]
  ])
);
// ── SIM-8: date + service + status filters + pagination ──
const todayLap = getLocalDate();
const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
let filtered = [...laporanReports];

const isDefaultView = laporanDateFilter === "Semua" && !laporanDateFrom && !laporanDateTo && !searchLaporan.trim();

// ── AUTO-HIDE VERIFIED untuk Teknisi & Helper (hide laporan yang sudah selesai) ──
const userRole = currentUser?.role?.toLowerCase() || "";
const isTeknisiOrHelper = userRole === "teknisi" || userRole === "helper";

// Debug: log all status values
if (isTeknisiOrHelper && filtered.length > 0) {
  const statusCounts = {};
  filtered.forEach(r => {
    const s = r.status || "unknown";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });
}

if (isTeknisiOrHelper) {
  const beforeCount = filtered.length;
  // Filter out VERIFIED — case insensitive
  filtered = filtered.filter(r => {
    const status = (r.status || "").toUpperCase();
    return status !== "VERIFIED";
  });
}

if (laporanDateFilter === "Hari Ini") filtered = filtered.filter(r => (r.date || r.submitted_at || "").slice(0, 10) === todayLap);
else if (laporanDateFilter === "Minggu Ini") filtered = filtered.filter(r => (r.date || r.submitted_at || "") >= weekAgo);
else if (laporanDateFilter === "Bulan Ini") filtered = filtered.filter(r => (r.date || r.submitted_at || "") >= monthAgo);
else if (laporanDateFilter === "Range" && (laporanDateFrom || laporanDateTo)) {
  // Convert dd/mm/yyyy → yyyy-mm-dd untuk perbandingan
  const parseDate = (s) => {
    if (!s) return "";
    const parts = s.split("/");
    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    return s; // already yyyy-mm-dd
  };
  const fromStr = parseDate(laporanDateFrom);
  const toStr = parseDate(laporanDateTo);
  filtered = filtered.filter(r => {
    const d = (r.date || r.submitted_at || "").slice(0, 10);
    if (fromStr && toStr) return d >= fromStr && d <= toStr;
    if (fromStr) return d >= fromStr;
    if (toStr) return d <= toStr;
    return true;
  });
}
if (laporanSvcFilter !== "Semua") filtered = filtered.filter(r => (r.service || "") === laporanSvcFilter);
if (laporanStatusFilter === "BELUM_VERIFIED") filtered = filtered.filter(r => ["SUBMITTED","REVISION"].includes((r.status || "").toUpperCase()));
else if (laporanStatusFilter !== "Semua") filtered = filtered.filter(r => (r.status || "").toUpperCase() === laporanStatusFilter.toUpperCase());
if (laporanTeamFilter !== "Semua") filtered = filtered.filter(r => r.teknisi === laporanTeamFilter || r.helper === laporanTeamFilter);
if (searchLaporan.trim()) {
  const q = searchLaporan.trim().toLowerCase();
  filtered = filtered.filter(r =>
    (r.customer || "").toLowerCase().includes(q) ||
    (r.teknisi || "").toLowerCase().includes(q) ||
    (r.job_id || r.id || "").toLowerCase().includes(q) ||
    (r.helper || "").toLowerCase().includes(q) ||
    (r.service || "").toLowerCase().includes(q) ||
    (r.catatan_global || r.catatan || "").toLowerCase().includes(q) ||
    (r.rekomendasi || "").toLowerCase().includes(q)
  );
}
filtered.sort((a, b) => { const dA = a.submitted_at || a.date || "", dB = b.submitted_at || b.date || ""; if (dB !== dA) return dB.localeCompare(dA); return getStatusOrder(a.status) - getStatusOrder(b.status); });
const totPgL = Math.ceil(filtered.length / LAP_PAGE_SIZE) || 1;
const curPgL = Math.min(laporanPage, totPgL);
const pageLap = filtered.slice((curPgL - 1) * LAP_PAGE_SIZE, curPgL * LAP_PAGE_SIZE);

// Pembangun detail invoice dari laporan (jalur VERIFY) — SATU sumber untuk approve (verifyLaporan)
// DAN badge estimasi total di kartu laporan (hindari drift). Murni: hanya komputasi, tanpa efek samping.
// Return: { vMDetail, labor, material, total, status, waiver }. (Diskon membership tetap di approve.)
// dealPricesOverride: hasil ensureMaintPrices (jalur verify, dijamin ter-fetch).
// Tanpa override → pakai cache prefetch (jalur badge; bisa undefined saat load awal).
const buildVerifyInvoice = (r, ord, dealPricesOverride) => {
    const dealPrices = dealPricesOverride !== undefined
      ? dealPricesOverride
      : (ord?.maintenance_client_id ? maintPricesByClient[ord.maintenance_client_id] : null);
    const _rawMats = (() => {
      if (r.materials_json) {
        try { return JSON.parse(r.materials_json); } catch { /* materials_json rusak → pakai default */ }
      }
      return safeArr(r.materials);
    })();
    const vMats = _rawMats.filter(m => m.nama && parseFloat(m.jumlah || 0) > 0);
    const vMDetail = vMats.map(m => {
      const nama2 = (m.nama || "").toLowerCase();
      const isF = ["freon", "r-22", "r-32", "r-410", "r22", "r32", "r410"].some(k => nama2.includes(k));
      const rawQ = parseFloat(m.jumlah) || 0;
      const qty = isF ? Math.max(1, Math.ceil(rawQ)) : rawQ;
      let hSat = parseFloat(m.harga_satuan) || 0;
      if (!hSat) hSat = lookupHargaGlobal(m.nama, m.satuan);
      // Deteksi keterangan dari nama jika tidak ada — item cleaning/jasa tanpa tag tetap masuk jasa
      let ket = m.keterangan || "";
      if (!ket) {
        if (isF) ket = "freon";
        else if (["repair", "perbaikan", "kapasitor", "kompresor", "sparepart", "pcb"].some(k => nama2.includes(k))) ket = "repair";
        else if (["cleaning", "maintenance", "cuci", "jasa", "service", "servis", "pemasangan", "bongkar", "instalasi", "vacum", "kuras"].some(k => nama2.includes(k))) ket = "jasa";
      }
      return { nama: m.nama, jumlah: qty, satuan: m.satuan || "pcs", harga_satuan: hSat, subtotal: hSat * qty, keterangan: ket, category: categoryFromCatalog(m.nama, priceListData) };
    });

    const isRepairSvcV = r.service === "Repair";
    const isCleaningMaintV = r.service === "Cleaning" || r.service === "Maintenance";
    const card34Empty = !vMDetail.some(m => m.keterangan === "jasa" || m.keterangan === "repair");
    // Biaya cleaning per-unit sudah ada? Cek HANYA baris jasa ber-nama cleaning/maintenance/cuci
    // (paritas dgn submit path laporanInvoice.js). Baris jasa lain (mis. "Jasa Pengisian Freon",
    // tambahan freon yang ter-tag jasa) TIDAK boleh membatalkan injeksi biaya cleaning.
    const alreadyHasCleaningRowV = vMDetail.some(m => {
      if (m.keterangan !== "jasa") return false;
      const n = (m.nama || "").toLowerCase();
      return n.includes("cleaning") || n.includes("maintenance") || n.includes("cuci");
    });

    if (isRepairSvcV) {
      // Repair: inject Biaya Pengecekan hanya jika card 3/4 kosong (tidak ada jasa maupun repair item)
      if (card34Empty) {
        const biayaCekItem = priceListData.find(p => p.service === "Repair" && p.type === "Biaya Pengecekan AC");
        const biayaCek = (biayaCekItem && biayaCekItem.price > 0) ? biayaCekItem.price : 100000;
        const cekQty = Math.max(1, (Array.isArray(r.units) ? r.units.length : Number(r.units)) || Number(ord?.units) || 1); // biaya pengecekan PER UNIT
        vMDetail.unshift({ nama: "Biaya Pengecekan AC", jumlah: cekQty, satuan: "unit", harga_satuan: biayaCek, subtotal: biayaCek * cekQty, keterangan: "jasa" });
      }
      // jika ada isi di card 3/4 → hitung apa adanya, tidak inject apapun
    } else if (isCleaningMaintV && !alreadyHasCleaningRowV) {
      // Cleaning/Maintenance: inject per unit dari card 1/4 tipe PK
      const rUnits = Array.isArray(r.units) ? r.units : [];
      const unitsWithTipe = rUnits.filter(u => u && u.tipe);
      if (unitsWithTipe.length > 0) {
        unitsWithTipe.forEach((u) => {
          // Harga deal per-klien maintenance menang bila match STRICT tipe+PK
          const dealPrice = dealPrices ? clientCleaningUnitPrice(dealPrices, u) : null;
          const hargaUnit = dealPrice != null ? dealPrice : hargaPerUnitFromTipe(r.service, u.tipe, priceListData);
          if (hargaUnit > 0) {
            const unitLabel = u.label || u.merk || ("Unit " + (u.unit_no || "?"));
            const bracketLabel = getBracketKey(r.service, u.tipe) || u.tipe;
            vMDetail.unshift({
              nama: (r.service || "") + " " + bracketLabel + " (" + unitLabel + ")" + (dealPrice != null ? " — harga kontrak" : ""),
              jumlah: 1, satuan: "unit",
              harga_satuan: hargaUnit, subtotal: hargaUnit, keterangan: "jasa"
            });
          }
        });
      } else {
        const svcFeeV = hitungLabor(r.service, ord?.type, (Array.isArray(r.units) ? r.units.length : r.units) || ord?.units || 1);
        if (svcFeeV > 0) {
          const uCount = Math.max(1, (Array.isArray(r.units) ? r.units.length : parseInt(r.units)) || parseInt(ord?.units) || 1);
          vMDetail.unshift({ nama: (r.service || "") + (ord?.type ? " - " + ord.type : "") + " (Servis)", jumlah: uCount, satuan: "unit", harga_satuan: Math.round(svcFeeV / uCount), subtotal: svcFeeV, keterangan: "jasa" });
        }
      }
    }

    // Inject transport fee untuk Cleaning 1 unit (sama seperti logic di App.jsx)
    // Guard: jangan inject kalau materials laporan sudah berisi item transport → cegah double tagih.
    const sudahAdaTransport = vMDetail.some(m => (m.nama || "").toLowerCase().includes("transport"));
    if (r.service === "Cleaning" && (Array.isArray(r.units) ? r.units.length : parseInt(r.units) || 1) === 1 && !sudahAdaTransport) {
      const transportItem = priceListData.find(p => p.service === "Cleaning" && p.type === "Biaya Transport Bila 1 Unit" && p.is_active !== false);
      if (transportItem && transportItem.price > 0) {
        vMDetail.push({ nama: "Biaya Transport Bila 1 Unit", jumlah: 1, satuan: "unit", harga_satuan: transportItem.price, subtotal: transportItem.price, keterangan: "jasa" });
      }
    }

    // Ringkasan diturunkan dari vMDetail (single source of truth via lib/invoicing).
    // CATATAN: matV kini TERMASUK freon — dulu freon dikecualikan dari matV & total
    // sehingga baris freon tampil di invoice tapi tidak ikut ditagih.
    const _sumV = summarize(vMDetail);

    const todayInv2 = new Date().toISOString().slice(0, 10);
    const isComplainSvc2 = r.service === "Complain";
    const prevGaransiActive2 = isComplainSvc2
      ? invoicesData.filter(inv =>
        (inv.customer || "").trim() === (r.customer || "").trim() && inv.service !== "Complain" &&
        inv.garansi_expires && inv.garansi_expires >= todayInv2 &&
        ["PAID", "UNPAID", "APPROVED", "PENDING_APPROVAL"].includes(inv.status)
      ).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null
      : null;

    // ── Penyesuaian khusus Complain DIMODELKAN SEBAGAI LINE ITEM (P3), bukan override ──
    let finalStatus2 = "PENDING_APPROVAL";
    if (isComplainSvc2 && prevGaransiActive2 && _sumV.labor > 0) {
      // Jasa ditanggung garansi → baris DISKON negatif (transparan di invoice, total konsisten)
      vMDetail.push(buildWarrantyDiscountLine(_sumV.labor, prevGaransiActive2.id));
    } else if (isComplainSvc2 && _sumV.lineTotal === 0) {
      const BIAYA_CEK2 = (() => {
        const pl = priceListData.find(r2 => r2.service === "Repair" && r2.type === "Biaya Pengecekan AC");
        return (pl && pl.price > 0) ? pl.price : 100000;
      })();
      vMDetail.push({ nama: "Biaya Pengecekan AC", jumlah: 1, satuan: "unit", harga_satuan: BIAYA_CEK2, subtotal: BIAYA_CEK2, keterangan: "jasa" });
    }

    // ── Ringkasan FINAL = turunan vMDetail (termasuk baris diskon/biaya-cek di atas) ──
    const _finalSum = summarize(vMDetail);
    const finalLabor2 = _finalSum.labor;
    const finalMat2 = _finalSum.material;
    const totalInv = _finalSum.total;
    const waiverV = 0; // waiver sudah jadi baris diskon → tidak perlu lagi
    if (totalInv === 0) finalStatus2 = "PAID";
    return { vMDetail, labor: finalLabor2, material: finalMat2, total: totalInv, status: finalStatus2, waiver: waiverV };
};

const verifyLaporan = async (r) => {
  if (currentUser?.role !== "Owner" && currentUser?.role !== "Admin") {
    showNotif("❌ Hanya Owner/Admin yang bisa verifikasi laporan");
    return;
  }
  // Harga deal per-klien maintenance — dijamin ter-fetch SEBELUM invoice dibangun
  // (prefetch badge bisa belum selesai kalau admin verify cepat).
  const _ordDeal = ordersData.find(o => o.id === r.job_id);
  const dealPricesV = _ordDeal?.maintenance_client_id ? await ensureMaintPrices(_ordDeal.maintenance_client_id) : null;

  const { error: vErr } = await updateServiceReport(supabase, r.id, { status: "VERIFIED" }, auditUserName());
  if (vErr) {
    console.warn("❌ verify laporan failed:", vErr.message);
    const { error: retryErr } = await supabase.from("service_reports").update({ status: "VERIFIED" }).eq("id", r.id);
    if (retryErr) {
      console.warn("retry also failed:", retryErr.message);
      showNotif("❌ Gagal verifikasi laporan: " + retryErr.message.slice(0, 60));
      return;
    }
  }
  setLaporanReports(p => p.map(x => x.id === r.id ? { ...x, status: "VERIFIED" } : x));
  addAgentLog("LAPORAN_VERIFIED", `Laporan ${r.job_id} (${r.customer}) diverifikasi`, "SUCCESS");

  // Maintenance korporat (Opsi B): jika order ini ditautkan ke klien maintenance,
  // auto-create log servis per unit (idempotent di backend). Non-blocking.
  if (apiFetch && r.job_id) {
    (async () => {
      try {
        const resp = await apiFetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "autolog-from-order", order_id: r.job_id, created_by: auditUserName() }) });
        const jj = await resp.json().catch(() => ({}));
        if (resp.ok && jj.created > 0) {
          showNotif(`🏢 ${jj.created} unit maintenance tercatat ke history`);
          addAgentLog("MAINTENANCE_AUTOLOG", `${jj.created} log dibuat dari order ${r.job_id}`, "SUCCESS");
        } else if (resp.ok && jj.needs_unit_selection) {
          // Order maintenance tapi unit belum ditentukan di mana pun → history TIDAK terisi.
          // Beri alert merah ke admin supaya link tidak diam-diam putus.
          showNotif(`⚠️ Laporan ${r.job_id} = customer maintenance tapi unitnya belum dipilih — history unit TIDAK tercatat. Pilih AC di order (atau teknisi pilih via "Tambah dari Daftar Maintenance"), lalu verifikasi ulang. Cek Monitoring → Link Maintenance.`);
          addAgentLog("MAINTENANCE_AUTOLOG_SKIP", `Order ${r.job_id} maintenance tapi unit belum dipilih — 0 log`, "WARNING");
        }
      } catch (_) { /* non-blocking — verifikasi tetap sukses */ }
    })();
  }

  // ── Anti-duplikat invoice (defense-in-depth) ──
  // Cegah laporan melahirkan invoice ke-2 saat: (a) order SUDAH tertaut invoice aktif
  // (invoice gabungan manual job_id=null, atau edit ulang laporan ber-invoice), atau
  // (b) order hari ke-2+ (day_number>1) yang TIDAK ter-flag is_multi_day (data cacat →
  // guard multi-hari di bawah tak jalan). Order multi-hari yang ter-flag benar dibiarkan
  // ke resolver multi-hari di bawah (yang handle SKIP/CREATE/CREATE_SEPARATE).
  {
    const _ordDup = ordersData.find(o => o.id === r.job_id);
    const _linkedDup = _ordDup?.invoice_id
      ? invoicesData.find(i => i.id === _ordDup.invoice_id && String(i.status || "").toUpperCase() !== "CANCELLED")
      : null;
    const _orphanMD = _ordDup?.is_multi_day !== true && Number(_ordDup?.day_number) > 1;
    if (r.service !== "Survey" && (_linkedDup || _orphanMD)) {
      const _tgt = _linkedDup?.id || _ordDup?.invoice_id || null;
      // H-2 fix: cek hasil updateOrder
      const { error: _dupOrdE } = await updateOrder(supabase, r.job_id, { status: "COMPLETED", ...(_tgt ? { invoice_id: _tgt } : {}) }, auditUserName());
      if (_dupOrdE) {
        addAgentLog("ORDER_STATUS_ERROR", `Gagal update order ${r.job_id} ke COMPLETED (dup guard): ${_dupOrdE.message}`, "ERROR");
        showNotif(`⚠️ Laporan verified tapi status order gagal diperbarui — refresh & cek manual.`);
      } else {
        setOrdersData(prev => prev.map(o => o.id === r.job_id ? { ...o, status: "COMPLETED", ...(_tgt ? { invoice_id: _tgt } : {}) } : o));
        if (updateCustomerTierAfterOrder && _ordDup) updateCustomerTierAfterOrder(_ordDup).catch(() => {});
      }
      addAgentLog("INVOICE_DUP_GUARD",
        `Verify laporan ${r.job_id} (hari ke-${_ordDup?.day_number || "?"}) — ${_linkedDup ? "sudah tertaut invoice " + _linkedDup.id : "day_number>1 tanpa flag multi-hari"}, TIDAK buat invoice baru`, "INFO");
      // M-2 fix: tawarkan merge prompt untuk path _linkedDup (sudah ada invoice tertaut)
      if (_linkedDup) {
        showNotif(`✅ Laporan verified & ditautkan ke invoice ${_linkedDup.id}. Gunakan tombol "Edit" di Invoice untuk tambah item jika ada pekerjaan baru.`);
      } else {
        showNotif(`ℹ️ Laporan hari ke-${_ordDup?.day_number || "?"} verified. Tidak buat invoice baru (data multi-hari tidak lengkap) — tautkan/edit invoice induk manual.`);
      }
      return;
    }
  }

  // ── Multi-hari: invoice di-anchor ke order INDUK (parent_job_id), bukan ke job hari ini.
  // Kalau invoice induk aktif sudah ada → JANGAN buat invoice ke-2 & JANGAN tambah otomatis
  // (SOP: laporan harian tumpang-tindih → cegah dobel-hitung). Tautkan saja; Owner edit manual.
  let _multiDayAnchor = null;
  {
    const _ordMD = ordersData.find(o => o.id === r.job_id);
    if (_ordMD?.is_multi_day === true && r.service !== "Survey") {
      const _md = resolveMultiDayInvoiceAction({
        report: { id: r.job_id, is_multi_day: true, parent_job_id: _ordMD.parent_job_id },
        invoices: invoicesData,
      });
      _multiDayAnchor = _md.anchorJobId;
      if (_md.type === "SKIP") {
        const existing = _md.existing;
        const dayNum = _ordMD?.day_number || "?";

        // ── Kalkulasi items dari laporan hari ini (sama seperti day-1) ──
        const _ordDay = ordersData.find(o => o.id === r.job_id);
        const _rawMatsD = (() => {
          if (r.materials_json) { try { return JSON.parse(r.materials_json); } catch { /* materials_json rusak → pakai default */ } }
          return safeArr(r.materials);
        })();
        const vMDetailD = _rawMatsD
          .filter(m => m.nama && parseFloat(m.jumlah || 0) > 0)
          .map(m => {
            const nm = (m.nama || "").toLowerCase();
            const isF = ["freon","r-22","r-32","r-410","r22","r32","r410"].some(k => nm.includes(k));
            const qty = isF ? Math.max(1, Math.ceil(parseFloat(m.jumlah) || 0)) : (parseFloat(m.jumlah) || 0);
            let hSat = parseFloat(m.harga_satuan) || 0;
            if (!hSat) hSat = lookupHargaGlobal(m.nama, m.satuan);
            let ket = m.keterangan || "";
            if (!ket) {
              if (isF) ket = "freon";
              else if (["repair","perbaikan","kapasitor","kompresor","sparepart","pcb"].some(k => nm.includes(k))) ket = "repair";
              else if (["cleaning","maintenance","cuci","jasa","service","servis","pemasangan","bongkar","instalasi","vacum","kuras"].some(k => nm.includes(k))) ket = "jasa";
            }
            return { nama: m.nama, jumlah: qty, satuan: m.satuan || "pcs", harga_satuan: hSat, subtotal: hSat * qty, keterangan: ket, category: categoryFromCatalog(m.nama, priceListData) };
          });

        // Inject labor (Cleaning/Maintenance) — guard name-based (paritas submit path):
        // baris jasa lain (freon/tambahan) tak boleh membatalkan biaya cleaning.
        const isCleanMaintD = r.service === "Cleaning" || r.service === "Maintenance";
        const alreadyHasCleaningRowD = vMDetailD.some(m => {
          if (m.keterangan !== "jasa") return false;
          const n = (m.nama || "").toLowerCase();
          return n.includes("cleaning") || n.includes("maintenance") || n.includes("cuci");
        });
        if (isCleanMaintD && !alreadyHasCleaningRowD) {
          const rUnitsD = Array.isArray(r.units) ? r.units : [];
          const withTipeD = rUnitsD.filter(u => u && u.tipe);
          if (withTipeD.length > 0) {
            withTipeD.forEach(u => {
              // Paritas dgn buildVerifyInvoice: harga deal klien maintenance menang bila match
              const dpD = dealPricesV ? clientCleaningUnitPrice(dealPricesV, u) : null;
              const hp = dpD != null ? dpD : hargaPerUnitFromTipe(r.service, u.tipe, priceListData);
              if (hp > 0) {
                const lbl = u.label || u.merk || ("Unit " + (u.unit_no || "?"));
                const bk = getBracketKey(r.service, u.tipe) || u.tipe;
                vMDetailD.unshift({ nama: r.service + " " + bk + " (" + lbl + ")" + (dpD != null ? " — harga kontrak" : ""), jumlah: 1, satuan: "unit", harga_satuan: hp, subtotal: hp, keterangan: "jasa" });
              }
            });
          } else {
            const sf = hitungLabor(r.service, _ordDay?.type, (Array.isArray(r.units) ? r.units.length : r.units) || _ordDay?.units || 1);
            if (sf > 0) {
              const uc = Math.max(1, (Array.isArray(r.units) ? r.units.length : parseInt(r.units)) || parseInt(_ordDay?.units) || 1);
              vMDetailD.unshift({ nama: (r.service || "") + (_ordDay?.type ? " - " + _ordDay.type : "") + " (Servis)", jumlah: uc, satuan: "unit", harga_satuan: Math.round(sf / uc), subtotal: sf, keterangan: "jasa" });
            }
          }
        }
        // Inject Biaya Pengecekan (Repair)
        if (r.service === "Repair" && !vMDetailD.some(m => m.keterangan === "jasa" || m.keterangan === "repair")) {
          const bcItem = priceListData.find(p => p.service === "Repair" && p.type === "Biaya Pengecekan AC");
          const bc = (bcItem && bcItem.price > 0) ? bcItem.price : 100000;
          const ucD = Math.max(1, (Array.isArray(r.units) ? r.units.length : Number(r.units)) || Number(_ordDay?.units) || 1);
          vMDetailD.unshift({ nama: "Biaya Pengecekan AC", jumlah: ucD, satuan: "unit", harga_satuan: bc, subtotal: bc * ucD, keterangan: "jasa" });
        }

        const _sumD = summarize(vMDetailD);
        const hasItemsD = vMDetailD.length > 0 && _sumD.total > 0;

        // Tautkan order ke invoice induk (selalu dilakukan terlepas merge/skip)
        await updateOrder(supabase, r.job_id, { status: "COMPLETED", invoice_id: existing.id }, auditUserName());
        setOrdersData(prev => prev.map(o => o.id === r.job_id ? { ...o, status: "COMPLETED", invoice_id: existing.id } : o));
        if (updateCustomerTierAfterOrder) updateCustomerTierAfterOrder(_ordMD).catch(() => {});

        if (!hasItemsD) {
          addAgentLog("MULTIDAY_SKIP_INVOICE", `Verify laporan ${r.job_id} (hari ke-${dayNum}) — tidak ada item baru, ditautkan ke ${existing.id}`, "INFO");
          showNotif(`✅ Laporan hari ke-${dayNum} verified & ditautkan ke invoice induk ${existing.id}. Tidak ada item baru.`);
          return;
        }

        // Ada items → tanya Owner apakah mau digabung
        const itemPreview = vMDetailD.slice(0, 4).map(m => `• ${m.nama} × ${m.jumlah} — ${fmt(m.subtotal)}`).join("\n")
          + (vMDetailD.length > 4 ? `\n  …dan ${vMDetailD.length - 4} item lainnya` : "");

        const ok = await showConfirm({
          icon: "📋",
          title: `Gabungkan ke Invoice Induk?`,
          message: `Laporan hari ke-${dayNum} sudah verified.\nJob: ${r.job_id} → Invoice induk: ${existing.id}\n\nItem pekerjaan hari ini (${vMDetailD.length} item, total ${fmt(_sumD.total)}):\n${itemPreview}\n\nTambahkan ke invoice ${existing.id}?`,
          confirmText: "Ya, Gabungkan",
        });

        if (ok) {
          const existDetail = (() => { try { return JSON.parse(existing.materials_detail || "[]"); } catch (_) { return []; } })();
          const tagged = tagDetailSource(vMDetailD, r.job_id);
          const merged = mergeInvoiceDetail(existDetail, tagged, r.job_id);
          const newTotals = recomputeInvoiceTotals(merged);

          const { error: mergeErr } = await supabase.from("invoices").update({
            materials_detail: JSON.stringify(normalizeLines(merged)),
            labor: newTotals.labor,
            material: newTotals.material,
            total: newTotals.total,
          }).eq("id", existing.id);

          if (mergeErr) {
            showNotif("❌ Gagal menggabungkan items: " + mergeErr.message);
            addAgentLog("MULTIDAY_MERGE_ERROR", `Gagal merge laporan ${r.job_id} ke invoice ${existing.id}: ${mergeErr.message}`, "ERROR");
          } else {
            const mergedStr = JSON.stringify(normalizeLines(merged));
            setInvoicesData(prev => prev.map(inv => inv.id === existing.id
              ? { ...inv, materials_detail: mergedStr, labor: newTotals.labor, material: newTotals.material, total: newTotals.total }
              : inv));
            showNotif(`✅ ${vMDetailD.length} item dari laporan hari ke-${dayNum} digabungkan ke invoice ${existing.id}. Total baru: ${fmt(newTotals.total)}`);
            addAgentLog("MULTIDAY_MERGE_SUCCESS", `Merge laporan ${r.job_id} (hari ke-${dayNum}) ke invoice ${existing.id}: ${vMDetailD.length} item, total ${newTotals.total}`, "INFO");
          }
        } else {
          addAgentLog("MULTIDAY_SKIP_INVOICE", `Verify laporan ${r.job_id} (hari ke-${dayNum}) — Owner skip merge, ditautkan ke ${existing.id}`, "INFO");
          showNotif(`✅ Laporan hari ke-${dayNum} verified & ditautkan ke invoice induk ${existing.id}. Item tidak digabungkan.`);
        }
        return;
      }
      // CREATE / CREATE_SEPARATE → lanjut; invoice baru pakai anchor _multiDayAnchor.
    }
  }

  const existInv = invoicesData.find(i => i.job_id === r.job_id);
  if (existInv) {
    // Pastikan order status COMPLETED meski invoice sudah ada sebelumnya
    const ord0 = ordersData.find(o => o.id === r.job_id);
    if (ord0 && ["DISPATCHED","ON_SITE"].includes(ord0.status)) {
      const { error: ordE0 } = await updateOrder(supabase, r.job_id, { status: "COMPLETED" }, auditUserName());
      if (ordE0) {
        addAgentLog("ORDER_STATUS_ERROR", `Gagal update order ${r.job_id} ke COMPLETED (existInv path): ${ordE0.message}`, "ERROR");
        showNotif(`⚠️ Laporan verified tapi status order gagal diperbarui — refresh & cek manual.`);
      } else {
        setOrdersData(prev => prev.map(o => o.id === r.job_id ? { ...o, status: "COMPLETED" } : o));
        if (updateCustomerTierAfterOrder) updateCustomerTierAfterOrder(ord0).catch(() => {});
      }
    }
    showNotif(`✅ Laporan verified! Invoice ${existInv.id} sudah ada — status: ${existInv.status}`);
  } else if (r.service === "Survey") {
    // Survey tidak buat invoice — hanya update order status ke COMPLETED
    const { error: survE } = await updateOrder(supabase, r.job_id, { status: "COMPLETED" }, auditUserName());
    if (survE) {
      addAgentLog("ORDER_STATUS_ERROR", `Gagal update order Survey ${r.job_id} ke COMPLETED: ${survE.message}`, "ERROR");
      showNotif(`⚠️ Laporan Survey verified tapi status order gagal diperbarui — refresh & cek manual.`);
    } else {
      setOrdersData(prev => prev.map(o => o.id === r.job_id ? { ...o, status: "COMPLETED" } : o));
    }
    if (updateCustomerTierAfterOrder) {
      const ord0 = ordersData.find(o => o.id === r.job_id);
      if (ord0) updateCustomerTierAfterOrder(ord0).catch(() => {});
    }
    showNotif("✅ Laporan Survey terverifikasi — tidak ada invoice");
  } else {
    const ord = ordersData.find(o => o.id === r.job_id);
    const invId = "INV" + Date.now().toString().slice(-7) + Math.floor(Math.random() * 100).toString().padStart(2, "0");

    // Bangun detail invoice via fungsi bersama (satu sumber dgn badge estimasi di kartu).
    const { vMDetail, labor: finalLabor2, material: finalMat2, total: totalInv, status: finalStatus2, waiver: waiverV } = buildVerifyInvoice(r, ord, dealPricesV);
    const newInv = {
      id: invId, job_id: (_multiDayAnchor || r.job_id), laporan_id: r.id,
      customer: r.customer, phone: r.phone || ord?.phone || "",
      // Alamat pekerjaan dari order — paritas dgn builder submit (laporanInvoice)
      address: ord?.address ? ord.address + (ord?.area ? ", " + ord.area : "") : null,
      service: r.service + (ord?.type ? " - " + ord.type : ""),
      units: Array.isArray(r.units) ? r.units.length : (Number(r.units) || Number(ord?.units) || 1),
      teknisi: r.teknisi || "",
      labor: finalLabor2, material: finalMat2,
      materials_detail: vMDetail.length > 0 ? JSON.stringify(normalizeLines(vMDetail)) : null,
      discount: 0, trade_in: false, trade_in_amount: 0,
      total: totalInv,
      status: finalStatus2,
      garansi_days: 30, garansi_expires: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      due: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      sent: false, created_at: new Date().toISOString()
    };
    const { data: oldDB, error: fetchOldErr } = await supabase
      .from("invoices").select("id,invoice_type").eq("job_id", (_multiDayAnchor || r.job_id));
    if (fetchOldErr) {
      console.error("[AUTO_INVOICE] gagal cek existing:", fetchOldErr.message);
      showNotif("❌ Gagal verifikasi invoice existing — coba lagi.");
      return;
    }
    // GUARD: jika ada invoice AC sale, JANGAN buat invoice baru atau hapus —
    // invoice AC sale punya unit + paket + DP customer yang tidak boleh hilang
    const acSaleInDB = (oldDB || []).find(o => o.invoice_type === "ac_unit_sale");
    if (acSaleInDB) {
      addAgentLog("INVOICE_AUTO_SKIP_AC_SALE",
        `Verify laporan ${r.job_id} — invoice AC sale ${acSaleInDB.id} sudah ada, tidak diubah`,
        "INFO");
      showNotif(`✅ Laporan verified! Invoice AC sale ${acSaleInDB.id} sudah ada (tidak diubah)`);
      // Tetap update order status COMPLETED
      const ord0 = ordersData.find(o => o.id === r.job_id);
      if (ord0 && ["DISPATCHED","ON_SITE"].includes(ord0.status)) {
        const { error: acOrdE } = await updateOrder(supabase, r.job_id, { status: "COMPLETED" }, auditUserName());
        if (acOrdE) {
          addAgentLog("ORDER_STATUS_ERROR", `Gagal update order ${r.job_id} ke COMPLETED (AC sale path): ${acOrdE.message}`, "ERROR");
        } else {
          setOrdersData(prev => prev.map(o => o.id === r.job_id ? { ...o, status: "COMPLETED" } : o));
          if (updateCustomerTierAfterOrder) updateCustomerTierAfterOrder(ord0).catch(() => {});
        }
      }
      return;
    }
    if (oldDB && oldDB.length > 0) {
      for (const oi of oldDB) {
        const { error: delErr } = await deleteInvoice(supabase, oi.id, auditUserName(), "ADMIN_EDIT_LAPORAN");
        if (delErr) {
          console.error("[AUTO_INVOICE] gagal hapus", oi.id, delErr.message);
          showNotif("❌ Gagal hapus invoice lama — coba lagi.");
          return;
        }
      }
      setInvoicesData(prev => prev.filter(inv => inv.job_id !== r.job_id));
    }
    // Auto-discount membership tier (Gold: jasa 5%, Platinum: jasa 5% + material 5%)
    if (customersData) {
      const custPhone2 = r.phone || ord?.phone || customersData.find(c => c.name === r.customer)?.phone;
      const custData2 = custPhone2
        ? customersData.find(c => c.phone === custPhone2 || c.phone === normalizePhone(custPhone2))
        : null;
      const custTier2 = custData2?.membership_tier;
      if ((custTier2 === "gold" || custTier2 === "platinum") && newInv.status === "PENDING_APPROVAL" && newInv.total > 0) {
        const laborDisc2 = Math.round((newInv.labor || 0) * 0.05);
        const matDisc2 = custTier2 === "platinum" ? Math.round((newInv.material || 0) * 0.05) : 0;
        const memberDisc2 = laborDisc2 + matDisc2;
        if (memberDisc2 > 0) {
          newInv.discount = (newInv.discount || 0) + memberDisc2;
          newInv.member_discount = memberDisc2;
          newInv.total = Math.max(0, newInv.total - memberDisc2);
        }
      }
    }
    // ── GUARD INVARIAN — tampilkan warning ke Owner jika total tidak match line items ──
    {
      const _chk = checkInvoiceConsistency({ ...newInv, lines: vMDetail }, { waiverAmount: waiverV });
      if (!_chk.ok) {
        const _desc = describeInconsistency(_chk, newInv.id);
        console.warn("[INVOICE_INVARIANT]", _desc);
        addAgentLog("INVOICE_INVARIANT", _desc + " (verify laporan)", "WARNING");
        showNotif("⚠️ Invoice dibuat tapi total tidak konsisten dengan item — cek di Monitoring. " + _desc.slice(0, 60));
      }
    }
    // H-1 fix: DB write DULU, state update SETELAH konfirmasi berhasil (tidak ada ghost invoice)
    const { error: iErr } = await insertInvoice(supabase, newInv);
    if (iErr) {
      addAgentLog("AUTO_INVOICE_ERROR", `Gagal simpan invoice ${invId} untuk laporan ${r.job_id}: ${iErr.message}`, "ERROR");
      showNotif("❌ Invoice gagal disimpan: " + iErr.message);
    } else {
      // H-2 fix: cek hasil updateOrder, notif + log jika gagal
      const { error: ordErr } = await updateOrder(supabase, r.job_id, { invoice_id: invId, status: "COMPLETED" }, auditUserName());
      if (ordErr) {
        addAgentLog("ORDER_STATUS_ERROR", `Invoice ${invId} tersimpan tapi gagal update order ${r.job_id}: ${ordErr.message}`, "ERROR");
        showNotif(`⚠️ Invoice ${invId} tersimpan, tapi status order gagal diperbarui — refresh & cek manual.`);
      } else {
        setOrdersData(prev => prev.map(o => o.id === r.job_id ? { ...o, invoice_id: invId, status: "COMPLETED" } : o));
      }
      setInvoicesData(prev => [...prev, newInv]);
      if (updateCustomerTierAfterOrder) {
        const ord = ordersData.find(o => o.id === r.job_id);
        if (ord) updateCustomerTierAfterOrder(ord).catch(() => {});
      }
      addAgentLog("AUTO_INVOICE", `Invoice ${invId} auto-dibuat dari laporan ${r.job_id}`, "SUCCESS");
      const invMsg = totalInv === 0
        ? `✅ Invoice ${invId} GRATIS — langsung LUNAS`
        : `✅ Invoice ${invId} dibuat (${fmt(totalInv)}) — tunggu approval Owner/Admin`;
      showNotif(invMsg);
      const owners = userAccounts.filter(u => u.role === "Owner" || u.role === "Admin");
      owners.forEach(o => { if (o?.phone) sendWA(o.phone, `⚡ *Invoice Auto-Generated*\n\nJob: *${r.job_id}*\nCustomer: ${r.customer}\nService: ${r.service}\nTotal: *${fmt(totalInv)}*\n\nMohon cek dan approve invoice di menu Invoice. — AClean`); });
    }
  }
};

return (
  <>
  <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
  <div style={{ display: "grid", gap: 16 }}>
    {_viewToggle}
    {/* Header */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 18, color: cs.text, display: "flex", alignItems: "center", gap: 8 }}>
          Laporan Tim Teknisi <span style={{ fontSize: 13, color: cs.muted, fontWeight: 400 }}>({filtered.length})</span>
          {liveActive && (
            <span title="Auto-refresh aktif (polling 90 dtk)" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: cs.green, background: cs.green + "18", border: `1px solid ${cs.green}33`, borderRadius: 99, padding: "2px 8px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: cs.green, display: "inline-block", animation: "pulse 1.5s ease-in-out infinite" }} />
              LIVE
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>
            {isTeknisiOrHelper ? "📋 Menampilkan laporan baru & revisi saja. Laporan terverifikasi disembunyikan. " : ""}
          {!isTeknisiOrHelper ? "Verifikasi laporan, cek riwayat edit, tandai sesuai atau minta revisi" : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[["SUBMITTED", cs.accent, "Baru"], ["VERIFIED", cs.green, "Verified"], ["REVISION", cs.yellow, "Revisi"], ["REJECTED", cs.red, "Ditolak"]].map(([s, col, lbl]) => (
          <span key={s} style={{ fontSize: 11, padding: "5px 11px", borderRadius: 99, background: col + "18", color: col, border: "1px solid " + col + "33", fontWeight: 700 }}>
            {laporanReports.filter(r => (r.status || "").toUpperCase() === s).length} {lbl}
          </span>
        ))}
      </div>
    </div>
    {/* Filters: date + service + status + tim */}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {/* Date filter — tambah Hari Ini */}
      {[["Semua", "📋"], ["Hari Ini", "🔴"], ["Minggu Ini", "📅"], ["Bulan Ini", "📅"]].map(([f, ic]) => (
        <button key={f} onClick={() => { setLaporanDateFilter(f); setLaporanPage(1); }}
          style={{
            padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
            border: "1px solid " + (laporanDateFilter === f ? cs.accent : cs.border),
            background: laporanDateFilter === f ? cs.accent + "22" : cs.surface,
            color: laporanDateFilter === f ? cs.accent : cs.muted,
            fontWeight: laporanDateFilter === f ? 700 : 400
          }}>
          {ic} {f}
        </button>
      ))}
      <span style={{ width: 1, height: 16, background: cs.border }} />
      {["Semua", "Cleaning", "Install", "Repair", "Complain", "Survey"].map(f => (
        <button key={f} onClick={() => { setLaporanSvcFilter(f); setLaporanPage(1); }}
          style={{
            padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
            border: "1px solid " + (laporanSvcFilter === f ? cs.accent : cs.border),
            background: laporanSvcFilter === f ? cs.accent + "22" : cs.surface,
            color: laporanSvcFilter === f ? cs.accent : cs.muted,
            fontWeight: laporanSvcFilter === f ? 700 : 400
          }}>
          {f}
        </button>
      ))}
      <span style={{ width: 1, height: 16, background: cs.border }} />
      {[["Semua","Semua",cs.muted], ["BELUM_VERIFIED","⏳ Belum Verified",cs.yellow], ["SUBMITTED","Baru",cs.accent], ["VERIFIED","Verified",cs.green], ["REVISION","Revisi",cs.yellow], ["REJECTED","Ditolak",cs.red]].map(([f, lbl, col]) => (
        <button key={f} onClick={() => { setLaporanStatusFilter(f); setLaporanPage(1); }}
          style={{
            padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
            border: "1px solid " + (laporanStatusFilter === f ? col : cs.border),
            background: laporanStatusFilter === f ? col + "22" : cs.surface,
            color: laporanStatusFilter === f ? col : cs.muted,
            fontWeight: laporanStatusFilter === f ? 700 : 400
          }}>
          {lbl}
        </button>
      ))}
      <span style={{ width: 1, height: 16, background: cs.border }} />
      {/* Filter per tim/teknisi */}
      {["Semua", ...[...new Set([
        ...laporanReports.map(r => r.teknisi),
        ...laporanReports.map(r => r.helper)
      ].filter(Boolean))].sort()].map(f => (
        <button key={f} onClick={() => { setLaporanTeamFilter(f); setLaporanPage(1); }}
          style={{
            padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
            border: "1px solid " + (laporanTeamFilter === f ? cs.green : cs.border),
            background: laporanTeamFilter === f ? cs.green + "22" : cs.surface,
            color: laporanTeamFilter === f ? cs.green : cs.muted,
            fontWeight: laporanTeamFilter === f ? 700 : 400,
            display: "flex", alignItems: "center", gap: 4
          }}>
          {f !== "Semua" && (
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: techColors?.[f] || cs.accent, display: "inline-block"
            }} />
          )}
          {f === "Semua" ? "👥 Semua Tim" : f}
        </button>
      ))}
    </div>
    {/* Search */}
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: cs.muted, fontSize: 14, pointerEvents: "none" }}>🔍</span>
      <input id="searchLaporan" value={searchLaporan} onChange={e => { setSearchLaporan(e.target.value); setLaporanPage(1); }}
        placeholder="Cari nama teknisi, customer, ID job, atau layanan..."
        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px 10px 38px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
      {searchLaporan && <button onClick={() => { setSearchLaporan(""); setLaporanPage(1); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 16 }}>✕</button>}
      {searchLaporan.trim().length >= 2 && (
        <div style={{ fontSize: 11, color: cs.muted, marginTop: 5, paddingLeft: 4 }}>
          {searchLoading ? "⏳ Mencari di seluruh arsip laporan…" : "🗂️ Termasuk laporan lama (di luar 1000 terbaru)"}
        </div>
      )}
    </div>
    {/* ── DATE RANGE PICKER ── */}
    <div style={{
      display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "8px 12px"
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: cs.muted, whiteSpace: "nowrap" }}>📅 Rentang Tanggal:</span>
      {/* Input dari */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: cs.muted }}>Dari</span>
        <input
          type="date"
          value={laporanDateFrom}
          onChange={e => {
            setLaporanDateFrom(e.target.value);
            setLaporanDateFilter("Range");
            setLaporanPage(1);
          }}
          style={{
            background: cs.card, border: "1px solid " + cs.border, borderRadius: 7,
            padding: "5px 9px", fontSize: 12, color: cs.text, cursor: "pointer",
            colorScheme: "dark"
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: cs.muted }}>–</span>
      {/* Input sampai */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: cs.muted }}>Sampai</span>
        <input
          type="date"
          value={laporanDateTo}
          onChange={e => {
            setLaporanDateTo(e.target.value);
            setLaporanDateFilter("Range");
            setLaporanPage(1);
          }}
          style={{
            background: cs.card, border: "1px solid " + cs.border, borderRadius: 7,
            padding: "5px 9px", fontSize: 12, color: cs.text, cursor: "pointer",
            colorScheme: "dark"
          }}
        />
      </div>
      {/* Info hasil + tombol reset */}
      {laporanDateFilter === "Range" && (laporanDateFrom || laporanDateTo) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <span style={{ fontSize: 11, color: cs.accent, fontWeight: 600 }}>
            {filtered.length} laporan
          </span>
          <button
            onClick={() => {
              setLaporanDateFrom("");
              setLaporanDateTo("");
              setLaporanDateFilter("Semua");
              setLaporanPage(1);
            }}
            style={{
              fontSize: 11, padding: "3px 10px", borderRadius: 99,
              background: cs.red + "22", border: "1px solid " + cs.red + "44",
              color: cs.red, cursor: "pointer", fontWeight: 600
            }}>
            ✕ Reset
          </button>
        </div>
      )}
    </div>

    {/* ── LAPORAN HARI INI — selalu tampil di atas ── */}
    {(() => {
      const todayStr = getLocalDate();
      const todayReps = laporanReports.filter(r =>
        (r.date || r.submitted_at || "").slice(0, 10) === todayStr
      );
      if (todayReps.length === 0 && laporanDateFilter === "Semua") return null;
      if (laporanDateFilter !== "Semua") return null; // sudah difilter, tidak perlu card ini
      return (
        <div style={{ background: cs.card, border: "2px solid " + cs.accent + "44", borderRadius: 14, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: cs.accent }}>
              🔴 Laporan Hari Ini — {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <div style={{ fontSize: 11, color: cs.muted }}>{todayReps.length} laporan</div>
          </div>
          {todayReps.length === 0 ? (
            <div style={{ fontSize: 12, color: cs.muted, textAlign: "center", padding: "10px 0" }}>
              Belum ada laporan masuk hari ini
            </div>
          ) : (
            <div style={{ display: "grid", gap: 7 }}>
              {todayReps
                .sort((a, b) => (sMap[a.status] ? 0 : 1) - (sMap[b.status] ? 0 : 1))
                .map(r => {
                  const [col] = sMap[(r.status || "").toUpperCase()] || [cs.muted];
                  const tcol = techColors?.[r.teknisi] || cs.accent;
                  return (
                    <div key={r.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      background: cs.surface, borderRadius: 10, padding: "8px 12px",
                      border: "1px solid " + col + "33"
                    }}>
                      {/* Avatar teknisi */}
                      <div style={{
                        width: 30, height: 30, borderRadius: 8, background: tcol + "33",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 800, color: tcol, flexShrink: 0
                      }}>
                        {(r.teknisi || "?")[0]}
                      </div>
                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 700, color: cs.text,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                        }}>
                          {r.customer} · {r.service}
                        </div>
                        <div style={{ fontSize: 11, color: cs.muted }}>
                          👷 {r.teknisi}{r.helper ? " + " + r.helper : ""}
                          {" · "}{r.job_id || r.id}
                        </div>
                      </div>
                      {/* Status badge */}
                      <div style={{
                        fontSize: 10, padding: "3px 9px", borderRadius: 99,
                        background: col + "22", color: col, fontWeight: 700, flexShrink: 0
                      }}>
                        {r.status === "SUBMITTED" ? "Baru" : r.status === "VERIFIED" ? "Verified" :
                          r.status === "REVISION" ? "Revisi" : "Ditolak"}
                      </div>
                      {/* Tombol verifikasi cepat */}
                      {r.status === "SUBMITTED" && (currentUser?.role === "Admin" || currentUser?.role === "Owner") && (
                        <button onClick={() => verifyLaporan(r)}
                          style={{
                            fontSize: 11, padding: "4px 10px", borderRadius: 7,
                            background: cs.green + "22", border: "1px solid " + cs.green + "44",
                            color: cs.green, cursor: "pointer", fontWeight: 600, flexShrink: 0
                          }}>
                          ✅ Verify
                        </button>
                      )}
                    </div>
                  );
                })
              }
            </div>
          )}
        </div>
      );
    })()}

    {/* List */}
    {filtered.length === 0
      ? <div style={{ background: cs.card, borderRadius: 14, padding: 40, textAlign: "center", color: cs.muted }}>Tidak ada laporan</div>
      : pageLap.map(r => (
        <div key={r.id} style={{ background: cs.card, border: "1px solid " + (sMap[r.status] ? sMap[r.status][0] : cs.border) + "33", borderRadius: 12, padding: "14px 16px" }}>
          {/* Card header — responsive */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, color: cs.accent, fontSize: 13 }}>{r.job_id}</span>
              {badge(r.status)}
              {safeArr(r.editLog).length > 0 && (
                <span style={{ fontSize: 9, color: cs.yellow, background: cs.yellow + "15", padding: "2px 6px", borderRadius: 99, border: "1px solid " + cs.yellow + "33", whiteSpace: "nowrap" }}>
                  ✏️ {safeArr(r.editLog).length}x
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: cs.muted, whiteSpace: "nowrap" }}>{r.submitted}</div>
          </div>

          {/* Info grid — responsive: 1 col mobile, 2 col desktop */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "6px 24px", fontSize: 12, marginBottom: 14 }}>
            <div><span style={{ color: cs.muted }}>Customer: </span><span style={{ fontWeight: 700, color: cs.text }}>{r.customer}</span></div>
            <div><span style={{ color: cs.muted }}>Teknisi: </span><span style={{ fontWeight: 700, color: cs.accent }}>{r.teknisi}{r.helper ? " + " + r.helper + " (Helper)" : ""}</span></div>
            <div><span style={{ color: cs.muted }}>Layanan: </span><span style={{ color: cs.text }}>{r.service}</span></div>
            <div><span style={{ color: cs.muted }}>Tanggal: </span><span style={{ color: cs.text }}>{r.date}</span></div>
            <div><span style={{ color: cs.muted }}>Jumlah Unit: </span><span style={{ color: cs.accent, fontWeight: 700 }}>{r.total_units || 1} unit</span></div>
            {safeArr(r.materials).length > 0 && <div><span style={{ color: cs.muted }}>Material: </span><span style={{ color: cs.text }}>{r.materials.length} item</span></div>}
            {(() => { const fotoCnt = safeArr(r.fotos).filter(f => f.url).length; return fotoCnt > 0 ? <div><span style={{ color: cs.green }}>📸 {fotoCnt} foto</span></div> : null; })()}
            {(() => { const tF = (r.units || []).reduce((s, u) => s + (parseFloat(u.freon_ditambah) || 0), 0); return tF > 0 ? <div><span style={{ color: cs.muted }}>Freon: </span><span style={{ color: cs.text }}>{tF.toFixed(0)} psi</span></div> : null; })()}
            {/* Summary PK + brand semua unit */}
            {(r.units || []).length > 0 && (() => {
              const unitSummary = (r.units || []).map((u, i) => {
                const pk = u.pk || "";
                const merk = u.merk || "";
                const label = u.label || `Unit ${i + 1}`;
                return { label, pk, merk, tipe: u.tipe || "" };
              });
              return (
                <div style={{ gridColumn: "1/-1" }}>
                  <span style={{ color: cs.muted }}>Detail Unit: </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                    {unitSummary.map((u, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 5,
                        background: cs.surface, border: "1px solid " + cs.border,
                        borderRadius: 7, padding: "3px 9px", fontSize: 11
                      }}>
                        <span style={{ fontWeight: 700, color: cs.accent }}>Unit {i + 1}</span>
                        <span style={{ color: cs.muted }}>·</span>
                        {u.merk && <span style={{ fontWeight: 700, color: cs.text }}>{u.merk}</span>}
                        {u.pk && (
                          <span style={{
                            background: cs.accent + "22", color: cs.accent,
                            fontWeight: 800, fontSize: 10, padding: "1px 6px", borderRadius: 99
                          }}>
                            {u.pk}
                          </span>
                        )}
                        {u.label && <span style={{ color: cs.muted, fontSize: 10 }}>{u.label}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>


          {/* ── Survey hasil — ditampilkan khusus untuk laporan Survey ── */}
          {r.service === "Survey" && (r.hasil_survey || r.catatan_rekomendasi) && (
            <div style={{ background: cs.surface, border: "1px solid " + cs.accent + "44", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: cs.accent, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>📋 Hasil Survey</div>
              {r.hasil_survey && <div style={{ fontSize: 13, color: cs.text, lineHeight: 1.55, whiteSpace: "pre-wrap", marginBottom: r.catatan_rekomendasi ? 8 : 0 }}>{r.hasil_survey}</div>}
              {r.catatan_rekomendasi && (
                <div style={{ borderTop: "1px solid " + cs.border, paddingTop: 8 }}>
                  <div style={{ fontSize: 10, color: cs.muted, fontWeight: 700, marginBottom: 4 }}>Rekomendasi</div>
                  <div style={{ fontSize: 13, color: cs.text, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{r.catatan_rekomendasi}</div>
                </div>
              )}
            </div>
          )}

          {/* ── BAP highlight — info kunci dari teknisi untuk admin bikin invoice ── */}
          {r.bap_number && (
            <div style={{
              background: cs.yellow + "12",
              border: "1px solid " + cs.yellow + "44",
              borderRadius: 10,
              padding: "11px 14px",
              marginBottom: 12,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: r.rekomendasi ? 9 : 0 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: cs.yellow, padding: "3px 10px", background: cs.yellow + "22", border: "1px solid " + cs.yellow + "55", borderRadius: 99, whiteSpace: "nowrap" }}>
                  📋 dari BAP · {r.bap_number}
                </span>
                <span style={{ fontSize: 11, color: cs.muted }}>
                  {r.bap_skipped_reason
                    ? <span style={{ color: cs.red }}>⚠ TTD di-skip: {r.bap_skipped_reason}</span>
                    : <span>✍️ TTD oleh: <b style={{ color: cs.text }}>{r.ttd_customer_name || "—"}</b></span>
                  }
                </span>
              </div>
              {r.rekomendasi && (
                <div style={{ background: cs.bg, border: "1px solid " + cs.yellow + "33", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 10, color: cs.yellow, fontWeight: 800, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.5px" }}>📌 Rekomendasi Teknisi (buat invoice dari sini)</div>
                  <div style={{ fontSize: 13, color: cs.text, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{r.rekomendasi}</div>
                </div>
              )}
              {r.ttd_customer_url && (
                <div style={{ marginTop: 8 }}>
                  <a href={fotoSrc(r.ttd_customer_url)} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, color: cs.accent, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    🖼 Lihat TTD customer
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Per-unit accordion — compact mobile layout */}
          {(r.units || []).map((u, ui) => (
            <div key={ui} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", marginBottom: 6, fontSize: 11 }}>
              {/* Unit header: compact mobile */}
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, color: cs.accent, fontSize: 12, minWidth: "50px" }}>
                  Unit {u.unit_no}
                </span>
                {u.label && (
                  <span style={{ fontSize: 11, color: cs.text, fontWeight: 600 }}>{u.label}</span>
                )}
                {u.merk && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: cs.text,
                    background: cs.surface, border: "1px solid " + cs.border,
                    borderRadius: 4, padding: "1px 6px"
                  }}>
                    {u.merk}
                  </span>
                )}
                {u.pk && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: "#fff",
                    background: cs.accent, borderRadius: 99, padding: "2px 7px"
                  }}>
                    {u.pk}
                  </span>
                )}
                {parseFloat(u.freon_ditambah) > 0 && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: "#06b6d4",
                    background: "#06b6d422", borderRadius: 99, padding: "1px 6px"
                  }}>
                    ❄️{u.freon_ditambah}psi
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                {(u.kondisi_sebelum || []).map((k, ki) => <span key={ki} style={{ fontSize: 10, background: cs.yellow + "18", color: cs.yellow, padding: "1px 7px", borderRadius: 99 }}>{k}</span>)}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                {(u.pekerjaan || []).map((k, ki) => <span key={ki} style={{ fontSize: 10, background: cs.accent + "18", color: cs.accent, padding: "1px 7px", borderRadius: 99 }}>{k}</span>)}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                {(u.kondisi_setelah || []).map((k, ki) => <span key={ki} style={{ fontSize: 10, background: cs.green + "18", color: cs.green, padding: "1px 7px", borderRadius: 99 }}>{k}</span>)}
              </div>
              <div style={{ fontSize: 11, color: cs.muted }}>
                {u.ampere_akhir ? `Ampere: ${u.ampere_akhir}A` : ""}{u.ampere_akhir && parseFloat(u.freon_ditambah) > 0 ? " · " : ""}
                {parseFloat(u.freon_ditambah) > 0 ? `Tekanan: ${u.freon_ditambah} psi` : ""}
                {u.catatan_unit ? ` · ${u.catatan_unit}` : ""}
              </div>
            </div>
          ))}

          {/* Material summary */}
          {safeArr(r.materials).length > 0 && (
            <div style={{ background: cs.surface, borderRadius: 9, padding: "10px 13px", marginBottom: 8, fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: cs.text, marginBottom: 6 }}>🔧 Material Terpakai</div>
              {safeArr(r.materials).map((m, mi) => (
                <div key={mi} style={{ color: cs.muted, marginBottom: 2 }}>• {m.nama}: {m.jumlah} {m.satuan}{m.keterangan ? ` — ${m.keterangan}` : ""}</div>
              ))}
            </div>
          )}

          {/* ── Foto grid untuk Admin/Owner ── */}
          {(() => {
            const fotoWithUrl = safeArr(r.fotos).filter(f => f.url);
            return fotoWithUrl.length > 0 ? (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: cs.green, marginBottom: 6 }}>📸 Foto Laporan ({fotoWithUrl.length})</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(80px,1fr))", gap: 6 }}>
                  {fotoWithUrl.map((f, fi) => {
                    const url = typeof f === "string" ? f : f.url;
                    const label = typeof f === "string" ? `Foto ${fi + 1}` : f.label || `Foto ${fi + 1}`;
                    return (
                      <div key={fi} style={{ position: "relative", cursor: "pointer" }} onClick={() => window.open(fotoSrc(url), "_blank")}>
                        <img src={fotoSrc(url)} alt={label} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", borderRadius: 7, border: "1px solid " + cs.border }} />
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "#000a", borderRadius: "0 0 7px 7px", padding: "2px 4px", fontSize: 9, color: "#fff", textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null;
          })()}
          {r.rekomendasi && !r.bap_number && <div style={{ fontSize: 11, marginBottom: 6 }}><span style={{ color: cs.muted }}>Rekomendasi: </span><span style={{ color: cs.text }}>{r.rekomendasi}</span></div>}
          {r.catatan_global && <div style={{ fontSize: 11, marginBottom: 8 }}><span style={{ color: cs.muted }}>Catatan: </span><span style={{ color: cs.text }}>{r.catatan_global}</span></div>}

          {/* Edit log */}
          {safeArr(r.editLog).length > 0 && (
            <div style={{ background: cs.yellow + "08", border: "1px solid " + cs.yellow + "22", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: cs.yellow, marginBottom: 8 }}>Riwayat Edit</div>
              {safeArr(r.editLog).map((log, li) => (
                <div key={li} style={{ fontSize: 11, color: cs.muted, marginBottom: 5, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ background: cs.accent + "18", color: cs.accent, fontWeight: 700, padding: "1px 8px", borderRadius: 99, fontSize: 10 }}>{log.by}</span>
                  <span style={{ color: cs.muted }}>{log.at}</span>
                  <span>ubah <b style={{ color: cs.text }}>{log.field}</b>:</span>
                  <span style={{ color: cs.red, textDecoration: "line-through", fontStyle: "italic" }}>{log.old}</span>
                  <span style={{ color: cs.muted }}>→</span>
                  <span style={{ color: cs.green, fontWeight: 600 }}>{log.new}</span>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {r.status === "SUBMITTED" && (<>
              {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && r.service !== "Survey" && (() => {
                const est = buildVerifyInvoice(r, ordersData.find(o => o.id === r.job_id));
                return (
                  <span title="Perkiraan total invoice saat diverifikasi (sudah termasuk biaya cuci/pengecekan otomatis). Diskon membership belum dihitung." style={{ background: "#22c55e14", border: "1px solid #22c55e44", color: "#22c55e", padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 800, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    ≈ Invoice: Rp {Number(est.total || 0).toLocaleString("id-ID")}
                  </span>
                );
              })()}
              <button onClick={() => verifyLaporan(r)} style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✅ Verifikasi</button>
              <button onClick={async () => {
                if (currentUser?.role !== "Owner" && currentUser?.role !== "Admin") return showNotif("❌ Hanya Owner/Admin");
                const { error: revErr } = await updateServiceReport(supabase, r.id, { status: "REVISION" }, auditUserName());
                if (revErr) {
                  console.warn("❌ update REVISION failed:", revErr.message);
                  addAgentLog("LAPORAN_UPDATE_ERROR", `Update status REVISION gagal: ${revErr.message.slice(0, 80)}`, "WARNING");
                  showNotif("❌ Gagal update status — " + revErr.message.slice(0, 50));
                  return;
                }
                setLaporanReports(p => p.map(x => x.id === r.id ? { ...x, status: "REVISION" } : x));
                addAgentLog("LAPORAN_REVISION", `Laporan ${r.job_id} diminta revisi oleh ${currentUser?.name}`, "WARNING");
                showNotif("⚠️ Revisi diminta untuk laporan " + r.job_id);
                // SIM-11: WA notif ke teknisi saat laporan REVISION
                const tekAccRev = userAccounts.find(u => u.name === r.teknisi && u.phone);
                if (tekAccRev?.phone) sendWA(tekAccRev.phone,
                  "Laporan Perlu Direvisi\nJob: " + r.job_id
                  + "\nCustomer: " + r.customer + "\nService: " + r.service
                  + "\n\nAdmin meminta revisi. Silakan perbaiki. — AClean");
              }} style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Minta Revisi</button>
              <button onClick={async () => {
                if (currentUser?.role !== "Owner" && currentUser?.role !== "Admin") return showNotif("❌ Hanya Owner/Admin");
                const { error: rejErr } = await updateServiceReport(supabase, r.id, { status: "REJECTED" }, auditUserName());
                if (rejErr) {
                  console.warn("❌ update REJECTED failed:", rejErr.message);
                  addAgentLog("LAPORAN_UPDATE_ERROR", `Update status REJECTED gagal: ${rejErr.message.slice(0, 80)}`, "WARNING");
                  showNotif("❌ Gagal update status — " + rejErr.message.slice(0, 50));
                  return;
                }
                setLaporanReports(p => p.map(x => x.id === r.id ? { ...x, status: "REJECTED" } : x));
                addAgentLog("LAPORAN_REJECTED", `Laporan ${r.job_id} ditolak oleh ${currentUser?.name}`, "ERROR");
                showNotif("❌ Laporan " + r.job_id + " ditolak");
              }} style={{ background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Tolak</button>
            </>)}
            {/* Edit laporan — Owner, Admin, atau Teknisi/Helper yang membuat laporan */}
            {((currentUser?.role === "Owner" || currentUser?.role === "Admin") || r.teknisi === currentUser?.name || r.helper === currentUser?.name) && (
              <button onClick={() => {
                const mats = JSON.parse(JSON.stringify(r.materials || []));
                // ✨ PHASE 2: Load barang items separately from existing laporan
                const barangFromMats = mats.filter(m => m.keterangan === "barang").map(b => ({
                  id: Date.now() + Math.random(),
                  nama: b.nama,
                  jumlah: b.jumlah,
                  satuan: b.satuan || "pcs",
                  harga_satuan: b.harga_satuan || 0,
                  _isManual: false
                }));
                setLaporanBarangItems(barangFromMats);
                setEditLaporanForm({ editService: r.service, rekomendasi: r.rekomendasi || "", catatan_global: r.catatan_global || r.catatan || "", hasil_survey: r.hasil_survey || "", catatan_rekomendasi: r.catatan_rekomendasi || "", editUnits: JSON.parse(JSON.stringify(r.units || [])), editJasaItems: mats.filter(m => m.keterangan === "jasa"), editMatItems: mats.filter(m => m.keterangan !== "jasa" && m.keterangan !== "barang") });
                // ✨ Load repair type from existing invoice
                const existInvForEdit = invoicesData.find(i => i.job_id === r.job_id);
                setEditRepairType(existInvForEdit?.repair_gratis || "berbayar");
                setEditGratisAlasan("");
                setActiveEditUnitIdx(0);
                setEditPhotoMode(false); // Reset photo mode to default (don't re-upload)
                setEditLaporanFotos([]); // Clear any previous photo uploads
                setEditStockMats([]); // Clear stock-linked material picker
                // ── Install: rebuild laporanInstallItems from existing materials ──
                if (r.service === "Install") {
                  const installMap = {};
                  (r.materials || []).forEach(mat => {
                    const ii = INSTALL_ITEMS.find(item => item.label === mat.nama || item.key === mat.id);
                    if (ii) installMap[ii.key] = String(mat.jumlah || 0);
                  });
                  setLaporanInstallItems(installMap);
                }
                setSelectedLaporan(r); setEditLaporanMode(true); setModalLaporanDetail(true);
              }}
                style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                ✏️ Edit Laporan
              </button>
            )}
            {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
              r.service === "Survey"
                ? (r.status === "VERIFIED" || r.status === "SUBMITTED") && (
                  <button onClick={() => setSurveyKirimModal(r)}
                    style={{ background: "#16a34a22", border: "1px solid #16a34a44", color: "#4ade80", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    📤 Kirim Hasil Survey
                  </button>
                )
                : downloadServiceReportPDF && (
                  <button onClick={() => { const relInv = invoicesData.find(i => i.job_id === r.job_id) || {}; downloadServiceReportPDF(r, relInv); }}
                    style={{ background: "#1e3a5f22", border: "1px solid #1e3a5f44", color: "#93c5fd", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    📋 Report Card
                  </button>
                )
            )}
            {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
              <button onClick={async () => {
                const ok = await showConfirm({
                  icon: "🗑️", title: "Hapus Laporan?",
                  message: "Hapus laporan " + r.job_id + " (" + r.customer + ")? Invoice terkait juga akan dihapus.",
                  confirmText: "Ya, Hapus"
                });
                if (!ok) return;
                // Hapus laporan
                const { error: delErr } = await deleteServiceReport(supabase, r.id, auditUserName());
                if (delErr) {
                  console.warn("❌ delete laporan failed:", delErr.message);
                  showNotif("❌ Gagal hapus laporan: " + delErr.message.slice(0, 50));
                  return;
                }
                setLaporanReports(p => p.filter(x => x.id !== r.id));
                // Hapus invoice terkait jika ada — KECUALI invoice AC sale (punya source of truth sendiri)
                const relInv = invoicesData.filter(i => i.job_id === r.job_id && i.invoice_type !== "ac_unit_sale");
                if (relInv.length > 0) {
                  await Promise.all(relInv.map(inv => deleteInvoice(supabase, inv.id, auditUserName(), "LAPORAN_DIHAPUS")));
                  setInvoicesData(p => p.filter(i => !(i.job_id === r.job_id && i.invoice_type !== "ac_unit_sale")));
                }
                // Notify jika ada AC sale invoice yang skip
                const acSaleSkipped = invoicesData.find(i => i.job_id === r.job_id && i.invoice_type === "ac_unit_sale");
                if (acSaleSkipped) {
                  addAgentLog("LAPORAN_DEL_KEEP_AC_SALE",
                    `Laporan ${r.job_id} dihapus, tapi invoice AC sale ${acSaleSkipped.id} dipertahankan (source of truth sendiri)`,
                    "INFO");
                }
                // Kembalikan stok material dari transaksi laporan ini
                const { data: txRows } = await supabase
                  .from("inventory_transactions")
                  .select("*")
                  .eq("report_id", r.id)
                  .eq("type", "usage");
                if (txRows && txRows.length > 0) {
                  await Promise.all(txRows.map(tx => supabase.from("inventory_transactions").insert({
                    inventory_code: tx.inventory_code,
                    inventory_name: tx.inventory_name,
                    order_id: tx.order_id || null,
                    report_id: tx.report_id || null,
                    qty: Math.abs(tx.qty),
                    qty_actual: Math.abs(tx.qty_actual ?? tx.qty),
                    type: "adjustment",
                    notes: `Void/hapus laporan ${r.job_id} — stok dikembalikan`,
                    customer_name: tx.customer_name || null,
                    teknisi_name: tx.teknisi_name || null,
                    job_date: tx.job_date || null,
                    created_by_name: currentUser?.name || "Admin",
                  })));
                  if (setInvTxData) {
                    setInvTxData(prev => prev.filter(t => t.report_id !== r.id));
                  }
                  if (setInventoryData) {
                    setInventoryData(prev => prev.map(item => {
                      const returned = txRows.filter(t => t.inventory_code === item.code)
                        .reduce((s, t) => s + Math.abs(t.qty), 0);
                      if (!returned) return item;
                      return { ...item, stock: item.stock + returned };
                    }));
                  }
                }
                // Reset order status ke COMPLETED (bukan INVOICED)
                await updateOrderStatus(supabase, r.job_id, "COMPLETED", auditUserName(), { invoice_id: null });
                setOrdersData(p => p.map(o => o.id === r.job_id ? { ...o, status: "COMPLETED", invoice_id: null } : o));
                addAgentLog("LAPORAN_DELETED", "Laporan " + r.job_id + " dihapus oleh " + currentUser?.name, "WARNING");
                showNotif("🗑️ Laporan " + r.job_id + " dihapus");
              }}
                style={{
                  background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red,
                  padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700
                }}>
                🗑️ Hapus Laporan
              </button>
            )}
            {r.status === "REVISION" && <span style={{ fontSize: 12, color: cs.yellow }}>Menunggu revisi dari {r.teknisi}</span>}
            {r.status === "VERIFIED" && <span style={{ fontSize: 12, color: cs.green }}>Laporan sudah terverifikasi</span>}
            {r.status === "REJECTED" && <span style={{ fontSize: 12, color: cs.red }}>Laporan ditolak</span>}
          </div>
        </div>
      ))}
    {/* Pagination Laporan */}
    {totPgL > 1 && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0" }}>
        <button onClick={() => setLaporanPage(p => Math.max(1, p - 1))} disabled={curPgL === 1}
          style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgL === 1 ? cs.surface : cs.card, color: curPgL === 1 ? cs.muted : cs.text, cursor: curPgL === 1 ? "not-allowed" : "pointer", fontSize: 12 }}>← Prev</button>
        <span style={{ fontSize: 12, color: cs.text }}>Hal {curPgL}/{totPgL}</span>
        <button onClick={() => setLaporanPage(p => Math.min(totPgL, p + 1))} disabled={curPgL === totPgL}
          style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgL === totPgL ? cs.surface : cs.card, color: curPgL === totPgL ? cs.muted : cs.text, cursor: curPgL === totPgL ? "not-allowed" : "pointer", fontSize: 12 }}>Next →</button>
        <span style={{ fontSize: 11, color: cs.muted }}>{filtered.length} laporan</span>
      </div>
    )}
  </div>
  {surveyKirimModal && (
    <SurveyKirimModal
      r={surveyKirimModal}
      onClose={() => setSurveyKirimModal(null)}
      sendWA={sendWA}
      showNotif={showNotif}
      addAgentLog={addAgentLog}
      auditUserName={auditUserName}
      updateServiceReport={updateServiceReport}
      supabase={supabase}
      fotoSrc={fotoSrc}
      downloadServiceReportPDF={downloadServiceReportPDF}
      invoicesData={invoicesData}
    />
  )}
  </>
);
}

export default memo(LaporanTimView);
