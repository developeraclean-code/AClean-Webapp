import { useState, useMemo, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { getLocalDate } from "../lib/dateTime.js";
import { GajiTab } from "./TeknisiAdminView.jsx";

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
const saveTarget = (v) => { try { localStorage.setItem(LS_KEY, String(v)); } catch { } };

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "planning", label: "Financial Planning", icon: "🎯" },
  { id: "payroll", label: "Pengelolaan Gaji", icon: "💵" },
];

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
  setPaymentProofModal, currentUser, supabase,
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

  // Stat konteks: hari ini (rows) vs all-time (allInvoices)
  const todayPaid = rows.filter(r => r.inv?.status === "PAID");
  const todayPemasukan = todayPaid.reduce((s, r) => s + (r.inv?.total || 0), 0);
  const todayBelumLunas = rows.filter(r => r.inv && (r.inv.status === "UNPAID" || r.inv.status === "OVERDUE")).length;
  const todayPendingAPV = rows.filter(r => r.inv && (r.inv.status || "").toUpperCase().includes("PENDING")).length;
  const belumMutasi = rows.filter(r => r.inv?.status === "PAID" && !mutasiChecked[r.order?.id]?.checked).length;

  // All-time untuk referensi
  const allTimePaid = (allInvoices || []).filter(i => i.status === "PAID").reduce((s, i) => s + (i.total || 0), 0);
  const allUnpaid = (allInvoices || []).filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length;

  return (
    <div>
      {/* Date Navigator */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <button onClick={onPrevDay} style={{ width: 32, height: 32, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, cursor: "pointer", fontSize: 14 }}>◀</button>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>📅 {currentDate}</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
            {rows.length} order · {todayPaid.length} lunas · {todayBelumLunas} belum lunas
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
        <StatCard value={fmtRp(todayPemasukan)} label="Pemasukan Hari Ini" color={cs.green} sub={todayPaid.length + " invoice PAID"} />
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
          <span style={{ color: cs.muted }}>{rows.length} order · {todayPaid.length} PAID · {belumMutasi} belum mutasi</span>
          <span style={{ fontWeight: 700, color: cs.green }}>{fmtRp(todayPemasukan)}</span>
        </div>
      )}
    </div>
  );
};

// ─── Financial Planning Tab ──────────────────────────────────────
const PlanningTab = ({ allInvoices, allExpenses }) => {
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

  const paidThisMonth = useMemo(() =>
    (allInvoices || []).filter(i =>
      i.status === "PAID" && (i.paid_at || i.created_at || "").slice(0, 7) === bulanIni
    ), [allInvoices, bulanIni]);

  const totalIn = useMemo(() =>
    paidThisMonth.reduce((s, i) => s + (i.total || 0), 0),
    [paidThisMonth]);

  const expensesBulanIni = useMemo(() =>
    (allExpenses || []).filter(e => (e.date || e.created_at || "").slice(0, 7) === bulanIni),
    [allExpenses, bulanIni]);

  const totalOut = useMemo(() =>
    expensesBulanIni.reduce((s, e) => s + (e.amount || 0), 0),
    [expensesBulanIni]);

  const totalInAll = useMemo(() =>
    (allInvoices || []).filter(i => i.status === "PAID").reduce((s, i) => s + (i.total || 0), 0),
    [allInvoices]);

  const totalOutAll = useMemo(() =>
    (allExpenses || []).reduce((s, e) => s + (e.amount || 0), 0),
    [allExpenses]);

  const netProfit = totalIn - totalOut;
  const netProfitAll = totalInAll - totalOutAll;
  const pct = targetBulan > 0 ? Math.min(100, (totalIn / targetBulan) * 100) : 0;
  const unpaidCount = useMemo(() =>
    (allInvoices || []).filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length,
    [allInvoices]);
  const overdueCount = useMemo(() =>
    (allInvoices || []).filter(i => i.status === "OVERDUE").length,
    [allInvoices]);

  // Breakdown pengeluaran bulan ini by subcategory (data real dari DB)
  const topExpenses = useMemo(() => {
    const acc = {};
    expensesBulanIni.forEach(e => {
      const kat = e.subcategory || e.category || "Lain-lain";
      acc[kat] = (acc[kat] || 0) + (e.amount || 0);
    });
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [expensesBulanIni]);

  return (
    <div>
      {/* Target Progress */}
      <div style={{ background: "linear-gradient(135deg," + cs.accent + "12," + cs.ara + "08)", border: "1px solid " + cs.accent + "33", borderRadius: 12, padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
              Target Pemasukan — {bulanLabel} <span style={{ color: cs.accent }}>(klik untuk edit)</span>
            </div>
            <input
              type="number"
              value={targetBulan}
              onChange={e => handleTargetChange(e.target.value)}
              style={{ background: "transparent", border: "none", color: cs.accent, fontSize: 20, fontWeight: 700, width: 240, outline: "none" }} />
            <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Target tersimpan otomatis</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Tercapai Bulan Ini</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: cs.green }}>{fmtRp(totalIn)}</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{pct.toFixed(1)}% dari target · {paidThisMonth.length} invoice</div>
          </div>
        </div>
        <div style={{ height: 8, background: cs.surface, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: pct + "%", background: pct >= 100 ? "linear-gradient(90deg," + cs.green + ",#16a34a)" : "linear-gradient(90deg," + cs.accent + "," + cs.ara + ")", borderRadius: 4, transition: "width 0.5s" }} />
        </div>
        <div style={{ fontSize: 11, color: cs.muted, marginTop: 6 }}>
          Sisa target: {fmtRp(Math.max(0, targetBulan - totalIn))}
          {pct >= 100 && <span style={{ color: cs.green, fontWeight: 700, marginLeft: 8 }}>🎉 Target tercapai!</span>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 14 }}>
        {/* Ringkasan Keuangan */}
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📊 Ringkasan — {bulanLabel}</div>
          {[
            { label: "Pemasukan PAID", value: fmtRp(totalIn), color: cs.green },
            { label: "Pengeluaran", value: fmtRp(totalOut), color: cs.red },
            { label: "Net Profit Bulan Ini", value: fmtRp(netProfit), color: netProfit >= 0 ? cs.green : cs.red },
            { label: "Profit Margin", value: totalIn > 0 ? ((netProfit / totalIn) * 100).toFixed(1) + "%" : "—", color: cs.accent },
          ].map(r => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid " + cs.border + "80" }}>
              <span style={{ fontSize: 12, color: cs.muted }}>{r.label}</span>
              <span style={{ fontWeight: 700, color: r.color, fontSize: 13 }}>{r.value}</span>
            </div>
          ))}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid " + cs.border }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: cs.muted }}>Net Profit All-Time</span>
              <span style={{ fontWeight: 700, color: netProfitAll >= 0 ? cs.green : cs.red }}>{fmtRp(netProfitAll)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 6 }}>
              <span style={{ color: cs.muted }}>Total Pengeluaran All-Time</span>
              <span style={{ fontWeight: 700, color: cs.red }}>{fmtRp(totalOutAll)}</span>
            </div>
          </div>
        </div>

        {/* Top Pengeluaran Bulan Ini */}
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>💸 Top Pengeluaran — {bulanLabel}</div>
          {topExpenses.length === 0 ? (
            <div style={{ color: cs.muted, fontSize: 13, textAlign: "center", padding: "28px 0" }}>
              Belum ada pengeluaran bulan ini
            </div>
          ) : topExpenses.map(([kat, total]) => {
            const pctOut = totalOut > 0 ? (total / totalOut * 100) : 0;
            return (
              <div key={kat} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: cs.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>{kat}</span>
                  <span style={{ color: cs.red, fontWeight: 700 }}>
                    {fmtRp(total)} <span style={{ color: cs.muted, fontWeight: 400 }}>({pctOut.toFixed(0)}%)</span>
                  </span>
                </div>
                <div style={{ height: 6, background: cs.surface, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: Math.min(100, pctOut) + "%", background: "linear-gradient(90deg," + cs.red + ",#b91c1c)", borderRadius: 4 }} />
                </div>
              </div>
            );
          })}
          {expensesBulanIni.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid " + cs.border + "80", fontSize: 12, display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: cs.muted }}>{expensesBulanIni.length} transaksi</span>
              <span style={{ fontWeight: 700, color: cs.red }}>{fmtRp(totalOut)} total</span>
            </div>
          )}
        </div>
      </div>

      {/* Rekomendasi Finance */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>💡 Rekomendasi Finance</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <div style={{ background: pct >= 100 ? cs.green + "0d" : cs.accent + "0d", border: "1px solid " + (pct >= 100 ? cs.green : cs.accent) + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: pct >= 100 ? cs.green : cs.accent, fontSize: 13, marginBottom: 4 }}>
              {pct >= 100 ? "🎉 Target Tercapai!" : "📈 Progress Target"}
            </div>
            <div style={{ fontSize: 12, color: cs.muted }}>
              {pct.toFixed(1)}% dari target {bulanLabel}. {pct >= 100 ? "Luar biasa!" : "Terus tingkatkan performa."}
            </div>
          </div>
          <div style={{ background: cs.accent + "0d", border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: cs.accent, fontSize: 13, marginBottom: 4 }}>💰 Sisihkan Saving</div>
            <div style={{ fontSize: 12, color: cs.muted }}>
              20% dari net profit = {fmtRp(Math.max(0, Math.round(netProfit * 0.2)))} untuk dana darurat.
            </div>
          </div>
          <div style={{ background: overdueCount > 0 ? cs.red + "0d" : cs.yellow + "0d", border: "1px solid " + (overdueCount > 0 ? cs.red : cs.yellow) + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: overdueCount > 0 ? cs.red : cs.yellow, fontSize: 13, marginBottom: 4 }}>
              {overdueCount > 0 ? "🚨 Ada Invoice Overdue!" : "⚠️ Piutang Beredar"}
            </div>
            <div style={{ fontSize: 12, color: cs.muted }}>
              {unpaidCount} UNPAID · {overdueCount} OVERDUE. Lakukan follow-up segera.
            </div>
          </div>
          <div style={{ background: cs.ara + "0d", border: "1px solid " + cs.ara + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: cs.ara, fontSize: 13, marginBottom: 4 }}>📋 Cek Mutasi Rutin</div>
            <div style={{ fontSize: 12, color: cs.muted }}>
              Verifikasi semua invoice PAID di rekening setiap hari kerja.
            </div>
          </div>
        </div>
      </div>
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

  // Gunakan WIB helper — bukan toISOString() mentah yang UTC
  const todayStr = useMemo(() => getWIBDateStr(dateOffset), [dateOffset]);
  const currentDate = useMemo(() => getWIBDateLabel(dateOffset), [dateOffset]);

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
          {(invoicesData || []).filter(i => i.status === "PAID").length} invoice PAID
          {" · "}{(invoicesData || []).filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length} belum lunas
        </div>
      </div>

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
          allInvoices={invoicesData}
          todayStr={todayStr}
          currentDate={currentDate}
          onPrevDay={() => setDateOffset(d => d - 1)}
          onNextDay={() => setDateOffset(d => d + 1)}
          onToday={() => setDateOffset(0)}
          setPaymentProofModal={setPaymentProofModal}
          currentUser={currentUser}
          supabase={supabase}
        />
      )}
      {activeTab === "planning" && (
        <PlanningTab
          allInvoices={invoicesData}
          allExpenses={expensesData}
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
