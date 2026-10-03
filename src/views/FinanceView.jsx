import { useState, useMemo, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { getLocalDate } from "../lib/dateTime.js";
import { fetchFinanceMonthDetails, fetchFinanceSnapshot, fetchFinanceSummaryV2 } from "../data/reads.js";
import { flushPerfMetrics, measureAsync } from "../lib/perfMetrics.js";
import { GajiTab } from "./TeknisiAdminView.jsx";
import { downloadBlob, buildCsv, printDocument, htmlTable, rp, fmtTanggal, escapeHtml } from "../lib/exportUtils.js";

// WIB offset helper — konsisten dengan getLocalDate dari dateTime.js
const OFFSET_MS = 7 * 60 * 60 * 1000;
const getWIBDateStr = (offsetDays = 0) => {
  const d = new Date(Date.now() + OFFSET_MS + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
};
const getWIBDateLabel = (offsetDays = 0) => {
  const d = new Date(Date.now() + OFFSET_MS + offsetDays * 86400000);
  return new Date(d.toISOString().slice(0, 10) + "T00:00:00+07:00")
    .toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};

// localStorage helper untuk persist target
const LS_KEY = "finance_target_bulan";
const loadTarget = () => {
  try { const v = localStorage.getItem(LS_KEY); return v ? Number(v) : 100000000; } catch { return 100000000; }
};
const saveTarget = (v) => { try { localStorage.setItem(LS_KEY, String(v)); } catch { /* localStorage opsional (penuh/private mode) — abaikan */ } };
const financeCache = new Map();
const FINANCE_CACHE_MS = 2 * 60 * 1000;

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "planning", label: "Financial Planning", icon: "🎯" },
  { id: "payroll", label: "Pengelolaan Gaji", icon: "💵" },
];

// Uang yang BENAR-BENAR diterima dari sebuah invoice (basis kas):
// PAID → total penuh; PARTIAL_PAID → paid_amount (cicilan yang sudah masuk). Selain itu 0.
const cashReceived = (i) =>
  i?.cash_amount != null ? Number(i.cash_amount)
    : i?.status === "PAID" ? Number(i.total || 0)
    : i?.status === "PARTIAL_PAID" ? Number(i.paid_amount || 0)
      : 0;

const fmtRp = (n) =>
  n == null || n === "" ? "—" : "Rp " + Number(n).toLocaleString("id-ID");

const StatCard = ({ value, label, color, sub }) => (
  <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px" }}>
    <div style={{ fontSize: 18, fontWeight: 700, color: color || cs.accent, lineHeight: 1.2 }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{sub}</div>}
    <div style={{ fontSize: 11, color: cs.muted, marginTop: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
  </div>
);

const Badge = ({ children, color, bg, border }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", padding: "4px 10px",
    borderRadius: 14, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
    color, background: bg, border: "1px solid " + border,
  }}>{children}</span>
);

const invStatusBadge = (status) => {
  if (!status) return <span style={{ color: cs.muted }}>—</span>;
  const s = status.toUpperCase();
  if (s === "PAID") return <Badge color={cs.green} bg={cs.green + "18"} border={cs.green + "44"}>✓ PAID</Badge>;
  if (s === "UNPAID") return <Badge color={cs.yellow} bg={cs.yellow + "18"} border={cs.yellow + "44"}>UNPAID</Badge>;
  if (s === "OVERDUE") return <Badge color={cs.red} bg={cs.red + "18"} border={cs.red + "44"}>OVERDUE</Badge>;
  if (s.includes("PENDING")) return <Badge color={cs.ara} bg={cs.ara + "18"} border={cs.ara + "44"}>PENDING APV</Badge>;
  return <Badge color={cs.muted} bg="transparent" border={cs.border}>{status}</Badge>;
};

const orderStatusBadge = (status) => {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === "INVOICE_APPROVED") return <Badge color={cs.accent} bg={cs.accent + "18"} border={cs.accent + "44"}>Invoice Dikirim</Badge>;
  if (s === "CONFIRMED") return <Badge color={cs.green} bg={cs.green + "18"} border={cs.green + "44"}>Dikonfirmasi</Badge>;
  if (s === "COMPLETED" || s === "LUNAS" || s === "PAID") return <Badge color={cs.green} bg={cs.green + "18"} border={cs.green + "44"}>Selesai</Badge>;
  if (s === "REPORT_SUBMITTED") return <Badge color={cs.ara} bg={cs.ara + "18"} border={cs.ara + "44"}>Laporan Masuk</Badge>;
  if (s.includes("PENDING")) return <Badge color={cs.ara} bg={cs.ara + "18"} border={cs.ara + "44"}>Pending</Badge>;
  return <Badge color={cs.muted} bg="transparent" border={cs.border}>{status}</Badge>;
};

// ─── Dashboard Tab ───────────────────────────────────────────────
const DashboardTab = ({
  ordersData, invoicesData, allInvoices, todayStr,
  currentDate, onPrevDay, onNextDay, onToday,
  setPaymentProofModal, currentUser, supabase, financeSnapshot,
}) => {
  const [mutasiChecked, setMutasiChecked] = useState({});
  const [mutasiLoading, setMutasiLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [mutasiError, setMutasiError] = useState(null);

  // Hanya load mutasi 90 hari terakhir — cegah fetch tak terbatas
  const loadMutasi = useCallback(async () => {
    if (!supabase) return;
    setMutasiLoading(true);
    setMutasiError(null);
    try {
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
      const { data, error } = await supabase
        .from("mutasi_checklist")
        .select("id, job_id, invoice_id, checked, checked_by, checked_at, notes")
        .gte("created_at", cutoff);
      if (error) throw error;
      if (data) {
        const map = {};
        data.forEach(r => { map[r.job_id] = r; });
        setMutasiChecked(map);
      }
    } catch (e) {
      console.warn("mutasi_checklist load failed:", e?.message);
      setMutasiError("Gagal memuat data mutasi");
    }
    setMutasiLoading(false);
  }, [supabase]);

  useEffect(() => { loadMutasi(); }, [loadMutasi]);

  const toggleMutasi = async (jobId, invoiceId) => {
    if (savingId) return;
    const current = mutasiChecked[jobId];
    const isCurrentlyChecked = !!current?.checked;
    if (isCurrentlyChecked) {
      const checkedBy = current?.checked_by ? ` (dicek oleh ${current.checked_by})` : "";
      const ok = window.confirm(`Batalkan centang mutasi ini${checkedBy}?\n\nYakin ingin membatalkan?`);
      if (!ok) return;
    }
    const newChecked = isCurrentlyChecked ? false : true;
    setSavingId(jobId);
    setMutasiError(null);

    try {
      if (current?.id) {
        const { error } = await supabase.from("mutasi_checklist").update({
          checked: newChecked,
          checked_by: currentUser?.name || "Finance",
          checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", current.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("mutasi_checklist").insert({
          job_id: jobId,
          invoice_id: invoiceId || null,
          checked: newChecked,
          checked_by: currentUser?.name || "Finance",
          checked_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
      setMutasiChecked(prev => ({
        ...prev,
        [jobId]: { ...(prev[jobId] || { job_id: jobId }), checked: newChecked, checked_by: currentUser?.name || "Finance" },
      }));
    } catch (e) {
      console.warn("toggleMutasi error:", e?.message);
      setMutasiError("Gagal simpan cek mutasi — coba lagi");
    }
    setSavingId(null);
  };

  const rows = useMemo(() =>
    (ordersData || []).map(order => {
      const inv = (invoicesData || []).find(i => i.job_id === order.id);
      return { order, inv };
    }),
    [ordersData, invoicesData]);

  // Pemasukan hari ini = basis KAS (uang diterima hari ini by paid_at), termasuk cicilan
  // PARTIAL_PAID — konsisten dgn PlanningTab. Bukan lagi by tanggal job.
  const fallbackTodayCashInv = (allInvoices || []).filter(i =>
    (i.paid_at || "").slice(0, 10) === todayStr && (i.status === "PAID" || i.status === "PARTIAL_PAID"));
  const todayCashInv = financeSnapshot?.day_cash_rows || fallbackTodayCashInv;
  const todayPemasukan = Number(financeSnapshot?.summary?.day_cash ?? todayCashInv.reduce((s, i) => s + cashReceived(i), 0));
  const todayPaid = todayCashInv; // untuk label "n invoice dibayar hari ini"
  const todayBelumLunas = rows.filter(r => r.inv && (r.inv.status === "UNPAID" || r.inv.status === "OVERDUE")).length;
  const todayPendingAPV = rows.filter(r => r.inv && (r.inv.status || "").toUpperCase().includes("PENDING")).length;
  const belumMutasi = rows.filter(r => r.inv?.status === "PAID" && !mutasiChecked[r.order?.id]?.checked).length;

  // All-time untuk referensi (basis kas — termasuk cicilan partial)
  const allTimePaid = Number(financeSnapshot?.summary?.cash_all_time ?? (allInvoices || []).reduce((s, i) => s + cashReceived(i), 0));
  const allUnpaid = Number(financeSnapshot?.summary?.unpaid_count ?? (allInvoices || []).filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length);

  return (
    <div>
      {/* Date Navigator */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <button onClick={onPrevDay} style={{ width: 32, height: 32, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, cursor: "pointer", fontSize: 14 }}>◀</button>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>📅 {currentDate}</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
            {rows.length} order · {todayPaid.length} dibayar hari ini · {todayBelumLunas} belum lunas
          </div>
          {mutasiError && (
            <div style={{ fontSize: 11, color: cs.red, marginTop: 4 }}>⚠️ {mutasiError}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onToday} style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "66", color: cs.accent, padding: "7px 14px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 12 }}>Hari Ini</button>
          <button onClick={onNextDay} style={{ width: 32, height: 32, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, cursor: "pointer", fontSize: 14 }}>▶</button>
        </div>
      </div>

      {/* Stat Cards — konteks hari ini, responsive */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 14 }}>
        <StatCard value={rows.length} label="Order Hari Ini" color={cs.accent} />
        <StatCard value={fmtRp(todayPemasukan)} label="Pemasukan Hari Ini" color={cs.green} sub={todayPaid.length + " invoice dibayar (incl. cicilan)"} />
        <StatCard value={todayBelumLunas} label="Belum Lunas" color={todayBelumLunas > 0 ? cs.yellow : cs.muted} sub={"Hari ini"} />
        <StatCard value={todayPendingAPV} label="Pending APV" color={todayPendingAPV > 0 ? cs.ara : cs.muted} sub={"Hari ini"} />
        <StatCard value={mutasiLoading ? "⟳" : belumMutasi} label="Belum Cek Mutasi" color={belumMutasi > 0 ? cs.red : cs.muted} sub={"Hari ini · PAID"} />
        <StatCard value={allUnpaid} label="Piutang Total" color={allUnpaid > 0 ? cs.yellow : cs.muted} sub={fmtRp(allTimePaid) + " all-time"} />
      </div>

      {/* Tabel — scroll horizontal di mobile */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, overflowX: "auto" }}>
        <div style={{ minWidth: 720 }}>
          {/* Header */}
          <div style={{
            display: "grid", gridTemplateColumns: "1.7fr 1.1fr 0.9fr 1fr 1fr 1fr 0.6fr",
            gap: 8, padding: "10px 16px", borderBottom: "1px solid " + cs.border,
            fontSize: 10, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600,
          }}>
            <div>Detail Job</div><div>Team</div><div>Status Order</div>
            <div>Invoice Value</div><div>Invoice Status</div><div>Bukti Bayar</div>
            <div style={{ textAlign: "center" }}>Mutasi {mutasiLoading ? "⟳" : "✓"}</div>
          </div>

          {rows.length === 0 ? (
            <div style={{ padding: "48px 16px", textAlign: "center", color: cs.muted, fontSize: 13 }}>
              Tidak ada order pada tanggal ini
            </div>
          ) : rows.map(({ order, inv }) => {
            const isPaid = inv?.status === "PAID";
            const isGratis = isPaid && (inv?.total === 0 || inv?.repair_gratis);
            const hasProof = !!inv?.payment_proof_url && inv.payment_proof_url !== "verified-no-proof";
            const isVerifiedManual = inv?.payment_proof_url === "verified-no-proof";
            const isComplain = (order.service || "").toLowerCase().includes("complain");
            const isMutasiChecked = !!mutasiChecked[order.id]?.checked;
            const isSaving = savingId === order.id;

            return (
              <div key={order.id} style={{
                display: "grid", gridTemplateColumns: "1.7fr 1.1fr 0.9fr 1fr 1fr 1fr 0.6fr",
                gap: 8, padding: "12px 16px", borderBottom: "1px solid " + cs.border + "80", alignItems: "center",
              }}>
                {/* Detail Job */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: isComplain ? cs.red : cs.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {order.customer}
                  </div>
                  <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
                    {order.service} · {order.units || 1} unit{order.time ? " · " + (order.time || "").slice(0, 5) : ""}
                  </div>
                </div>

                {/* Team */}
                <div>
                  <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: cs.accent, flexShrink: 0, display: "inline-block" }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.teknisi || "—"}</span>
                  </div>
                  <div style={{ fontSize: 11, color: cs.muted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {order.helper ? "🪙 " + order.helper : "— tanpa helper"}
                  </div>
                </div>

                {/* Order Status */}
                <div>{orderStatusBadge(order.status)}</div>

                {/* Invoice Value — fix: total=0 (gratis) tampil hijau, bukan abu */}
                <div style={{
                  fontWeight: 700, fontSize: 13,
                  color: !inv ? cs.muted : isGratis ? cs.green : inv.total > 0 ? cs.green : cs.muted,
                }}>
                  {!inv ? "—" : isGratis ? "🎁 Gratis" : fmtRp(inv.total)}
                </div>

                {/* Invoice Status */}
                <div>{invStatusBadge(inv?.status)}</div>

                {/* Bukti Bayar */}
                <div>
                  {isPaid && hasProof ? (
                    <button
                      onClick={() => setPaymentProofModal({ url: inv.payment_proof_url, customer: order.customer })}
                      style={{ background: cs.green + "18", border: "1px solid " + cs.green + "44", color: cs.green, padding: "5px 10px", borderRadius: 7, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                      📷 Lihat
                    </button>
                  ) : isPaid && isVerifiedManual ? (
                    <span style={{ fontSize: 11, color: "#0ea5e9", fontWeight: 600 }}>✅ Manual</span>
                  ) : isPaid && isGratis ? (
                    <span style={{ fontSize: 11, color: cs.green, fontWeight: 600 }}>🎁 Gratis</span>
                  ) : isPaid ? (
                    <span style={{ fontSize: 11, color: cs.yellow }}>📎 Belum upload</span>
                  ) : (
                    <span style={{ fontSize: 11, color: cs.border }}>—</span>
                  )}
                </div>

                {/* Cek Mutasi */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  {isSaving ? (
                    <div style={{
                      width: 28, height: 28, borderRadius: 7,
                      border: "2px solid " + cs.accent, background: cs.surface,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, color: cs.accent,
                    }}>⟳</div>
                  ) : (
                    <button
                      onClick={() => toggleMutasi(order.id, inv?.id)}
                      title={isMutasiChecked
                        ? "Dicek oleh " + (mutasiChecked[order.id]?.checked_by || "?") + " · klik untuk batal"
                        : "Klik untuk tandai sudah cek mutasi"}
                      style={{
                        width: 28, height: 28, borderRadius: 7,
                        border: "2px solid " + (isMutasiChecked ? cs.green : cs.border),
                        background: isMutasiChecked ? cs.green : cs.surface,
                        color: isMutasiChecked ? "#fff" : cs.muted,
                        cursor: "pointer", fontWeight: 700, fontSize: 15,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.15s",
                      }}>
                      {isMutasiChecked ? "✓" : "○"}
                    </button>
                  )}
                  {isMutasiChecked && mutasiChecked[order.id]?.checked_by && (
                    <div style={{ fontSize: 9, color: cs.green, textAlign: "center", maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {mutasiChecked[order.id].checked_by}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Total footer */}
      {rows.length > 0 && (
        <div style={{ marginTop: 10, padding: "10px 16px", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
          <span style={{ color: cs.muted }}>{rows.length} order · {todayPaid.length} dibayar · {belumMutasi} belum mutasi</span>
          <span style={{ fontWeight: 700, color: cs.green }}>{fmtRp(todayPemasukan)}</span>
        </div>
      )}
    </div>
  );
};

// ─── Financial Planning Tab ──────────────────────────────────────
const PlanningTab = ({ allInvoices, allExpenses, showNotif, financeSnapshot, detailsLoading }) => {
  const [targetBulan, setTargetBulan] = useState(loadTarget);

  // bulanIni dalam WIB — reaktif via useMemo bukan top-level const
  const bulanIni = useMemo(() => getLocalDate().slice(0, 7), []);
  const bulanLabel = useMemo(() => {
    const d = new Date(bulanIni + "-01T00:00:00+07:00");
    return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  }, [bulanIni]);

  // Persist target ke localStorage saat berubah
  const handleTargetChange = (val) => {
    const n = Number(val);
    setTargetBulan(n);
    saveTarget(n);
  };

  const paidThisMonth = useMemo(() => detailsLoading ? [] : (financeSnapshot?.month_invoices ||
    (allInvoices || []).filter(i =>
      (i.status === "PAID" || i.status === "PARTIAL_PAID") && (i.paid_at || i.created_at || "").slice(0, 7) === bulanIni
    )), [allInvoices, bulanIni, detailsLoading, financeSnapshot]);

  const totalIn = Number(financeSnapshot?.summary?.month_cash ?? paidThisMonth.reduce((s, i) => s + cashReceived(i), 0));

  // Biaya sah = bukan menunggu approval Admin (≥500rb) & bukan draft AI belum di-review.
  const expensesBulanIni = useMemo(() => detailsLoading ? [] : (financeSnapshot?.month_expenses ||
    (allExpenses || []).filter(e => e.approval_status !== "PENDING_APPROVAL" && e.validation_status !== "PENDING_AI" && (e.date || e.created_at || "").slice(0, 7) === bulanIni
  )), [allExpenses, bulanIni, detailsLoading, financeSnapshot]);

  const totalOut = Number(financeSnapshot?.summary?.month_expenses ?? expensesBulanIni.reduce((s, e) => s + (e.amount || 0), 0));

  const totalInAll = Number(financeSnapshot?.summary?.cash_all_time ?? (allInvoices || []).reduce((s, i) => s + cashReceived(i), 0));

  const totalOutAll = Number(financeSnapshot?.summary?.expenses_all_time ?? (allExpenses || []).reduce((s, e) => s + ((e.approval_status === "PENDING_APPROVAL" || e.validation_status === "PENDING_AI") ? 0 : (e.amount || 0)), 0));

  const netProfit = totalIn - totalOut;
  const netProfitAll = totalInAll - totalOutAll;
  const pct = targetBulan > 0 ? (totalIn / targetBulan) * 100 : 0;
  const pctBar = Math.min(100, pct);
  const unpaidCount = Number(financeSnapshot?.summary?.unpaid_count ?? (allInvoices || []).filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length);
  const overdueCount = Number(financeSnapshot?.summary?.overdue_count ?? (allInvoices || []).filter(i => i.status === "OVERDUE").length);

  // Breakdown pengeluaran bulan ini by subcategory (data real dari DB)
  const topExpenses = useMemo(() => {
    if (financeSnapshot?.top_expenses) return financeSnapshot.top_expenses.map(x => [x.name, Number(x.total || 0)]).slice(0,5);
    const acc = {};
    expensesBulanIni.forEach(e => {
      const kat = e.subcategory || e.category || "Lain-lain";
      acc[kat] = (acc[kat] || 0) + (e.amount || 0);
    });
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [expensesBulanIni, financeSnapshot]);

  // ── Export Arus Kas bulan ini (CSV + PDF) ──
  const exportArusKasCsv = () => {
    const R = [];
    R.push(["Periode", bulanLabel]);
    R.push(["Dicetak", fmtTanggal(new Date())]);
    R.push([]);
    R.push(["RINGKASAN ARUS KAS"]);
    R.push(["Keterangan", "Nilai (Rp)"]);
    R.push(["Kas Masuk (PAID bulan ini)", Math.round(totalIn)]);
    R.push(["Kas Keluar (Biaya bulan ini)", Math.round(totalOut)]);
    R.push(["Kas Bersih (Bulan Ini)", Math.round(netProfit)]);
    R.push(["Kas Bersih All-Time", Math.round(netProfitAll)]);
    R.push([]);
    R.push(["KAS MASUK — RINCIAN"]);
    R.push(["Tanggal", "Customer", "Layanan", "Status", "Diterima (Rp)"]);
    [...paidThisMonth].sort((a, b) => (b.paid_at || b.created_at || "").localeCompare(a.paid_at || a.created_at || ""))
      .forEach(i => R.push([(i.paid_at || i.created_at || "").slice(0, 10), i.customer || "", i.service || "", i.status, cashReceived(i)]));
    R.push([]);
    R.push(["KAS KELUAR — RINCIAN"]);
    R.push(["Tanggal", "Kategori", "Subkategori", "Keterangan", "Nominal (Rp)"]);
    [...expensesBulanIni].sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .forEach(e => R.push([e.date || "", e.category || "", e.subcategory || "", (e.description || "").replace(/\s+/g, " ").trim(), Number(e.amount || 0)]));
    downloadBlob(buildCsv(["ARUS KAS ACLEAN"], R), `arus-kas_${bulanIni}.csv`, "text/csv;charset=utf-8");
    showNotif?.("✅ CSV arus kas diunduh");
  };

  const exportArusKasPdf = () => {
    const card = (lbl, val, clsv = "") => `<div class="card"><div class="lbl">${escapeHtml(lbl)}</div><div class="val ${clsv}">${val}</div></div>`;
    const cards = `<div class="cards">
      ${card("Kas Masuk", rp(totalIn), "pos")}
      ${card("Kas Keluar", rp(totalOut), "neg")}
      ${card("Net Bulan Ini", rp(netProfit), netProfit >= 0 ? "pos" : "neg")}
      ${card("Margin", totalIn > 0 ? ((netProfit / totalIn) * 100).toFixed(1) + "%" : "—")}
    </div>`;
    const ringkas = htmlTable(["Keterangan", "Jumlah"], [
      ["Kas Masuk (PAID bulan ini)", `<span class="pos">${rp(totalIn)}</span>`],
      ["Kas Keluar (Biaya bulan ini)", `<span class="neg">− ${rp(totalOut)}</span>`],
      ["Kas Bersih All-Time", rp(netProfitAll)],
    ], { colClass: ["", "r"], footer: ["Net (Bulan Ini)", `<span class="${netProfit >= 0 ? "pos" : "neg"}">${rp(netProfit)}</span>`] });
    const outByCat = {};
    expensesBulanIni.forEach(e => { const k = e.subcategory || e.category || "Lain-lain"; outByCat[k] = (outByCat[k] || 0) + Number(e.amount || 0); });
    const outRows = Object.entries(outByCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => [escapeHtml(k), rp(v)]);
    const outTable = htmlTable(["Kategori Pengeluaran", "Total"], outRows, { colClass: ["", "r"], footer: ["TOTAL KELUAR", rp(totalOut)] });
    const inRows = [...paidThisMonth].sort((a, b) => (b.paid_at || b.created_at || "").localeCompare(a.paid_at || a.created_at || ""))
      .map(i => [fmtTanggal(i.paid_at || i.created_at), escapeHtml(i.customer || "-"), escapeHtml(i.service || "-"), escapeHtml(i.status), rp(cashReceived(i))]);
    const inTable = inRows.length === 0 ? "<p class='muted'>Belum ada kas masuk bulan ini.</p>"
      : htmlTable(["Tanggal", "Customer", "Layanan", "Status", "Diterima"], inRows, { colClass: ["", "", "", "c", "r"], footer: ["", "", "", "TOTAL MASUK", rp(totalIn)] });
    printDocument({
      title: "Laporan Arus Kas — AClean",
      subtitle: `Periode: ${bulanLabel} · Dicetak ${fmtTanggal(new Date())}`,
      legend: "Kas masuk = pembayaran invoice yang diterima (LUNAS / cicilan) pada bulan ini. Kas keluar = biaya tercatat yang sudah lolos approval. Kas bersih bukan laba akuntansi final.",
      bodyHtml: `${cards}<h2 class="sec">Ringkasan</h2>${ringkas}<h2 class="sec">Kas Keluar per Kategori</h2>${outTable}<h2 class="sec">Rincian Kas Masuk (${paidThisMonth.length})</h2>${inTable}`,
      signature: true,
      showNotif,
    });
    showNotif?.("🖨️ Menyiapkan PDF arus kas…");
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {detailsLoading && <div style={{ padding: "10px 14px", borderRadius: 11, background: cs.accent + "12", border: "1px solid " + cs.accent + "33", color: cs.accent, fontSize: 12 }}>⏳ Memuat rincian keuangan {bulanLabel}… angka transaksi akan tampil setelah pemuatan selesai.</div>}

      <section style={{ background: "linear-gradient(135deg," + cs.card + "," + cs.accent + "12 75%," + cs.ara + "12)", border: "1px solid " + cs.accent + "44", borderRadius: 18, padding: "20px 22px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <div style={{ color: cs.accent, fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>Financial Planning</div>
            <h2 style={{ margin: "5px 0 4px", fontSize: 21, color: cs.text }}>Rencana & arus kas · {bulanLabel}</h2>
            <div style={{ color: cs.muted, fontSize: 12 }}>Pantau target pemasukan, uang yang benar-benar diterima, biaya tercatat, dan piutang.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={exportArusKasPdf} disabled={detailsLoading} style={{ background: cs.surface, border: "1px solid " + cs.border, color: cs.text, padding: "9px 13px", borderRadius: 10, cursor: detailsLoading ? "wait" : "pointer", opacity: detailsLoading ? 0.55 : 1, fontWeight: 700, fontSize: 12 }}>🖨️ Cetak PDF</button>
            <button onClick={exportArusKasCsv} disabled={detailsLoading} style={{ background: cs.surface, border: "1px solid " + cs.border, color: cs.text, padding: "9px 13px", borderRadius: 10, cursor: detailsLoading ? "wait" : "pointer", opacity: detailsLoading ? 0.55 : 1, fontWeight: 700, fontSize: 12 }}>⬇️ Unduh CSV</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", alignItems: "end", gap: 18 }}>
          <div>
            <label htmlFor="finance-month-target" style={{ display: "block", color: cs.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, marginBottom: 7 }}>Target pemasukan kas</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 330, padding: "10px 12px", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 11 }}>
              <span style={{ color: cs.muted, fontSize: 13 }}>Rp</span>
              <input id="finance-month-target" type="number" min="0" step="1000000" value={targetBulan} onChange={e => handleTargetChange(e.target.value)} aria-label="Target pemasukan kas bulan ini" style={{ width: "100%", minWidth: 0, background: "transparent", border: 0, outline: 0, color: cs.text, fontSize: 18, fontWeight: 800 }} />
            </div>
            <div style={{ color: cs.muted, fontSize: 11, marginTop: 6 }}>Tersimpan otomatis di perangkat ini.</div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
              <span style={{ color: cs.muted, fontSize: 12 }}>Kas masuk bulan ini</span>
              <b style={{ color: pct >= 100 ? cs.green : cs.accent, fontSize: 13 }}>{targetBulan > 0 ? `${pct.toFixed(1)}% tercapai` : "Target belum diisi"}</b>
            </div>
            <div style={{ height: 11, borderRadius: 99, background: cs.surface, overflow: "hidden", border: "1px solid " + cs.border }}>
              <div style={{ width: pctBar + "%", height: "100%", background: pct >= 100 ? "linear-gradient(90deg," + cs.green + ",#16a34a)" : "linear-gradient(90deg," + cs.accent + "," + cs.ara + ")", borderRadius: 99, transition: "width .45s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 7, fontSize: 12 }}>
              <b style={{ color: cs.text }}>{fmtRp(totalIn)}</b>
              <span style={{ color: cs.muted }}>{pct >= 100 ? "Target tercapai" : `Sisa ${fmtRp(Math.max(0, targetBulan - totalIn))}`}</span>
            </div>
          </div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 11 }}>
        {[
          { label: "Kas masuk", value: fmtRp(totalIn), detail: `${paidThisMonth.length} invoice PAID / cicilan`, color: cs.green, icon: "↙" },
          { label: "Biaya tercatat", value: fmtRp(totalOut), detail: `${expensesBulanIni.length} transaksi disetujui`, color: cs.red, icon: "↗" },
          { label: "Kas bersih", value: fmtRp(netProfit), detail: "Kas masuk dikurangi biaya tercatat", color: netProfit >= 0 ? cs.green : cs.red, icon: "＝" },
          { label: "Piutang aktif", value: `${unpaidCount} invoice`, detail: `${overdueCount} sudah jatuh tempo`, color: overdueCount ? cs.red : cs.yellow, icon: "◷" },
        ].map((item) => (
          <div key={item.label} style={{ position: "relative", overflow: "hidden", background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: "15px 16px" }}>
            <div style={{ position: "absolute", right: 14, top: 11, color: item.color + "55", fontSize: 25, fontWeight: 900 }}>{item.icon}</div>
            <div style={{ color: cs.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: .45 }}>{item.label}</div>
            <div style={{ color: item.color, fontSize: 20, fontWeight: 850, lineHeight: 1.2, margin: "8px 0 5px", overflowWrap: "anywhere" }}>{item.value}</div>
            <div style={{ color: cs.muted, fontSize: 11 }}>{item.detail}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: 14 }}>
        <section style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 15, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", marginBottom: 14 }}>
            <div><div style={{ fontSize: 14, fontWeight: 800, color: cs.text }}>💸 Pengeluaran terbesar</div><div style={{ color: cs.muted, fontSize: 11, marginTop: 3 }}>Berdasarkan kategori biaya {bulanLabel}.</div></div>
            <Badge color={cs.red} bg={cs.red + "12"} border={cs.red + "33"}>{expensesBulanIni.length} transaksi</Badge>
          </div>
          {topExpenses.length === 0 ? (
            <div style={{ border: "1px dashed " + cs.border, borderRadius: 11, padding: "24px 14px", textAlign: "center", color: cs.muted, fontSize: 12 }}>{detailsLoading ? "Menyiapkan rincian biaya…" : "Belum ada biaya disetujui pada periode ini."}</div>
          ) : topExpenses.map(([kat, total]) => {
            const pctOut = totalOut > 0 ? (total / totalOut * 100) : 0;
            return <div key={kat} style={{ marginBottom: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: cs.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kat}</span>
                <span style={{ color: cs.red, fontWeight: 800, whiteSpace: "nowrap" }}>{fmtRp(total)} <small style={{ color: cs.muted, fontWeight: 500 }}>({pctOut.toFixed(0)}%)</small></span>
              </div>
              <div style={{ height: 7, background: cs.surface, borderRadius: 99, overflow: "hidden" }}><div style={{ height: "100%", width: Math.min(100, pctOut) + "%", background: "linear-gradient(90deg," + cs.red + ",#b91c1c)", borderRadius: 99 }} /></div>
            </div>;
          })}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid " + cs.border, paddingTop: 11, marginTop: 4, fontSize: 12 }}><span style={{ color: cs.muted }}>Total biaya periode</span><b style={{ color: cs.red }}>{fmtRp(totalOut)}</b></div>
        </section>

        <section style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 15, padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: cs.text, marginBottom: 3 }}>🧭 Tindak lanjut keuangan</div>
          <div style={{ color: cs.muted, fontSize: 11, marginBottom: 13 }}>Ringkasan untuk membantu menentukan aksi berikutnya.</div>
          <div style={{ display: "grid", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, padding: 11, background: (overdueCount ? cs.red : cs.green) + "0d", border: "1px solid " + (overdueCount ? cs.red : cs.green) + "30", borderRadius: 11 }}>
              <span style={{ fontSize: 19 }}>{overdueCount ? "🚨" : "✅"}</span><div><b style={{ display: "block", color: overdueCount ? cs.red : cs.green, fontSize: 12 }}>{overdueCount ? `${overdueCount} invoice perlu follow-up` : "Tidak ada invoice overdue"}</b><span style={{ color: cs.muted, fontSize: 11 }}>{unpaidCount} invoice masih belum lunas secara total.</span></div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 11, padding: 11, background: cs.accent + "0d", border: "1px solid " + cs.accent + "30", borderRadius: 11 }}>
              <span style={{ fontSize: 19 }}>🏦</span><div><b style={{ display: "block", color: cs.accent, fontSize: 12 }}>Rekonsiliasi kas</b><span style={{ color: cs.muted, fontSize: 11 }}>Cocokkan penerimaan invoice PAID/cicilan dengan mutasi rekening.</span></div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 11, padding: 11, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 11 }}>
              <span style={{ fontSize: 19 }}>🛟</span><div><b style={{ display: "block", color: cs.text, fontSize: 12 }}>Ruang alokasi saving (indikatif)</b><span style={{ color: cs.muted, fontSize: 11 }}>20% dari kas bersih positif: <b style={{ color: cs.green }}>{fmtRp(Math.max(0, Math.round(netProfit * 0.2)))}</b>.</span></div>
            </div>
          </div>
        </section>
      </div>

      <section style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 13, padding: "12px 15px", color: cs.muted, fontSize: 11, lineHeight: 1.55 }}>
        <b style={{ color: cs.text }}>Cara membaca angka:</b> Kas masuk memakai pembayaran yang diterima pada bulan ini (termasuk cicilan). Biaya hanya menghitung transaksi yang sudah lolos approval. <b style={{ color: cs.text }}>Kas bersih bukan laba akuntansi final</b>; biaya stok terpakai, kewajiban yang belum dicatat, dan penyesuaian lain bisa membuat laba sebenarnya berbeda.
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", marginTop: 8 }}>
          <span>All-time kas masuk <b style={{ color: cs.green }}>{fmtRp(totalInAll)}</b></span>
          <span>All-time biaya <b style={{ color: cs.red }}>{fmtRp(totalOutAll)}</b></span>
          <span>All-time kas bersih <b style={{ color: netProfitAll >= 0 ? cs.green : cs.red }}>{fmtRp(netProfitAll)}</b></span>
          <span>Margin kas bulan ini <b style={{ color: cs.accent }}>{totalIn > 0 ? ((netProfit / totalIn) * 100).toFixed(1) + "%" : "—"}</b></span>
        </div>
      </section>
    </div>
  );
};

// ─── Modal Bukti Bayar ───────────────────────────────────────────
const ProofModal = ({ modal, onClose }) => {
  if (!modal) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div
        style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 16, padding: 24, maxWidth: 500, width: "90%", maxHeight: "85vh", overflow: "auto" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>📎 Bukti Pembayaran</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 14 }}>{modal.customer}</div>
        {modal.url && modal.url !== "verified-no-proof" ? (
          <img src={modal.url} alt="Bukti bayar" style={{ width: "100%", borderRadius: 8, objectFit: "contain", maxHeight: 500 }} />
        ) : (
          <div style={{ textAlign: "center", color: cs.muted, padding: "40px 0", fontSize: 13 }}>
            {modal.url === "verified-no-proof"
              ? "✅ Dikonfirmasi secara manual oleh admin"
              : "Belum ada bukti yang diupload"}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main FinanceView ─────────────────────────────────────────────
export default function FinanceView({ currentUser, ordersData, invoicesData, expensesData, supabase, teknisiData, showNotif, showConfirm, openWA, TODAY }) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [paymentProofModal, setPaymentProofModal] = useState(null);
  const [dateOffset, setDateOffset] = useState(0);

  const allInv = invoicesData || [];
  const allExp = expensesData || [];
  const [financeSnapshot, setFinanceSnapshot] = useState(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeDetailsLoading, setFinanceDetailsLoading] = useState(false);
  const [financeError, setFinanceError] = useState(null);

  // Gunakan WIB helper — bukan toISOString() mentah yang UTC
  const todayStr = useMemo(() => getWIBDateStr(dateOffset), [dateOffset]);
  const currentDate = useMemo(() => getWIBDateLabel(dateOffset), [dateOffset]);
  const currentMonth = getLocalDate().slice(0, 7);
  const monthStart = `${currentMonth}-01`;
  const monthEnd = useMemo(() => {
    const [year, month] = currentMonth.split("-").map(Number);
    return `${currentMonth}-${String(new Date(year, month, 0).getDate()).padStart(2,"0")}`;
  }, [currentMonth]);

  useEffect(() => {
    if (!supabase) return;
    const key = `${todayStr}:${monthStart}:${monthEnd}`;
    const cached = financeCache.get(key);
    if (cached && Date.now() - cached.at < FINANCE_CACHE_MS) {
      setFinanceSnapshot(cached.data); setFinanceError(null); return;
    }
    let cancelled = false;
    setFinanceLoading(true); setFinanceError(null);
    measureAsync("finance.summary_v2", () => fetchFinanceSummaryV2(supabase, todayStr, monthStart, monthEnd), { role: currentUser?.role || "Finance" })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          const unavailable = /get_finance_summary_v2|schema cache|could not find the function/i.test(error.message || "");
          if (!unavailable) throw error;
          return fetchFinanceSnapshot(supabase, todayStr, monthStart, monthEnd).then(legacy => {
            if (legacy.error) throw legacy.error;
            return { data: { ...(legacy.data || {}), _detailsLoaded: true } };
          });
        }
        return { data: { ...(data || {}), _detailsLoaded: false } };
      })
      .then(result => {
        if (cancelled || !result) return;
        financeCache.set(key, { at: Date.now(), data: result.data });
        setFinanceSnapshot(result.data || null);
        void flushPerfMetrics(supabase, currentUser?.role || "Finance");
      })
      .catch(error => {
        if (!cancelled) { setFinanceSnapshot(null); setFinanceError(error?.message || "Finance gagal dimuat"); }
      })
      .finally(() => { if (!cancelled) setFinanceLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser?.role, supabase, todayStr, monthStart, monthEnd]);

  useEffect(() => {
    if (!supabase || activeTab !== "planning" || financeSnapshot?._detailsLoaded) return;
    let cancelled = false;
    setFinanceDetailsLoading(true);
    setFinanceError(null);
    measureAsync("finance.month_details", () => fetchFinanceMonthDetails(supabase, monthStart, monthEnd), { role: currentUser?.role || "Finance" })
      .then(({ data, error }) => {
        if (error) throw error;
        if (cancelled) return;
        const merged = { ...(financeSnapshot || {}), ...(data || {}), _detailsLoaded: true };
        const key = `${todayStr}:${monthStart}:${monthEnd}`;
        financeCache.set(key, { at: Date.now(), data: merged });
        setFinanceSnapshot(merged);
        void flushPerfMetrics(supabase, currentUser?.role || "Finance");
      })
      .catch(error => { if (!cancelled) setFinanceError(error?.message || "Rincian Finance gagal dimuat"); })
      .finally(() => { if (!cancelled) setFinanceDetailsLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, currentUser?.role, financeSnapshot, monthEnd, monthStart, supabase, todayStr]);

  const filteredOrders = useMemo(() =>
    (ordersData || []).filter(o => (o.date || "").slice(0, 10) === todayStr),
    [ordersData, todayStr]);

  const filteredInvoices = useMemo(() => {
    const orderIds = new Set(filteredOrders.map(o => o.id));
    return (invoicesData || []).filter(i => orderIds.has(i.job_id));
  }, [invoicesData, filteredOrders]);

  return (
    <div style={{ color: cs.text, fontFamily: "system-ui,-apple-system,sans-serif" }}>
      {/* Header greeting */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: cs.text }}>
            💰 Finance Dashboard
          </div>
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>
            Selamat datang, <span style={{ color: cs.accent, fontWeight: 600 }}>{currentUser?.name || "Finance"}</span>
            {" · "}{getLocalDate()}
          </div>
        </div>
        <div style={{ fontSize: 11, color: cs.muted, textAlign: "right" }}>
          {Number(financeSnapshot?.summary?.paid_count ?? allInv.filter(i => i.status === "PAID").length)} invoice PAID
          {" · "}{Number(financeSnapshot?.summary?.unpaid_count ?? allInv.filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length)} belum lunas
        </div>
      </div>

      {(financeLoading || financeError) && (
        <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 9, fontSize: 11,
          color: financeError ? cs.yellow : cs.accent,
          background: (financeError ? cs.yellow : cs.accent) + "12",
          border: "1px solid " + (financeError ? cs.yellow : cs.accent) + "33" }}>
          {financeError ? `⚠️ Snapshot Finance belum tersedia — sementara memakai data lokal: ${financeError}` : "⏳ Menghitung Finance di database…"}
        </div>
      )}

      {/* Tab Bar */}
      <div style={{ display: "flex", gap: 2, marginBottom: 18, borderBottom: "1px solid " + cs.border, overflowX: "auto" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: "10px 18px", cursor: "pointer", fontWeight: 600, fontSize: 13,
              background: "transparent", border: "none", whiteSpace: "nowrap",
              borderBottom: "2px solid " + (activeTab === t.id ? cs.accent : "transparent"),
              color: activeTab === t.id ? cs.accent : cs.muted,
              marginBottom: -1, transition: "color 0.15s",
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === "dashboard" && (
        <DashboardTab
          ordersData={filteredOrders}
          invoicesData={filteredInvoices}
          allInvoices={allInv}
          todayStr={todayStr}
          currentDate={currentDate}
          onPrevDay={() => setDateOffset(d => d - 1)}
          onNextDay={() => setDateOffset(d => d + 1)}
          onToday={() => setDateOffset(0)}
          setPaymentProofModal={setPaymentProofModal}
          currentUser={currentUser}
          supabase={supabase}
          financeSnapshot={financeSnapshot}
        />
      )}
      {activeTab === "planning" && (
        <PlanningTab
          allInvoices={allInv}
          allExpenses={allExp}
          showNotif={showNotif}
          financeSnapshot={financeSnapshot}
          detailsLoading={financeDetailsLoading}
        />
      )}

      {activeTab === "payroll" && (
        <GajiTab
          teknisiData={teknisiData || []}
          ordersData={ordersData || []}
          invoicesData={invoicesData || []}
          currentUser={currentUser}
          supabase={supabase}
          showNotif={showNotif}
          showConfirm={showConfirm}
          openWA={openWA}
          TODAY={TODAY || getLocalDate()}
        />
      )}

      <ProofModal modal={paymentProofModal} onClose={() => setPaymentProofModal(null)} />
    </div>
  );
}
