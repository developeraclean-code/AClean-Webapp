import { useState, useMemo, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";

// supabase prop dipass dari App.jsx (tidak bikin client baru)

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "planning", label: "Financial Planning", icon: "🎯" },
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
const DashboardTab = ({ ordersData, invoicesData, allInvoices, currentDate, onPrevDay, onNextDay, onToday, setPaymentProofModal, currentUser, supabase }) => {
  const [mutasiChecked, setMutasiChecked] = useState({});
  const [mutasiLoading, setMutasiLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);

  const loadMutasi = useCallback(async () => {
    if (!supabase) return;
    setMutasiLoading(true);
    try {
      const { data } = await supabase
        .from("mutasi_checklist")
        .select("id, job_id, invoice_id, checked, checked_by, checked_at, notes");
      if (data) {
        const map = {};
        data.forEach(r => { map[r.job_id] = r; });
        setMutasiChecked(map);
      }
    } catch (e) {
      console.warn("mutasi_checklist load failed:", e?.message);
    }
    setMutasiLoading(false);
  }, [supabase]);

  useEffect(() => { loadMutasi(); }, [loadMutasi]);

  const toggleMutasi = async (jobId, invoiceId) => {
    if (savingId) return; // prevent race condition
    const current = mutasiChecked[jobId];
    const newChecked = current ? !current.checked : true;
    setSavingId(jobId);

    try {
      if (current?.id) {
        await supabase.from("mutasi_checklist").update({
          checked: newChecked,
          checked_by: currentUser?.name || "Finance",
          checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", current.id);
      } else {
        await supabase.from("mutasi_checklist").insert({
          job_id: jobId,
          invoice_id: invoiceId || null,
          checked: newChecked,
          checked_by: currentUser?.name || "Finance",
          checked_at: new Date().toISOString(),
        });
      }
      setMutasiChecked(prev => ({
        ...prev,
        [jobId]: { ...(prev[jobId] || {}), checked: newChecked, checked_by: currentUser?.name || "Finance" },
      }));
    } catch (e) {
      console.warn("toggleMutasi error:", e?.message);
    }
    setSavingId(null);
  };

  const rows = useMemo(() => {
    return (ordersData || []).map(order => {
      const inv = (invoicesData || []).find(i => i.job_id === order.id);
      return { order, inv };
    });
  }, [ordersData, invoicesData]);

  const paidInvs = (allInvoices || []).filter(i => i.status === "PAID");
  const totalPemasukan = paidInvs.reduce((s, i) => s + (i.total || 0), 0);
  const belumLunas = (allInvoices || []).filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length;
  const pendingAPV = (allInvoices || []).filter(i => (i.status || "").toUpperCase().includes("PENDING")).length;
  const belumMutasi = rows.filter(r => r.inv?.status === "PAID" && !mutasiChecked[r.order?.id]?.checked).length;

  return (
    <div>
      {/* Date Navigator */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={onPrevDay} style={{ width: 32, height: 32, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, cursor: "pointer", fontSize: 14 }}>◀</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>📅 {currentDate}</div>
          <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
            {rows.length} order hari ini · {belumMutasi} belum cek mutasi
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onToday} style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "66", color: cs.accent, padding: "7px 14px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 12 }}>Hari Ini</button>
          <button onClick={onNextDay} style={{ width: 32, height: 32, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, cursor: "pointer", fontSize: 14 }}>▶</button>
        </div>
      </div>

      {/* Stat Cards — responsive grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 14 }}>
        <StatCard value={rows.length} label="Order Hari Ini" color={cs.accent} />
        <StatCard value={fmtRp(totalPemasukan)} label="Total Pemasukan" color={cs.green} sub={"All time PAID"} />
        <StatCard value={belumLunas} label="Belum Lunas" color={cs.yellow} />
        <StatCard value={pendingAPV} label="Pending APV" color={cs.ara} />
        <StatCard value={mutasiLoading ? "⟳" : belumMutasi} label="Belum Cek Mutasi" color={cs.red} sub={"Hari ini"} />
      </div>

      {/* Tabel */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, overflow: "auto" }}>
        <div style={{ minWidth: 700 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1.1fr 1fr 1fr 1fr 1fr 0.65fr", gap: 8, padding: "10px 16px", borderBottom: "1px solid " + cs.border, fontSize: 10, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            <div>Detail Job</div><div>Team</div><div>Status</div>
            <div>Invoice Value</div><div>Invoice Status</div><div>Bukti Bayar</div>
            <div style={{ textAlign: "center" }}>Cek Mutasi {mutasiLoading ? "⟳" : ""}</div>
          </div>

          {rows.length === 0 && (
            <div style={{ padding: "40px 16px", textAlign: "center", color: cs.muted, fontSize: 13 }}>
              Tidak ada order pada tanggal ini
            </div>
          )}

          {rows.map(({ order, inv }) => {
            const isPaid = inv?.status === "PAID";
            const hasProof = !!inv?.payment_proof_url && inv.payment_proof_url !== "verified-no-proof";
            const isVerifiedManual = inv?.payment_proof_url === "verified-no-proof";
            const isComplain = (order.service || "").toLowerCase().includes("complain");
            return (
              <div key={order.id} style={{ display: "grid", gridTemplateColumns: "1.7fr 1.1fr 1fr 1fr 1fr 1fr 0.65fr", gap: 8, padding: "13px 16px", borderBottom: "1px solid " + cs.border + "80", alignItems: "center" }}>
                {/* Job */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: isComplain ? cs.red : cs.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {order.customer}
                  </div>
                  <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
                    {order.service} · {order.units || 1} unit · {(order.time || "").slice(0, 5)}
                  </div>
                </div>
                {/* Team */}
                <div>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: cs.accent, display: "inline-block", marginRight: 6 }} />
                    {order.teknisi || "—"}
                  </div>
                  <div style={{ fontSize: 11, color: cs.muted, marginTop: 3 }}>
                    {order.helper ? "🪙 " + order.helper : "—"}
                  </div>
                </div>
                {/* Order Status */}
                <div>{orderStatusBadge(order.status)}</div>
                {/* Invoice Value */}
                <div style={{ fontWeight: 700, color: inv?.total ? cs.green : cs.muted, fontSize: 13 }}>
                  {inv?.total != null ? fmtRp(inv.total) : "—"}
                </div>
                {/* Invoice Status */}
                <div>{invStatusBadge(inv?.status)}</div>
                {/* Bukti Bayar */}
                <div>
                  {isPaid && hasProof ? (
                    <button
                      onClick={() => setPaymentProofModal({ url: inv.payment_proof_url, customer: order.customer })}
                      style={{ background: cs.accent + "18", border: "1px solid " + cs.accent + "66", color: cs.accent, padding: "5px 10px", borderRadius: 7, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                      📎 Lihat
                    </button>
                  ) : isPaid && isVerifiedManual ? (
                    <span style={{ fontSize: 11, color: "#0ea5e9", fontWeight: 600 }}>✅ Manual</span>
                  ) : isPaid ? (
                    <span style={{ fontSize: 11, color: cs.muted }}>📎 Belum upload</span>
                  ) : (
                    <span style={{ fontSize: 11, color: cs.border }}>—</span>
                  )}
                </div>
                {/* Cek Mutasi */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  {savingId === order.id ? (
                    <div style={{ width: 28, height: 28, borderRadius: 7, border: "2px solid " + cs.accent, background: cs.surface, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: cs.accent }}>⟳</div>
                  ) : (
                    <button
                      onClick={() => toggleMutasi(order.id, inv?.id)}
                      title={mutasiChecked[order.id]?.checked
                        ? "Dicek oleh " + (mutasiChecked[order.id]?.checked_by || "?") + " · klik untuk batal"
                        : "Klik untuk tandai sudah cek mutasi"}
                      style={{
                        width: 28, height: 28, borderRadius: 7,
                        border: "2px solid " + (mutasiChecked[order.id]?.checked ? cs.green : cs.border),
                        background: mutasiChecked[order.id]?.checked ? cs.green : cs.surface,
                        color: mutasiChecked[order.id]?.checked ? "#fff" : cs.muted,
                        cursor: "pointer", fontWeight: 700, fontSize: 15,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.15s",
                      }}>
                      {mutasiChecked[order.id]?.checked ? "✓" : "○"}
                    </button>
                  )}
                  {mutasiChecked[order.id]?.checked && mutasiChecked[order.id]?.checked_by && (
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
    </div>
  );
};

// ─── Financial Planning Tab ──────────────────────────────────────
const PlanningTab = ({ allInvoices, allExpenses }) => {
  const [targetBulan, setTargetBulan] = useState(100000000);

  // Ambil bulan berjalan
  const now = new Date();
  const bulanIni = now.toISOString().slice(0, 7); // "2026-05"

  const paidThisMonth = useMemo(() =>
    (allInvoices || []).filter(i => i.status === "PAID" && (i.paid_at || i.created_at || "").slice(0, 7) === bulanIni),
    [allInvoices, bulanIni]);

  const totalIn = paidThisMonth.reduce((s, i) => s + (i.total || 0), 0);
  const totalOut = useMemo(() =>
    (allExpenses || []).filter(e => (e.date || e.created_at || "").slice(0, 7) === bulanIni).reduce((s, e) => s + (e.amount || 0), 0),
    [allExpenses, bulanIni]);

  const totalInAll = (allInvoices || []).filter(i => i.status === "PAID").reduce((s, i) => s + (i.total || 0), 0);
  const totalOutAll = (allExpenses || []).reduce((s, e) => s + (e.amount || 0), 0);
  const netProfitAll = totalInAll - totalOutAll;

  const netProfit = totalIn - totalOut;
  const pct = targetBulan > 0 ? Math.min(100, (totalIn / targetBulan) * 100) : 0;
  const unpaidCount = (allInvoices || []).filter(i => i.status === "UNPAID" || i.status === "OVERDUE").length;
  const overdueCount = (allInvoices || []).filter(i => i.status === "OVERDUE").length;

  // Breakdown pengeluaran bulan ini by subcategory
  const expensesBulanIni = (allExpenses || []).filter(e => (e.date || e.created_at || "").slice(0, 7) === bulanIni);
  const expByCategory = expensesBulanIni.reduce((acc, e) => {
    const kat = e.subcategory || e.category || "Lain-lain";
    acc[kat] = (acc[kat] || 0) + (e.amount || 0);
    return acc;
  }, {});
  const topExpenses = Object.entries(expByCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const bulanLabel = now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  return (
    <div>
      {/* Target Progress */}
      <div style={{ background: "linear-gradient(135deg," + cs.accent + "12," + cs.ara + "08)", border: "1px solid " + cs.accent + "33", borderRadius: 12, padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Target Pemasukan — {bulanLabel} (klik untuk edit)</div>
            <input
              type="number"
              value={targetBulan}
              onChange={e => setTargetBulan(Number(e.target.value))}
              style={{ background: "transparent", border: "none", color: cs.accent, fontSize: 20, fontWeight: 700, width: 220, outline: "none" }} />
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: cs.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Tercapai Bulan Ini</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: cs.green }}>{fmtRp(totalIn)}</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{pct.toFixed(1)}% dari target</div>
          </div>
        </div>
        <div style={{ height: 8, background: cs.surface, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: pct + "%", background: "linear-gradient(90deg," + cs.green + ",#16a34a)", borderRadius: 4, transition: "width 0.5s" }} />
        </div>
        <div style={{ fontSize: 11, color: cs.muted, marginTop: 6 }}>
          Sisa target: {fmtRp(Math.max(0, targetBulan - totalIn))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 14 }}>
        {/* Ringkasan Bulan Ini */}
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📊 Ringkasan — {bulanLabel}</div>
          {[
            { label: "Pemasukan PAID", value: fmtRp(totalIn), color: cs.green },
            { label: "Pengeluaran", value: fmtRp(totalOut), color: cs.red },
            { label: "Net Profit Bulan Ini", value: fmtRp(netProfit), color: netProfit >= 0 ? cs.green : cs.red },
            { label: "Profit Margin", value: totalIn > 0 ? ((netProfit / totalIn) * 100).toFixed(1) + "%" : "—", color: cs.accent },
          ].map(r => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid " + cs.border + "80" }}>
              <span style={{ fontSize: 12, color: cs.muted }}>{r.label}</span>
              <span style={{ fontWeight: 700, color: r.color, fontSize: 13 }}>{r.value}</span>
            </div>
          ))}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid " + cs.border, fontSize: 12, color: cs.muted }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Net Profit All-Time</span>
              <span style={{ fontWeight: 700, color: netProfitAll >= 0 ? cs.green : cs.red }}>{fmtRp(netProfitAll)}</span>
            </div>
          </div>
        </div>

        {/* Top Pengeluaran */}
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>💸 Top Pengeluaran — {bulanLabel}</div>
          {topExpenses.length === 0 ? (
            <div style={{ color: cs.muted, fontSize: 13, textAlign: "center", padding: "24px 0" }}>Belum ada pengeluaran bulan ini</div>
          ) : topExpenses.map(([kat, total]) => {
            const pctOut = totalOut > 0 ? (total / totalOut * 100) : 0;
            return (
              <div key={kat} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: cs.text }}>{kat}</span>
                  <span style={{ color: cs.red, fontWeight: 700 }}>{fmtRp(total)} <span style={{ color: cs.muted, fontWeight: 400 }}>({pctOut.toFixed(0)}%)</span></span>
                </div>
                <div style={{ height: 6, background: cs.surface, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: Math.min(100, pctOut) + "%", background: "linear-gradient(90deg," + cs.red + ",#b91c1c)", borderRadius: 4 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rekomendasi */}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>💡 Rekomendasi Finance</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <div style={{ background: pct >= 100 ? cs.green + "0d" : cs.accent + "0d", border: "1px solid " + (pct >= 100 ? cs.green : cs.accent) + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: pct >= 100 ? cs.green : cs.accent, fontSize: 13, marginBottom: 4 }}>
              {pct >= 100 ? "🎉 Target Tercapai!" : "📈 Progress Target"}
            </div>
            <div style={{ fontSize: 12, color: cs.muted }}>{pct.toFixed(1)}% dari target {bulanLabel}. {pct >= 100 ? "Luar biasa!" : "Terus tingkatkan performa."}</div>
          </div>
          <div style={{ background: cs.accent + "0d", border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: cs.accent, fontSize: 13, marginBottom: 4 }}>💰 Sisihkan Saving</div>
            <div style={{ fontSize: 12, color: cs.muted }}>20% dari net profit = {fmtRp(Math.max(0, Math.round(netProfit * 0.2)))} untuk dana darurat.</div>
          </div>
          <div style={{ background: overdueCount > 0 ? cs.red + "0d" : cs.yellow + "0d", border: "1px solid " + (overdueCount > 0 ? cs.red : cs.yellow) + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: overdueCount > 0 ? cs.red : cs.yellow, fontSize: 13, marginBottom: 4 }}>
              {overdueCount > 0 ? "🚨 Ada Invoice Overdue!" : "⚠️ Piutang Beredar"}
            </div>
            <div style={{ fontSize: 12, color: cs.muted }}>{unpaidCount} UNPAID · {overdueCount} OVERDUE. Lakukan follow-up segera.</div>
          </div>
          <div style={{ background: cs.ara + "0d", border: "1px solid " + cs.ara + "33", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 700, color: cs.ara, fontSize: 13, marginBottom: 4 }}>📋 Cek Mutasi Rutin</div>
            <div style={{ fontSize: 12, color: cs.muted }}>Verifikasi semua invoice PAID di rekening setiap hari kerja.</div>
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
    <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 16, padding: 24, maxWidth: 500, width: "90%", maxHeight: "85vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>📎 Bukti Pembayaran</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 14 }}>{modal.customer}</div>
        {modal.url && modal.url !== "verified-no-proof" ? (
          <img src={modal.url} alt="Bukti bayar" style={{ width: "100%", borderRadius: 8, objectFit: "contain", maxHeight: 500 }} />
        ) : (
          <div style={{ textAlign: "center", color: cs.muted, padding: "40px 0" }}>
            {modal.url === "verified-no-proof" ? "✅ Dikonfirmasi secara manual oleh admin" : "Belum ada bukti yang diupload"}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main FinanceView ─────────────────────────────────────────────
export default function FinanceView({ currentUser, ordersData, invoicesData, expensesData, supabase }) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [paymentProofModal, setPaymentProofModal] = useState(null);
  const [dateOffset, setDateOffset] = useState(0);

  const currentDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dateOffset);
    return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }, [dateOffset]);

  const todayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dateOffset);
    return d.toISOString().slice(0, 10);
  }, [dateOffset]);

  const filteredOrders = useMemo(() =>
    (ordersData || []).filter(o => {
      const dateVal = o.date || "";
      return dateVal.slice(0, 10) === todayStr;
    }),
    [ordersData, todayStr]);

  const filteredInvoices = useMemo(() => {
    const orderIds = new Set(filteredOrders.map(o => o.id));
    return (invoicesData || []).filter(i => orderIds.has(i.job_id));
  }, [invoicesData, filteredOrders]);

  return (
    <div style={{ color: cs.text, fontFamily: "system-ui,-apple-system,sans-serif" }}>
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

      <ProofModal modal={paymentProofModal} onClose={() => setPaymentProofModal(null)} />
    </div>
  );
}
