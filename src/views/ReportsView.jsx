import { memo } from "react";
import { cs } from "../theme/cs.js";

function ReportsView({ ordersData, invoicesData, laporanReports, customersData, teknisiData, inventoryData, isMobile, currentUser, statsPeriod, setStatsPeriod, statsMingguOff, setStatsMingguOff, statsDateFrom, setStatsDateFrom, statsDateTo, setStatsDateTo, bulanIni, fmt, invoiceReminderWA, getTechColor, TODAY, expensesData }) {
const techColors = Object.fromEntries([...new Set(ordersData.map(o => o.teknisi).filter(Boolean))].map(n => [n, getTechColor(n, teknisiData)]))
// ── Filter helper berdasarkan periode yang dipilih ──
const tahunIni = TODAY.slice(0, 4);

// Hitung range minggu sesuai statsMingguOff
const getMingguRange = (offset) => {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diffToMon + offset * 7);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = d => d.toISOString().slice(0, 10);
  return { from: fmt(mon), to: fmt(sun) };
};
const mingguRange = getMingguRange(statsMingguOff);

// Label periode
const mingguLabel = statsMingguOff === 0 ? "Minggu Ini"
  : statsMingguOff === -1 ? "Minggu Lalu"
    : "Minggu " + (statsMingguOff < 0 ? Math.abs(statsMingguOff) + " lalu" : statsMingguOff + " ke depan");
const periodLabel = statsPeriod === "hari" ? "Hari Ini (" + TODAY + ")"
  : statsPeriod === "minggu" ? mingguLabel + " (" + mingguRange.from + " – " + mingguRange.to + ")"
    : statsPeriod === "bulan" ? "Bulan Ini (" + bulanIni + ")"
      : statsPeriod === "tahun" ? "Tahun " + tahunIni
        : statsPeriod === "custom" && statsDateFrom && statsDateTo
          ? statsDateFrom + " s/d " + statsDateTo
          : "Semua Waktu";

// Filter berdasarkan tanggal
const inRange = (tgl) => {
  if (!tgl) return false;
  const d = tgl.slice(0, 10);
  if (statsPeriod === "hari") return d === TODAY;
  if (statsPeriod === "minggu") return d >= mingguRange.from && d <= mingguRange.to;
  if (statsPeriod === "bulan") return d.startsWith(bulanIni);
  if (statsPeriod === "tahun") return d.startsWith(tahunIni);
  if (statsPeriod === "custom") {
    if (statsDateFrom && statsDateTo) return d >= statsDateFrom && d <= statsDateTo;
    if (statsDateFrom) return d >= statsDateFrom;
    if (statsDateTo) return d <= statsDateTo;
  }
  return true; // tanpa filter
};
const filterInvByPeriod = (inv) => inRange(String(inv.paid_at || inv.created_at || ""));
const filterOrderByPeriod = (o) => inRange(String(o.date || ""));

// ── Revenue & Invoice ──
const allInv = invoicesData;
// paidInv: PAID di periode ini (by paid_at)
const paidInv = allInv.filter(i => i.status === "PAID" && filterInvByPeriod(i));
// AR: selalu semua outstanding (bukan filter periode)
const unpaidInv = allInv.filter(i => i.status === "UNPAID");
const overdueInv = allInv.filter(i => i.status === "OVERDUE");
const pendingInv = allInv.filter(i => i.status === "PENDING_APPROVAL");
const totalRevenue = paidInv.reduce((a, b) => a + (b.total || 0), 0);
const totalLabor = paidInv.reduce((a, b) => a + (b.labor || 0), 0);
const totalMaterial = paidInv.reduce((a, b) => a + (b.material || 0), 0);
const totalDiscount = paidInv.reduce((a, b) => a + (b.discount || 0) + (b.trade_in ? (b.trade_in_amount || 0) : 0), 0);
const totalExpenses = (expensesData || []).filter(e => inRange(String(e.date || e.created_at || ""))).reduce((a, b) => a + (b.amount || 0), 0);
const totalAR = unpaidInv.reduce((a, b) => a + (b.total || 0), 0)
  + overdueInv.reduce((a, b) => a + (b.total || 0), 0);
const totalPending = pendingInv.reduce((a, b) => a + (b.total || 0), 0);
const totalOverdue = overdueInv.reduce((a, b) => a + (b.total || 0), 0);

// ── Orders — filter sesuai periode ──
const DONE_STATUSES = ["COMPLETED", "REPORT_SUBMITTED", "VERIFIED"];
const ordersPeriod = ordersData.filter(filterOrderByPeriod);  // orders di periode ini
const ordersDone = ordersPeriod.filter(o => DONE_STATUSES.includes(o.status)).length;
const ordersAll = ordersPeriod.length;
const completionRate = ordersAll > 0 ? Math.round(ordersDone / ordersAll * 100) : 0;
const avgOrderVal = paidInv.length > 0 ? Math.round(totalRevenue / paidInv.length) : 0;

// ── Revenue per layanan (periode ini) ──
const revBreakdown = [
  ["Cleaning", paidInv.filter(i => (i.service || "").toLowerCase().includes("cleaning")).reduce((a, b) => a + (b.total || 0), 0), cs.accent, paidInv.filter(i => (i.service || "").toLowerCase().includes("cleaning")).length],
  ["Install", paidInv.filter(i => (i.service || "").toLowerCase().includes("install")).reduce((a, b) => a + (b.total || 0), 0), cs.green, paidInv.filter(i => (i.service || "").toLowerCase().includes("install")).length],
  ["Repair", paidInv.filter(i => (i.service || "").toLowerCase().includes("repair")).reduce((a, b) => a + (b.total || 0), 0), cs.yellow, paidInv.filter(i => (i.service || "").toLowerCase().includes("repair")).length],
  ["Complain", paidInv.filter(i => (i.service || "").toLowerCase().includes("complain")).reduce((a, b) => a + (b.total || 0), 0), cs.red, paidInv.filter(i => (i.service || "").toLowerCase().includes("complain")).length],
].filter(([, rev, , cnt]) => rev > 0 || cnt > 0);

// ── Teknisi performance — filter sesuai periode ──
const tekPerf = [...new Set(ordersData.map(o => o.teknisi).filter(Boolean))].map(name => {
  const myOrders = ordersPeriod.filter(o => o.teknisi === name);
  const myDone = myOrders.filter(o => DONE_STATUSES.includes(o.status)).length;
  const myRev = paidInv
    .filter(i => myOrders.some(o => o.id === i.job_id))
    .reduce((a, b) => a + (b.total || 0), 0);
  return { name, done: myDone, total: myOrders.length, rev: myRev };
}).filter(t => t.total > 0).sort((a, b) => b.done - a.done);
const maxDone = Math.max(...tekPerf.map(t => t.done), 1);

// ── Customer metrics ──
const custTotal = customersData.length;
const custVip = customersData.filter(c => c.is_vip).length;
const custBaru = customersData.filter(c =>
  inRange(String(c.joined || c.created_at || ""))
).length;

const fmtPct = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + "%" : "—";
const fmtRp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");

return (
  <div style={{ display: "grid", gap: 18 }}>
    {/* Header + Filter */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 18, color: cs.text }}>📊 Laporan Keuangan &amp; Operasional</div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>Profit &amp; Loss · Accounts Receivable · Performa Tim</div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {[["hari", "Hari Ini"], ["minggu", "Minggu"], ["bulan", "Bulan Ini"], ["tahun", "Tahun Ini"], ["custom", "Custom"]].map(([v, l]) => (
          <button key={v} onClick={() => { setStatsPeriod(v); if (v !== "minggu") setStatsMingguOff(0); }}
            style={{
              padding: "7px 14px", borderRadius: 99, fontSize: 12, cursor: "pointer", fontWeight: 600,
              border: "1px solid " + (statsPeriod === v ? cs.accent : cs.border),
              background: statsPeriod === v ? cs.accent + "22" : cs.surface,
              color: statsPeriod === v ? cs.accent : cs.muted
            }}>
            {l}
          </button>
        ))}
        {statsPeriod === "minggu" && (
          <div style={{
            display: "flex", alignItems: "center", gap: 4, background: cs.card,
            border: "1px solid " + cs.border, borderRadius: 99, padding: "3px 6px"
          }}>
            <button onClick={() => setStatsMingguOff(w => w - 1)}
              style={{ background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 14, padding: "0 6px" }}>←</button>
            <span style={{ fontSize: 11, color: cs.muted, minWidth: 90, textAlign: "center" }}>
              {statsMingguOff === 0 ? "Minggu Ini" : statsMingguOff === -1 ? "Minggu Lalu" : Math.abs(statsMingguOff) + " minggu lalu"}
            </span>
            <button onClick={() => setStatsMingguOff(w => Math.min(0, w + 1))}
              style={{
                background: "none", border: "none",
                color: statsMingguOff === 0 ? cs.border : cs.muted,
                cursor: statsMingguOff === 0 ? "default" : "pointer", fontSize: 14, padding: "0 6px"
              }}>→</button>
          </div>
        )}
        {statsPeriod === "custom" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="date" value={statsDateFrom}
              onChange={e => setStatsDateFrom(e.target.value)}
              style={{
                background: cs.card, border: "1px solid " + cs.border, borderRadius: 7,
                padding: "5px 8px", fontSize: 11, color: cs.text, colorScheme: "dark"
              }} />
            <span style={{ color: cs.muted, fontSize: 12 }}>–</span>
            <input type="date" value={statsDateTo}
              onChange={e => setStatsDateTo(e.target.value)}
              style={{
                background: cs.card, border: "1px solid " + cs.border, borderRadius: 7,
                padding: "5px 8px", fontSize: 11, color: cs.text, colorScheme: "dark"
              }} />
            {(statsDateFrom || statsDateTo) && (
              <button onClick={() => { setStatsDateFrom(""); setStatsDateTo(""); }}
                style={{
                  fontSize: 11, padding: "3px 8px", borderRadius: 99, background: cs.red + "22",
                  border: "1px solid " + cs.red + "44", color: cs.red, cursor: "pointer"
                }}>✕ Reset</button>
            )}
          </div>
        )}
      </div>
    </div>

    {/* ── SECTION 1 + 1b: P&L Summary — Owner & Finance ── */}
    {(currentUser?.role === "Owner" || currentUser?.role === "Finance") && (
      <>
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
          <div style={{ fontWeight: 800, color: cs.text, fontSize: 14, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>💰 Profit & Loss — {periodLabel}</span>
            <span style={{ fontSize: 11, color: cs.muted, fontWeight: 400 }}>Berdasarkan {paidInv.length} invoice PAID</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            {[
              { label: "Total Pendapatan", val: fmt(totalRevenue), sub: "Gross Revenue", color: cs.green, icon: "📈" },
              { label: "Pendapatan Jasa", val: fmt(totalLabor), sub: fmtPct(totalLabor, totalRevenue) + " dari revenue", color: cs.accent, icon: "🔧" },
              { label: "Pendapatan Material", val: fmt(totalMaterial), sub: fmtPct(totalMaterial, totalRevenue) + " dari revenue", color: cs.yellow, icon: "📦" },
              { label: "Total Pengeluaran", val: fmt(totalExpenses), sub: fmtPct(totalExpenses, totalRevenue) + " dari revenue", color: cs.ara, icon: "💸" },
            ].map(k => (
              <div key={k.label} style={{ background: cs.surface, borderRadius: 10, padding: "14px 16px", border: "1px solid " + k.color + "22" }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{k.icon}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: k.color, fontFamily: "monospace" }}>{k.val}</div>
                <div style={{ fontSize: 12, color: cs.text, fontWeight: 600, marginTop: 3 }}>{k.label}</div>
                <div style={{ fontSize: 10, color: cs.muted, marginTop: 1 }}>{k.sub}</div>
              </div>
            ))}
          </div>
          {/* Revenue cards per layanan */}
          <div style={{ borderTop: "1px solid " + cs.border, paddingTop: 14 }}>
            <div style={{ fontSize: 12, color: cs.muted, marginBottom: 12, fontWeight: 600 }}>📊 Komposisi Revenue per Layanan</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
              {revBreakdown.map(([svc, rev, col, cnt]) => {
                const pct = totalRevenue > 0 ? (rev / totalRevenue * 100) : 0;
                return (
                  <div key={svc} style={{ background: cs.surface, border: "1px solid " + col + "33", borderRadius: 10, padding: "12px 14px", textAlign: "center", transition: "all 0.2s", cursor: "pointer" }}>
                    {/* Service Name */}
                    <div style={{ fontSize: 13, fontWeight: 700, color: col, marginBottom: 6 }}>{svc}</div>

                    {/* Revenue Amount */}
                    <div style={{ fontSize: 16, fontWeight: 800, color: col, fontFamily: "monospace", marginBottom: 4 }}>{fmt(rev)}</div>

                    {/* Percentage */}
                    <div style={{ fontSize: 11, color: cs.muted, marginBottom: 8 }}>{pct.toFixed(1)}%</div>

                    {/* Invoice Count & Average */}
                    <div style={{ fontSize: 9, color: cs.muted, paddingTop: 8, borderTop: "1px solid " + cs.border }}>
                      <div>{cnt} invoice</div>
                      <div style={{ marginTop: 2, color: col, fontWeight: 600 }}>{(rev / Math.max(1, cnt)).toFixed(0)} rata²</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── SECTION 1b: Profit Estimasi (GAP 7) ── */}
        {totalRevenue > 0 && (() => {
          const totalMaterialCost = inventoryData.reduce((acc, item) => {
            // Estimasi biaya material dari laporan bulan ini
            return acc;
          }, 0);
          const profitMargin = totalLabor > 0 ? Math.round(totalLabor / totalRevenue * 100) : 0;
          return (
            <div style={{ background: "linear-gradient(135deg," + cs.green + "18," + cs.accent + "08)", border: "1px solid " + cs.green + "33", borderRadius: 14, padding: "16px 20px", display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: cs.muted, fontWeight: 700, marginBottom: 4 }}>💹 ESTIMASI PROFIT — {periodLabel}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: cs.green, fontFamily: "monospace" }}>{fmt(totalLabor)}</div>
                <div style={{ fontSize: 11, color: cs.muted }}>Pendapatan jasa bersih (setelah material)</div>
              </div>
              <div style={{ textAlign: "center", padding: "10px 16px", background: cs.green + "12", borderRadius: 10, border: "1px solid " + cs.green + "22" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: cs.green }}>{profitMargin}%</div>
                <div style={{ fontSize: 10, color: cs.muted, fontWeight: 700 }}>Profit Margin</div>
              </div>
              <div style={{ textAlign: "center", padding: "10px 16px", background: cs.accent + "12", borderRadius: 10, border: "1px solid " + cs.accent + "22" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: cs.accent }}>{paidInv.length}</div>
                <div style={{ fontSize: 10, color: cs.muted, fontWeight: 700 }}>Invoice Lunas</div>
              </div>
            </div>
          );
        })()}

      </>
    )} {/* end P&L — Owner only */}

    {/* ── SECTION 2: KPI Operasional ── */}
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(3,1fr)", gap: isMobile ? 10 : 12 }}>
      {[
        { label: "Completion Rate", val: completionRate + "%", sub: ordersDone + "/" + ordersAll + " order", color: cs.green, icon: "✅" },
        ...((currentUser?.role === "Owner" || currentUser?.role === "Finance") ? [{ label: "Avg. Order Value", val: fmt(avgOrderVal), sub: "per transaksi PAID", color: cs.accent, icon: "📋" }] : []),
        { label: "Order " + periodLabel, val: ordersAll, sub: custBaru + " customer baru", color: cs.yellow, icon: "🗂️" },
      ].map(k => (
        <div key={k.label} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>{k.icon}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: k.color, fontFamily: "monospace" }}>{k.val}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: cs.text, marginTop: 4 }}>{k.label}</div>
          <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>{k.sub}</div>
        </div>
      ))}
    </div>

    {/* ── SECTION 3: Accounts Receivable ── */}
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
      <div style={{ fontWeight: 800, color: cs.text, fontSize: 14, marginBottom: 14 }}>📥 Accounts Receivable (Piutang)</div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        {[
          { label: "Piutang Aktif", val: fmt(totalAR), cnt: unpaidInv.length + overdueInv.length, color: cs.yellow },
          { label: "Overdue 🚨", val: fmt(totalOverdue), cnt: overdueInv.length, color: cs.red },
          { label: "Menunggu Approval", val: fmt(totalPending), cnt: pendingInv.length, color: cs.ara },
          { label: "Customer Aktif", val: custTotal, cnt: custVip + " VIP", color: cs.accent },
        ].map(k => (
          <div key={k.label} style={{ background: cs.surface, borderRadius: 10, padding: "12px 14px", border: "1px solid " + k.color + "22" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: k.color, fontFamily: "monospace" }}>{k.val}</div>
            <div style={{ fontSize: 11, color: cs.text, fontWeight: 600, marginTop: 3 }}>{k.label}</div>
            <div style={{ fontSize: 10, color: cs.muted, marginTop: 1 }}>{k.cnt} invoice/akun</div>
          </div>
        ))}
      </div>
      {/* Daftar invoice OVERDUE */}
      {overdueInv.length > 0 && (
        <div style={{ background: cs.red + "10", border: "1px solid " + cs.red + "22", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: cs.red, marginBottom: 8 }}>⚠️ Invoice Overdue — Perlu Tindakan</div>
          {overdueInv.map(inv => (
            <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 6, borderBottom: "1px solid " + cs.red + "15", marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.text }}>{inv.customer}</div>
                <div style={{ fontSize: 10, color: cs.muted }}>{inv.id} · Due: {inv.due || "—"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: cs.red, fontFamily: "monospace" }}>{fmt(inv.total)}</div>
                <button onClick={() => invoiceReminderWA(inv)} style={{ fontSize: 10, color: "#25D366", background: "#25D36618", border: "1px solid #25D36633", borderRadius: 4, padding: "2px 7px", cursor: "pointer", marginTop: 2 }}>WA Reminder</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* ── SECTION 4: Performa Teknisi ── */}
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 20 }}>
      <div style={{ fontWeight: 800, color: cs.text, fontSize: 14, marginBottom: 4 }}>👷 Performa Tim Teknisi</div>
      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 14 }}>Berdasarkan order COMPLETED keseluruhan</div>
      {tekPerf.length === 0
        ? <div style={{ color: cs.muted, fontSize: 13, textAlign: "center", padding: "20px 0" }}>Belum ada data</div>
        : <div style={{ display: "grid", gap: 8 }}>
          {tekPerf.map(t => {
            const col = techColors[t.name] || cs.muted;
            const rate = t.total > 0 ? Math.round(t.done / t.total * 100) : 0;
            return (
              <div key={t.name} style={{ display: "grid", gridTemplateColumns: isMobile ? "80px 1fr 50px" : "120px 1fr 60px 80px", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: cs.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                <div style={{ background: cs.border, borderRadius: 99, height: 8, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: col, width: (t.done / maxDone * 100) + "%", borderRadius: 99, transition: "width 0.4s" }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: col, fontFamily: "monospace", textAlign: "right" }}>{t.done}/{t.total}</span>
                <span style={{ fontSize: 10, color: rate >= 80 ? cs.green : rate >= 50 ? cs.yellow : cs.red, fontWeight: 700, textAlign: "right" }}>{rate}%</span>
              </div>
            );
          })}
        </div>
      }
    </div>

    {/* ── SECTION 5: Status Invoice & Laporan ── */}
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : ((currentUser?.role === "Owner" || currentUser?.role === "Finance") ? "1fr 1fr" : "1fr"), gap: 14 }}>
      {(currentUser?.role === "Owner" || currentUser?.role === "Finance") && (
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 18 }}>
        <div style={{ fontWeight: 700, color: cs.text, marginBottom: 12, fontSize: 13 }}>🧾 Status Invoice (Semua)</div>
        {[["PAID", cs.green, "Lunas"], ["UNPAID", cs.yellow, "Belum Bayar"], ["OVERDUE", cs.red, "Terlambat"], ["PENDING_APPROVAL", cs.ara, "Menunggu Approve"]].map(([s, col, lbl]) => {
          const items = allInv.filter(i => i.status === s);
          const total = items.reduce((a, b) => a + (b.total || 0), 0);
          return items.length > 0 ? (
            <div key={s} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid " + cs.border }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: col + "22", color: col, border: "1px solid " + col + "44", fontWeight: 700 }}>{lbl}</span>
                <span style={{ fontSize: 11, color: cs.muted }}>{items.length}×</span>
              </div>
              <span style={{ fontWeight: 800, color: col, fontFamily: "monospace", fontSize: 12 }}>{fmt(total)}</span>
            </div>
          ) : null;
        })}
      </div>
      )}
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 18 }}>
        <div style={{ fontWeight: 700, color: cs.text, marginBottom: 12, fontSize: 13 }}>📝 Status Laporan Teknisi</div>
        {[["SUBMITTED", cs.accent, "Baru"], ["VERIFIED", cs.green, "Terverifikasi"], ["REVISION", cs.yellow, "Perlu Revisi"], ["REJECTED", cs.red, "Ditolak"]].map(([s, col, lbl]) => {
          const cnt = laporanReports.filter(r => r.status === s).length;
          return cnt > 0 ? (
            <div key={s} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid " + cs.border }}>
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: col + "22", color: col, border: "1px solid " + col + "44", fontWeight: 700 }}>{lbl}</span>
              <span style={{ fontWeight: 800, color: col, fontFamily: "monospace" }}>{cnt}</span>
            </div>
          ) : null;
        })}
      </div>
    </div>
  </div>
);
}

export default memo(ReportsView);
