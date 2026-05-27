import { memo, useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import {
  fetchWeeklyPayroll, fetchDaysWorkedFromOrders, fetchKasbonByPeriod,
  fetchOrderBonusesByPeriod, fetchOrdersWithoutBonus, fetchAvailabilityByUserPeriod,
} from "../data/reads.js";
import {
  updateUserDailyRate, upsertWeeklyPayroll, updateWeeklyPayroll,
  markPayrollPaid, insertOrderBonus, updateOrderBonus, markBonusPaid, voidBonus, deleteOrderBonus,
} from "../data/writes.js";

// ── Payroll helpers ──
const BONUS_LABELS = {
  margin_1jt: "Margin >1jt", margin_2jt: "Margin >2jt", margin_3jt: "Margin >3jt",
  freon: "Isi Freon", kapasitor: "Kapasitor", thermis: "Sparepart Thermis",
  install_2: "Pasang >2 Unit/hari", install_3: "Pasang >3 Unit/hari", install_4: "Pasang >4 Unit/hari",
  manual: "Bonus Manual",
};
const BONUS_DEFAULTS = {
  margin_1jt: 50000, margin_2jt: 100000, margin_3jt: 200000,
  freon: 25000, kapasitor: 35000, thermis: 35000,
  install_2: 100000, install_3: 200000, install_4: 300000,
  manual: 0,
};
const STATUS_COLORS = { PENDING: "#f59e0b", ELIGIBLE: "#3b82f6", PAID: "#22c55e", VOID: "#ef4444" };
const STATUS_LABELS = { PENDING: "Dalam Warranty", ELIGIBLE: "Siap Cair", PAID: "Sudah Dibayar", VOID: "Void" };

// Hitung Senin terdekat sebelum/sama dengan today
// Selalu pakai local date — toISOString() return UTC dan geser hari di WIB (UTC+7)
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function getMondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return localDateStr(d);
}
function getSaturdayOf(mondayStr) {
  const d = new Date(mondayStr + "T00:00:00");
  d.setDate(d.getDate() + 5);
  return localDateStr(d);
}
function addWeeks(mondayStr, n) {
  const d = new Date(mondayStr + "T00:00:00");
  d.setDate(d.getDate() + n * 7);
  return localDateStr(d);
}
// Helper bulan untuk komisi — "2026-05"
function getMonthStart(ym) { return ym + "-01"; } // "2026-05" → "2026-05-01"
function getMonthEnd(ym) {
  const [y, m] = ym.split("-").map(Number);
  return localDateStr(new Date(y, m, 0)); // hari terakhir bulan
}
function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtMonth(ym) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}
function todayYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtRp(n) {
  if (!n && n !== 0) return "-";
  const abs = Math.abs(Number(n));
  const str = abs.toLocaleString("id-ID");
  return (Number(n) < 0 ? "-" : "") + "Rp " + str;
}
function fmtDate(d) {
  if (!d) return "-";
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
function fullWeekBonusAmt(role) { return role === "Helper" ? 75000 : 100000; }
// Hitung gross client-side (mirror formula GENERATED di DB) → total live tanpa nunggu reload
function computeGross(row) {
  return Number(row.days_worked || 0) * Number(row.daily_rate || 0)
    + (row.full_week_bonus ? fullWeekBonusAmt(row.role) : 0)
    - Number(row.late_days || 0) * 10000
    - Number(row.kasbon_deduct || 0)
    + Number(row.manual_bonus || 0);
}
// Total kasbon terutang minggu ini = kasbon baru + sisa minggu lalu
function kasbonOwed(row) { return Number(row.kasbon_total || 0) + Number(row.kasbon_carryover || 0); }
function kasbonSisa(row) { return Math.max(0, kasbonOwed(row) - Number(row.kasbon_deduct || 0)); }
// Komisi PENDING → ELIGIBLE otomatis setelah 30 hari (derive, tanpa cron)
function daysSinceDate(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
}
function effBonusStatus(b) {
  if (b.status === "PENDING" && daysSinceDate(b.order_date) >= 30) return "ELIGIBLE";
  return b.status;
}

function TeknisiAdminView({ teknisiData, setTeknisiData, ordersData, laporanReports, currentUser, supabase, setEditTeknisi, setNewTeknisiForm, setModalTeknisi, showConfirm, showNotif, addAgentLog, openWA, TODAY, invoicesData }) {
const [activeTab, setActiveTab] = useState("tim"); // "tim" | "sla" | "gaji"
// GAP-11: Rekap performa per teknisi
const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const perfMap = {};
teknisiData.forEach(t => {
  const jobsMinggu = ordersData.filter(o =>
    (o.teknisi === t.name || o.helper === t.name) && (o.date || "") >= weekAgo
  );
  const jobsBulan = ordersData.filter(o =>
    (o.teknisi === t.name || o.helper === t.name) && (o.date || "") >= monthAgo
  );
  const laporanMinggu = laporanReports.filter(r =>
    (r.teknisi === t.name || r.helper === t.name) && (r.submitted_at || r.submitted || "") >= weekAgo
  );
  const revisi = laporanReports.filter(r =>
    (r.teknisi === t.name || r.helper === t.name) && r.status === "REVISION"
  ).length;
  // Job stuck: DISPATCHED/ON_SITE tapi belum ada laporan & sudah lewat jam selesai
  const stuck = ordersData.filter(o =>
    (o.teknisi === t.name || o.helper === t.name) &&
    ["DISPATCHED", "ON_SITE"].includes(o.status) &&
    o.date < TODAY &&
    !laporanReports.some(r => r.job_id === o.id) &&
    !invoicesData.some(i => i.job_id === o.id)
  ).length;
  const selesai = jobsMinggu.filter(o =>
    ["COMPLETED", "REPORT_SUBMITTED", "INVOICE_APPROVED", "INVOICE_CREATED", "PAID"].includes(o.status)
  ).length;
  // GAP-11: Hitung laporan terlambat (ada laporan tapi > 2 jam setelah time_end)
  const laporanTerlambat = laporanMinggu.filter(r => {
    const order = ordersData.find(o => o.id === r.job_id || o.id === r.order_id);
    if (!order || !order.time_end || !r.submitted_at) return false;
    const endMs = new Date((order.date || "") + "T" + (order.time_end || "17:00") + ":00").getTime();
    const subMs = new Date(r.submitted_at).getTime();
    return subMs > (endMs + 2 * 60 * 60 * 1000); // > 2 jam setelah selesai
  }).length;
  perfMap[t.name] = {
    jobsMinggu: jobsMinggu.length, selesai, revisi, stuck,
    jobsBulan: jobsBulan.length,
    laporanMinggu: laporanMinggu.length,
    onTime: laporanMinggu.length - laporanTerlambat,
    terlambat: laporanTerlambat,
    avgJobPerDay: +(jobsMinggu.length / 7).toFixed(1),
  };
});

// ── SLA Calculations (dipakai di tab SLA) ──
const slaData = teknisiData.map(t => {
  const allOrders = ordersData.filter(o => o.teknisi === t.name || o.helper === t.name);
  const completed = allOrders.filter(o => ["COMPLETED","REPORT_SUBMITTED","INVOICE_APPROVED","INVOICE_CREATED","PAID"].includes(o.status));
  const thisMonth = new Date().toISOString().slice(0, 7);
  const completedThisM = completed.filter(o => (o.date || "").startsWith(thisMonth));

  // Avg waktu submit laporan (submitted_at - order.date) dalam jam
  const laporanWithTime = laporanReports.filter(r => {
    const o = allOrders.find(o => o.id === r.job_id || o.id === r.order_id);
    return o && r.submitted_at && o.date;
  });
  const avgSubmitHours = laporanWithTime.length > 0
    ? laporanWithTime.reduce((s, r) => {
        const o = allOrders.find(o => o.id === r.job_id || o.id === r.order_id);
        const diffH = (new Date(r.submitted_at) - new Date(o.date + "T08:00:00")) / 3600000;
        return s + Math.max(0, diffH);
      }, 0) / laporanWithTime.length
    : null;

  // Komplain rate: order status COMPLAINT / total
  const komplainCount = allOrders.filter(o => o.status === "COMPLAINT" || o.service === "Complain").length;
  const komplainRate = allOrders.length > 0 ? Math.round(komplainCount / allOrders.length * 100) : 0;

  // Free repair rate (invoice gratis / total invoice)
  const allInv = (invoicesData || []).filter(i => i.teknisi === t.name);
  const freeInv = allInv.filter(i => i.status === "GRATIS" || i.gratis === true || (i.total || 0) === 0);
  const freeRate = allInv.length > 0 ? Math.round(freeInv.length / allInv.length * 100) : 0;

  // On-time laporan: submit < 24 jam setelah order.date
  const onTimeCount = laporanWithTime.filter(r => {
    const o = allOrders.find(o => o.id === r.job_id || o.id === r.order_id);
    const diffH = (new Date(r.submitted_at) - new Date(o.date + "T08:00:00")) / 3600000;
    return diffH <= 24;
  }).length;
  const onTimeRate = laporanWithTime.length > 0 ? Math.round(onTimeCount / laporanWithTime.length * 100) : null;

  // Skor SLA (0-100): komponen weighted
  const completionRate = allOrders.length > 0 ? Math.round(completed.length / allOrders.length * 100) : 0;
  const slaScore = Math.round(
    (completionRate * 0.4) +
    ((onTimeRate ?? 50) * 0.3) +
    (Math.max(0, 100 - komplainRate * 5) * 0.2) +
    (Math.max(0, 100 - freeRate * 4) * 0.1)
  );

  return {
    name: t.name, role: t.role, id: t.id, status: t.status,
    totalOrders: allOrders.length,
    completedThisM: completedThisM.length,
    completionRate,
    avgSubmitHours,
    onTimeRate,
    komplainRate,
    freeRate,
    slaScore,
    laporanCount: laporanWithTime.length,
  };
}).sort((a, b) => b.slaScore - a.slaScore);

return (
  <div style={{ display: "grid", gap: 16 }}>
    {/* Tab Navigation */}
    <div style={{ display: "flex", gap: 8, borderBottom: "1px solid " + cs.border, paddingBottom: 0 }}>
      {[{ key: "tim", label: "👷 Tim & Performa" }, { key: "sla", label: "📊 SLA Tracking" }, { key: "gaji", label: "💰 Pengelolaan Gaji" }].map(tab => (
        <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
          padding: "10px 20px", borderRadius: "10px 10px 0 0", cursor: "pointer", fontWeight: 700, fontSize: 13,
          border: "1px solid " + (activeTab === tab.key ? cs.accent : cs.border),
          borderBottom: activeTab === tab.key ? "1px solid " + cs.card : "1px solid " + cs.border,
          background: activeTab === tab.key ? cs.card : cs.surface,
          color: activeTab === tab.key ? cs.accent : cs.muted,
          marginBottom: activeTab === tab.key ? -1 : 0,
        }}>{tab.label}</button>
      ))}
    </div>

    {/* ── TAB: SLA TRACKING ── */}
    {activeTab === "sla" && (() => {
      const getScoreColor = s => s >= 80 ? cs.green : s >= 60 ? cs.yellow : cs.red;
      const getScoreBadge = s => s >= 80 ? "🏆 Excellent" : s >= 60 ? "👍 Good" : s >= 40 ? "⚠️ Perlu Perhatian" : "🚨 Kritis";

      // Summary stats
      const avgScore = slaData.length > 0 ? Math.round(slaData.reduce((s, d) => s + d.slaScore, 0) / slaData.length) : 0;
      const topPerformer = slaData[0];
      const needAttention = slaData.filter(d => d.slaScore < 60);

      return (
        <div style={{ display: "grid", gap: 14 }}>
          {/* Summary Banner */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {[
              { icon: "⭐", label: "Avg SLA Score", value: avgScore + "/100", color: getScoreColor(avgScore) },
              { icon: "🏆", label: "Top Performer", value: topPerformer?.name?.split(" ")[0] || "—", color: cs.green },
              { icon: "⚠️", label: "Perlu Perhatian", value: needAttention.length + " teknisi", color: needAttention.length > 0 ? cs.red : cs.muted },
            ].map(k => (
              <div key={k.label} style={{ background: cs.card, border: "1px solid " + k.color + "33", borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>{k.icon}</div>
                <div style={{ fontWeight: 800, fontSize: 18, color: k.color }}>{k.value}</div>
                <div style={{ fontSize: 10, color: cs.muted, marginTop: 3 }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* SLA Cards per Teknisi */}
          {slaData.map((d, idx) => {
            const scoreCol = getScoreColor(d.slaScore);
            const badge = getScoreBadge(d.slaScore);
            const circumference = 2 * Math.PI * 20;
            const strokeDash = (d.slaScore / 100) * circumference;

            return (
              <div key={d.id} style={{ background: cs.card, border: "1px solid " + scoreCol + "44", borderRadius: 14, padding: 18, position: "relative", overflow: "hidden" }}>
                {/* Rank badge */}
                <div style={{ position: "absolute", top: 14, right: 14, fontSize: 11, background: scoreCol + "22", color: scoreCol, border: "1px solid " + scoreCol + "44", padding: "3px 10px", borderRadius: 99, fontWeight: 700 }}>
                  #{idx + 1} {badge}
                </div>

                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                  {/* Score Ring */}
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <svg width={52} height={52} style={{ transform: "rotate(-90deg)" }}>
                      <circle cx={26} cy={26} r={20} fill="none" stroke={cs.border} strokeWidth={4} />
                      <circle cx={26} cy={26} r={20} fill="none" stroke={scoreCol} strokeWidth={4}
                        strokeDasharray={`${strokeDash} ${circumference}`} strokeLinecap="round" style={{ transition: "stroke-dasharray 0.6s ease" }} />
                    </svg>
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, color: scoreCol }}>{d.slaScore}</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>{d.name}</div>
                    <div style={{ fontSize: 11, color: cs.muted }}>{d.role} · {d.totalOrders} total order</div>
                    <div style={{ fontSize: 11, color: scoreCol, fontWeight: 700, marginTop: 2 }}>SLA Score: {d.slaScore}/100</div>
                  </div>
                </div>

                {/* Metrics Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
                  {/* Completion Rate */}
                  <div style={{ background: cs.surface, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: cs.muted, marginBottom: 4 }}>✅ Completion Rate</div>
                    <div style={{ fontWeight: 800, fontSize: 18, color: d.completionRate >= 80 ? cs.green : d.completionRate >= 50 ? cs.yellow : cs.red }}>{d.completionRate}%</div>
                    <div style={{ height: 4, background: cs.border, borderRadius: 99, marginTop: 6, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: d.completionRate + "%", background: d.completionRate >= 80 ? cs.green : d.completionRate >= 50 ? cs.yellow : cs.red, borderRadius: 99 }} />
                    </div>
                    <div style={{ fontSize: 10, color: cs.muted, marginTop: 4 }}>{d.completedThisM} selesai bulan ini</div>
                  </div>

                  {/* On-time Laporan */}
                  <div style={{ background: cs.surface, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: cs.muted, marginBottom: 4 }}>⏱ Laporan Tepat Waktu</div>
                    {d.onTimeRate !== null ? (
                      <>
                        <div style={{ fontWeight: 800, fontSize: 18, color: d.onTimeRate >= 80 ? cs.green : d.onTimeRate >= 50 ? cs.yellow : cs.red }}>{d.onTimeRate}%</div>
                        <div style={{ height: 4, background: cs.border, borderRadius: 99, marginTop: 6, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: d.onTimeRate + "%", background: d.onTimeRate >= 80 ? cs.green : d.onTimeRate >= 50 ? cs.yellow : cs.red, borderRadius: 99 }} />
                        </div>
                        <div style={{ fontSize: 10, color: cs.muted, marginTop: 4 }}>
                          {d.avgSubmitHours !== null ? "Avg " + Math.round(d.avgSubmitHours) + "j setelah order" : d.laporanCount + " laporan"}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: cs.muted, marginTop: 4 }}>Belum ada data</div>
                    )}
                  </div>

                  {/* Komplain Rate */}
                  <div style={{ background: cs.surface, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: cs.muted, marginBottom: 4 }}>😤 Komplain Rate</div>
                    <div style={{ fontWeight: 800, fontSize: 18, color: d.komplainRate === 0 ? cs.green : d.komplainRate <= 5 ? cs.yellow : cs.red }}>{d.komplainRate}%</div>
                    <div style={{ fontSize: 10, color: cs.muted, marginTop: 6 }}>{d.komplainRate === 0 ? "Tidak ada komplain 🎉" : "Perlu monitoring"}</div>
                  </div>

                  {/* Free Repair Rate */}
                  <div style={{ background: cs.surface, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: cs.muted, marginBottom: 4 }}>🔧 Free Repair Rate</div>
                    <div style={{ fontWeight: 800, fontSize: 18, color: d.freeRate === 0 ? cs.green : d.freeRate <= 10 ? cs.yellow : cs.red }}>{d.freeRate}%</div>
                    <div style={{ fontSize: 10, color: cs.muted, marginTop: 6 }}>{d.freeRate === 0 ? "Tidak ada garansi klaim 🎉" : d.freeRate + "% invoice gratis"}</div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Metodologi */}
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>ℹ️ Metodologi Skor SLA</div>
            <div style={{ fontSize: 10, color: cs.muted, lineHeight: 1.7 }}>
              Skor 0–100 dihitung dari: <strong style={{ color: cs.text }}>Completion Rate</strong> (40%) + <strong style={{ color: cs.text }}>Laporan Tepat Waktu</strong> (30%) + <strong style={{ color: cs.text }}>Komplain Rate</strong> (20%) + <strong style={{ color: cs.text }}>Free Repair Rate</strong> (10%).
              Tepat waktu = laporan disubmit dalam 24 jam sejak order dibuat.
            </div>
          </div>
        </div>
      );
    })()}

    {/* ── TAB: TIM & PERFORMA ── */}
    {activeTab === "tim" && <>
    {/* GAP-7: Banner stuck jobs */}
    {(() => {
      const stuckList = ordersData.filter(o =>
        ["DISPATCHED", "ON_SITE"].includes(o.status) &&
        o.date < TODAY &&
        !laporanReports.some(r => r.job_id === o.id) &&
        !invoicesData.some(i => i.job_id === o.id)
      );
      if (stuckList.length === 0) return null;
      return (
        <div style={{ background: cs.red + "15", border: "1px solid " + cs.red + "33", borderRadius: 10, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 700, color: cs.red, fontSize: 13 }}>{stuckList.length} job belum ada laporan (sudah lewat hari)</div>
            <div style={{ fontSize: 11, color: cs.muted }}>{stuckList.map(o => `${o.id} (${o.teknisi})`).join(", ")}</div>
          </div>
        </div>
      );
    })()}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>👷 Tim Teknisi</div>
      <button onClick={() => { setEditTeknisi(null); setNewTeknisiForm({ name: "", role: "Teknisi", phone: "", skills: [] }); setModalTeknisi(true); }} style={{ background: "linear-gradient(135deg," + cs.green + ",#059669)", border: "none", color: "#fff", padding: "9px 18px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>+ Tambah Anggota</button>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
      {teknisiData.map(t => {
        const stC = t.status === "on-job" ? cs.green : t.status === "active" ? cs.accent : cs.muted;
        const perf = perfMap[t.name] || {};
        return (
          <div key={t.id} style={{ background: cs.card, border: "1px solid " + stC + "33", borderRadius: 14, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{t.name.charAt(0)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: cs.muted }}>{t.role} · {t.id}</div>
              </div>
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: stC + "22", color: stC, border: "1px solid " + stC + "44", fontWeight: 700 }}>{t.status}</span>
            </div>
            <div style={{ fontSize: 11, color: cs.muted, marginBottom: 10 }}>
              <div>📱 {t.phone}</div>
              <div>🔧 {ordersData.filter(o => o.teknisi === t.name && o.date === TODAY).length} job hari ini</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                {t.skills.map(s => <span key={s} style={{ background: cs.accent + "18", color: cs.accent, fontSize: 9, padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>{s}</span>)}
              </div>
            </div>
            {/* GAP-11: Rekap performa minggu ini */}
            <div style={{ borderTop: "1px solid " + cs.border, paddingTop: 8, marginBottom: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              <div style={{ fontSize: 10, color: cs.muted }}>📅 7 hari</div>
              <div style={{ fontSize: 10, color: cs.muted }}>📅 30 hari</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{perf.jobsMinggu || 0} job</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{perf.jobsBulan || 0} job</div>
              <div style={{ fontSize: 10, color: cs.green }}>✅ {perf.selesai || 0} selesai</div>
              <div style={{ fontSize: 10, color: perf.revisi > 0 ? cs.yellow : cs.muted }}>🔄 {perf.revisi || 0} revisi</div>
              {(perf.stuck || 0) > 0 && (
                <div style={{ fontSize: 10, color: cs.red, gridColumn: "1/-1" }}>⚠️ {perf.stuck} job stuck (laporan belum masuk)</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => { setEditTeknisi(t); setNewTeknisiForm({ ...t }); setModalTeknisi(true); }} style={{ flex: 1, background: cs.accent + "18", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "6px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>✏️ Edit</button>
              <button onClick={() => { if (t.phone) openWA(t.phone, "Halo " + (t.name || "Teknisi") + ", ada info dari AClean:"); else showNotif("❌ No. HP teknisi tidak ada"); }} style={{ flex: 1, background: "#25D36622", border: "1px solid #25D36644", color: "#25D366", padding: "6px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>📱 WA</button>
              {currentUser?.role === "Owner" && (
                <button onClick={() => { setEditTeknisi(t); setNewTeknisiForm({ ...t }); setModalTeknisi(true); }}
                  title="Buka Edit untuk hapus anggota"
                  style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "6px 8px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>🗑️</button>
              )}
            </div>
          </div>
        );
      })}
    </div>

    {/* GAP-11: Tabel Rekap Performa Mingguan — Enhanced */}
    {(() => {
      // Hitung ranking: siapa top performer minggu ini
      const perfList = teknisiData.map(t => ({ ...t, p: perfMap[t.name] || {} }));
      const maxJobs = Math.max(...perfList.map(t => t.p.jobsMinggu || 0), 1);
      const rankedByJob = [...perfList].sort((a, b) => (b.p.jobsMinggu || 0) - (a.p.jobsMinggu || 0));
      const topName = rankedByJob[0]?.name;
      return (
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 16, marginTop: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>📊 Rekap Performa Tim — 7 Hari Terakhir</div>
            <div style={{ fontSize: 11, color: cs.muted }}>
              Total job: <strong style={{ color: cs.accent }}>{perfList.reduce((a, t) => a + (t.p.jobsMinggu || 0), 0)}</strong>
              &nbsp;·&nbsp;Stuck: <strong style={{ color: cs.red }}>{perfList.reduce((a, t) => a + (t.p.stuck || 0), 0)}</strong>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: cs.surface }}>
                  {["#", "Teknisi", "Role", "Job 7hr", "Selesai", "Rate", "Bar", "Revisi", "Laporan", "Stuck", "Status"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: cs.muted, borderBottom: "1px solid " + cs.border }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rankedByJob.map((t, i) => {
                  const p = t.p;
                  const completionRate = (p.jobsMinggu || 0) > 0 ? Math.round(((p.selesai || 0) / (p.jobsMinggu || 1)) * 100) : 0;
                  const barPct = maxJobs > 0 ? Math.round(((p.jobsMinggu || 0) / maxJobs) * 100) : 0;
                  const isTop = t.name === topName && (p.jobsMinggu || 0) > 0;
                  const hasIssue = (p.stuck || 0) > 0 || (p.revisi || 0) > 2;
                  const rowBg = isTop ? cs.green + "0d" : hasIssue ? cs.red + "0d" : "transparent";
                  const rateColor = completionRate >= 80 ? cs.green : completionRate >= 50 ? cs.yellow : cs.red;
                  return (
                    <tr key={t.id} style={{ borderBottom: "1px solid " + cs.border + "55", background: rowBg }}>
                      <td style={{ padding: "8px 10px", color: cs.muted, fontWeight: 700 }}>
                        {isTop ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1)}
                      </td>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: cs.text }}>
                        {t.name}
                        {isTop && <span style={{ fontSize: 9, background: cs.green + "22", color: cs.green, borderRadius: 99, padding: "1px 6px", marginLeft: 4, fontWeight: 700 }}>TOP</span>}
                      </td>
                      <td style={{ padding: "8px 10px", color: cs.muted, fontSize: 11 }}>{t.role}</td>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: cs.accent, fontSize: 14 }}>{p.jobsMinggu || 0}</td>
                      <td style={{ padding: "8px 10px", color: cs.green }}>{p.selesai || 0}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ fontWeight: 700, color: rateColor }}>{completionRate}%</span>
                      </td>
                      <td style={{ padding: "8px 10px", minWidth: 80 }}>
                        <div style={{ background: cs.surface, borderRadius: 99, height: 6, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: barPct + "%", background: isTop ? cs.green : cs.accent, borderRadius: 99, transition: "width 0.5s" }} />
                        </div>
                      </td>
                      <td style={{ padding: "8px 10px", color: (p.revisi || 0) > 0 ? cs.yellow : cs.muted }}>
                        {(p.revisi || 0) > 0 ? "🔄 " + (p.revisi || 0) : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", color: cs.muted }}>{p.laporanMinggu || 0}</td>
                      <td style={{ padding: "8px 10px", color: (p.stuck || 0) > 0 ? cs.red : cs.muted, fontWeight: (p.stuck || 0) > 0 ? 700 : 400 }}>
                        {(p.stuck || 0) > 0 ? <span style={{ background: cs.red + "22", color: cs.red, borderRadius: 99, padding: "2px 7px", fontSize: 10 }}>⚠️ {p.stuck} stuck</span> : "—"}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        {(p.stuck || 0) > 0
                          ? <span style={{ fontSize: 10, color: cs.red, fontWeight: 700 }}>⚡ Perlu Perhatian</span>
                          : completionRate >= 80
                            ? <span style={{ fontSize: 10, color: cs.green }}>✅ Baik</span>
                            : completionRate > 0
                              ? <span style={{ fontSize: 10, color: cs.yellow }}>📈 Berkembang</span>
                              : <span style={{ fontSize: 10, color: cs.muted }}>—</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Legend */}
          <div style={{ marginTop: 10, display: "flex", gap: 14, fontSize: 10, color: cs.muted, flexWrap: "wrap" }}>
            <span>🥇 Top performer</span>
            <span style={{ color: cs.green }}>■ Rate ≥80% = Baik</span>
            <span style={{ color: cs.yellow }}>■ Rate 50-79% = Berkembang</span>
            <span style={{ color: cs.red }}>■ Rate &lt;50% atau ada stuck</span>
          </div>
        </div>
      );
    })()}
    </>}

    {/* ── TAB: PENGELOLAAN GAJI ── */}
    {activeTab === "gaji" && <GajiTab
      teknisiData={teknisiData}
      ordersData={ordersData}
      invoicesData={invoicesData}
      currentUser={currentUser}
      supabase={supabase}
      showNotif={showNotif}
      showConfirm={showConfirm}
      openWA={openWA}
      TODAY={TODAY}
    />}
  </div>
);
}

// ═══════════════════════════════════════════════════════════════
// GAJI TAB — Payroll + Komisi Order
// ═══════════════════════════════════════════════════════════════
function GajiTab({ teknisiData, ordersData, invoicesData, currentUser, supabase, showNotif, showConfirm, openWA, TODAY }) {
  const [subTab, setSubTab]         = useState("payroll"); // "payroll" | "komisi"
  const [periodStart, setPeriodStart] = useState(() => getMondayOf(TODAY));
  const periodEnd = getSaturdayOf(periodStart);

  // ── Payroll state ──
  const [payrollRows, setPayrollRows] = useState([]);
  const [loadingPayroll, setLoadingPayroll] = useState(false);
  const [editingRate, setEditingRate] = useState({}); // { userId: draftValue }
  const [localRates, setLocalRates]   = useState({}); // { userId: savedRate }
  const [slipPreview, setSlipPreview] = useState(null);
  // localBonus: { rowId: [{label, amount}] } — local buffer, no DB call on each keystroke
  const [localBonus, setLocalBonus]   = useState({});

  // ── Komisi state (periode BULANAN — terpisah dari payroll mingguan) ──
  const [bonusMonth, setBonusMonth]     = useState(() => todayYearMonth()); // "2026-05"
  const bonusStart = getMonthStart(bonusMonth);
  const bonusEnd   = getMonthEnd(bonusMonth);
  const [bonuses, setBonuses]           = useState([]);
  const [ordersNoBonus, setOrdersNoBonus] = useState([]);
  const [periodInvMap, setPeriodInvMap] = useState({}); // { invoiceId: { id, total, materials_detail } }
  const [loadingBonus, setLoadingBonus] = useState(false);
  const [bonusForm, setBonusForm]       = useState(null); // order sedang direview
  const [voidForm, setVoidForm]         = useState(null); // { id, reason }
  const [bonusFilter, setBonusFilter]   = useState("ALL"); // ALL|PENDING|ELIGIBLE|PAID|VOID

  const isOwner = currentUser?.role === "Owner";

  // ── Load payroll ──
  const loadPayroll = useCallback(async () => {
    setLoadingPayroll(true);
    const { data } = await fetchWeeklyPayroll(supabase, periodStart);
    setPayrollRows(data || []);
    setLoadingPayroll(false);
  }, [supabase, periodStart]);

  // ── Load bonuses (periode BULANAN) ──
  const loadBonuses = useCallback(async () => {
    setLoadingBonus(true);
    const [bonRes, ordRes] = await Promise.all([
      fetchOrderBonusesByPeriod(supabase, bonusStart, bonusEnd),
      fetchOrdersWithoutBonus(supabase, bonusStart, bonusEnd),
    ]);
    setBonuses(bonRes.data || []);

    const orders = ordRes.data || [];
    // Ambil invoice_id dari orders yang ada, lalu fetch langsung — tidak bergantung prop invoicesData global
    const invoiceIds = [...new Set(orders.map(o => o.invoice_id).filter(Boolean))];
    let fetchedInvMap = {};
    if (invoiceIds.length > 0) {
      const { data: invRows } = await supabase.from("invoices")
        .select("id,total,materials_detail")
        .in("id", invoiceIds);
      fetchedInvMap = Object.fromEntries((invRows || []).map(i => [i.id, i]));
    }

    // Filter orders: belum ada bonus entry + memenuhi kriteria bonus
    // 3 kategori: 1) Omset > 1jt (bukan pemasangan), 2) Pemasangan >= 2 unit, 3) Freon/Kapasitor
    const existingOrderIds = new Set((bonRes.data || []).map(b => b.order_id));
    const eligible = orders.filter(o => {
      if (existingOrderIds.has(o.id)) return false;
      const inv = fetchedInvMap[o.invoice_id];
      const invTotal = Number(inv?.total || 0);
      const det = detectBonusFromInvoice(inv?.materials_detail, o.service);
      // Kategori 1: Omset >= 1jt (non-Install), atau Install >= 1,5jt
      const isOmsetBesar = (o.service !== "Install" && invTotal >= 1000000) ||
                           (o.service === "Install" && invTotal >= 1500000);
      // Kategori 2: Pemasangan >= 2 unit
      const isInstallMulti = o.service === "Install" && Number(o.units) >= 2;
      // Kategori 3: Ada freon, kapasitor, atau thermis (tidak perlu threshold nilai invoice)
      const hasSpecialService = det.freon || det.kapasitor || det.thermis;
      return isOmsetBesar || isInstallMulti || hasSpecialService;
    });
    setPeriodInvMap(fetchedInvMap);
    setOrdersNoBonus(eligible);
    setLoadingBonus(false);
  }, [supabase, bonusStart, bonusEnd]);

  useEffect(() => { if (subTab === "payroll") loadPayroll(); }, [subTab, loadPayroll]);
  useEffect(() => { if (subTab === "komisi") loadBonuses(); }, [subTab, loadBonuses]);

  // Sync localBonus dari payrollRows setiap kali rows berubah
  useEffect(() => {
    const parsed = {};
    payrollRows.forEach(row => {
      try {
        const arr = JSON.parse(row.manual_bonus_note || "[]");
        if (Array.isArray(arr) && arr.length > 0 && arr[0] && typeof arr[0] === "object") {
          parsed[row.id] = arr;
        } else throw new Error();
      } catch {
        parsed[row.id] = Number(row.manual_bonus) > 0
          ? [{ label: (row.manual_bonus_note && !row.manual_bonus_note.startsWith("[")) ? row.manual_bonus_note : "Bonus Manual", amount: Number(row.manual_bonus) }]
          : [];
      }
    });
    setLocalBonus(prev => ({ ...prev, ...parsed }));
  }, [payrollRows]);

  // ── Generate payroll untuk semua aktif teknisi/helper ──
  const handleGenerate = async () => {
    setLoadingPayroll(true);
    const aktif = teknisiData.filter(t => t.active && ["Teknisi","Helper"].includes(t.role));

    // Ambil payroll minggu lalu → hitung sisa kasbon yang di-carry ke minggu ini
    const { data: prevRows } = await fetchWeeklyPayroll(supabase, addWeeks(periodStart, -1));
    const prevMap = Object.fromEntries((prevRows || []).map(r => [r.user_id, r]));

    const results = await Promise.all(aktif.map(async (t) => {
      // Hari masuk dari orders + kasbon + availability override (paralel)
      const [oRes, kRes, aRes] = await Promise.all([
        fetchDaysWorkedFromOrders(supabase, t.name, periodStart, periodEnd),
        fetchKasbonByPeriod(supabase, t.name, periodStart, periodEnd),
        fetchAvailabilityByUserPeriod(supabase, t.name, periodStart, periodEnd),
      ]);
      // Hybrid: auto dari orders, +STANDBY, −IJIN/SAKIT/ALPA
      const orderDates = new Set((oRes.data || []).map(o => o.date));
      for (const a of (aRes.data || [])) {
        if (a.status === "STANDBY") orderDates.add(a.date);
        else if (["IJIN","SAKIT","ALPA"].includes(a.status)) orderDates.delete(a.date);
      }
      const daysWorked = orderDates.size;
      const kasbonTotal = (kRes.data || []).reduce((s, e) => s + Number(e.amount), 0);

      const existing = payrollRows.find(r => r.user_id === t.id);
      const prev = prevMap[t.id];
      const carryIn = prev ? kasbonSisa(prev) : 0;        // sisa kasbon minggu lalu
      const owed = kasbonTotal + carryIn;

      return upsertWeeklyPayroll(supabase, {
        user_id:        t.id,
        user_name:      t.name,
        role:           t.role,
        period_start:   periodStart,
        period_end:     periodEnd,
        days_worked:    existing?.days_override ? existing.days_worked : daysWorked,
        days_override:  existing?.days_override || false,
        daily_rate:     localRates[t.id] ?? t.daily_rate ?? 0,
        late_days:      existing?.late_days || 0,
        full_week_bonus: existing?.full_week_bonus || false,
        kasbon_total:   kasbonTotal,
        kasbon_carryover: carryIn,
        // Pertahankan keputusan potong admin kalau row sudah ada; default potong penuh
        kasbon_deduct:  existing ? Number(existing.kasbon_deduct || 0) : owed,
        manual_bonus:   existing?.manual_bonus || 0,
        manual_bonus_note: existing?.manual_bonus_note || null,
        is_paid:        existing?.is_paid || false,
        created_by:     currentUser?.name,
      });
    }));

    const failed = results.find(r => r.error);
    if (failed) { showNotif?.("❌ Gagal generate: " + failed.error.message); setLoadingPayroll(false); return; }
    await loadPayroll();
    showNotif?.("✅ Slip gaji minggu ini berhasil di-generate");
  };

  // ── Update field satu row ──
  const handleUpdateField = async (row, field, value) => {
    const update = { [field]: value };
    if (field === "days_worked") update.days_override = true;
    const { error } = await updateWeeklyPayroll(supabase, row.id, update);
    if (error) { showNotif?.("❌ Gagal update: " + error.message); return; }
    setPayrollRows(prev => prev.map(r => r.id === row.id ? { ...r, ...update } : r));
  };

  // ── Simpan bonus manual ke DB (dipanggil onBlur / on add / on delete) ──
  const saveManualBonus = async (rowId, entries) => {
    const total = entries.reduce((s, e) => s + Number(e.amount || 0), 0);
    const note  = JSON.stringify(entries);
    const { error } = await updateWeeklyPayroll(supabase, rowId, { manual_bonus: total, manual_bonus_note: note });
    if (error) { showNotif?.("❌ Gagal simpan bonus manual: " + error.message); return; }
    setPayrollRows(prev => prev.map(r => r.id === rowId ? { ...r, manual_bonus: total, manual_bonus_note: note } : r));
  };

  // ── Tandai bayar ──
  const handlePaid = async (row) => {
    showConfirm?.({
      message: `Tandai payroll ${row.user_name} (${fmtDate(row.period_start)} – ${fmtDate(row.period_end)}) sebagai DIBAYAR?`,
      confirmText: "Ya, Tandai Dibayar",
      onConfirm: async () => {
        const { error } = await markPayrollPaid(supabase, row.id, currentUser?.name);
        if (error) { showNotif?.("❌ Gagal tandai bayar: " + error.message); return; }
        setPayrollRows(prev => prev.map(r => r.id === row.id ? { ...r, is_paid: true, paid_at: new Date().toISOString(), paid_by: currentUser?.name } : r));
        showNotif?.("✅ Payroll " + row.user_name + " ditandai dibayar");
      }
    });
  };

  // ── Buka kunci slip yang sudah dibayar (Owner only) ──
  const handleUnlock = async (row) => {
    const { error } = await updateWeeklyPayroll(supabase, row.id, { is_paid: false, paid_at: null, paid_by: null });
    if (error) { showNotif?.("❌ Gagal buka kunci: " + error.message); return; }
    setPayrollRows(prev => prev.map(r => r.id === row.id ? { ...r, is_paid: false, paid_at: null, paid_by: null } : r));
    showNotif?.("🔓 Slip " + row.user_name + " dibuka — bisa diedit lagi");
  };

  // ── Simpan satu field ke DB (dipanggil onBlur input bebas, anti-lag) ──
  const saveField = async (rowId, fields) => {
    const { error } = await updateWeeklyPayroll(supabase, rowId, fields);
    if (error) showNotif?.("❌ Gagal simpan: " + error.message);
  };

  // ── Build slip message ──
  const buildSlipMsg = (row, bonusMinggu = []) => {
    const totalBonus = bonusMinggu.reduce((s, b) => s + Number(b.amount_per_person || 0), 0);
    const late     = row.late_days > 0 ? `\nTelat Masuk : ${row.late_days} hari × -Rp 10.000 = -Rp ${(row.late_days * 10000).toLocaleString("id-ID")}` : "";
    const deducted = Number(row.kasbon_deduct || 0);
    const sisa     = kasbonSisa(row);
    const kasbon   = deducted > 0 ? `\nKasbon Dipotong : -${fmtRp(deducted)}` : "";
    const kasbonSisaLine = sisa > 0 ? `\n_Sisa kasbon dikreditkan minggu depan: ${fmtRp(sisa)}_` : "";
    const fullWeek = row.full_week_bonus ? `\nBonus Full Week : +${fmtRp(fullWeekBonusAmt(row.role))}` : "";
    // Parse multi-entry bonus manual
    let manualEntries = localBonus[row.id] || [];
    if (manualEntries.length === 0 && Number(row.manual_bonus) > 0) {
      manualEntries = [{ label: row.manual_bonus_note || "Bonus Manual", amount: Number(row.manual_bonus) }];
    }
    const manLines = manualEntries.filter(e => Number(e.amount) > 0)
      .map(e => `\nBonus Manual : +${fmtRp(e.amount)}${e.label ? " (" + e.label + ")" : ""}`)
      .join("");
    const bonusLines = bonusMinggu.map(b => `[${b.order_id || "-"}] ${BONUS_LABELS[b.bonus_type] || b.bonus_type} : +${fmtRp(b.amount_per_person)}`).join("\n");
    const gross = computeGross(row);
    return `📋 *SLIP GAJI MINGGUAN*\n━━━━━━━━━━━━━━━━━━━━━\n👷 *${row.user_name}* | ${row.role}\nPeriode: ${fmtDate(row.period_start)} – ${fmtDate(row.period_end)}\n━━━━━━━━━━━━━━━━━━━━━\n*GAJI POKOK*\nHari Masuk : ${row.days_worked} hari × ${fmtRp(row.daily_rate)}\n             = ${fmtRp(row.days_worked * row.daily_rate)}${fullWeek}${late}${kasbon}${manLines}${kasbonSisaLine}\n━━━━━━━━━━━━━━━━━━━━━\n*KOMISI ORDER*\n${bonusLines || "Belum ada komisi dibayar minggu ini"}\nTotal Komisi : ${fmtRp(totalBonus)}\n━━━━━━━━━━━━━━━━━━━━━\n*TOTAL GAJI : ${fmtRp(gross)}*\nStatus : ${row.is_paid ? "✅ SUDAH DIBAYAR" : "⏳ BELUM DIBAYAR"}\n━━━━━━━━━━━━━━━━━━━━━`;
  };

  // ── Kirim WA slip ──
  const handleSendWA = async (row) => {
    const t = teknisiData.find(x => x.id === row.user_id);
    if (!t?.phone) { showNotif?.("❌ Nomor HP " + row.user_name + " tidak ditemukan"); return; }
    const bonusMinggu = bonuses.filter(b =>
      b.status === "PAID" && (b.team_members || []).includes(row.user_name) &&
      b.order_date >= bonusStart && b.order_date <= bonusEnd
    );
    const msg = buildSlipMsg(row, bonusMinggu);
    openWA?.(t.phone, msg);
    await updateWeeklyPayroll(supabase, row.id, { wa_sent_at: new Date().toISOString() });
    showNotif?.("📤 WA slip dikirim ke " + row.user_name);
  };

  // ── Update daily_rate dari UI ──
  const handleSaveRate = async (t) => {
    const newRate = Number(editingRate[t.id] ?? localRates[t.id] ?? t.daily_rate ?? 0);
    const { error } = await updateUserDailyRate(supabase, t.id, newRate);
    if (error) { showNotif?.("❌ Gagal simpan: " + error.message); return; }
    setLocalRates(prev => ({ ...prev, [t.id]: newRate }));
    setEditingRate(prev => { const p = { ...prev }; delete p[t.id]; return p; });
    showNotif?.("✅ Gaji harian " + t.name + " disimpan: " + fmtRp(newRate));
  };

  const handleDeleteRate = async (t) => {
    await updateUserDailyRate(supabase, t.id, 0);
    setLocalRates(prev => ({ ...prev, [t.id]: 0 }));
    setEditingRate(prev => { const p = { ...prev }; delete p[t.id]; return p; });
    showNotif?.("🗑 Gaji harian " + t.name + " direset ke 0");
  };

  // ── Simpan bonus order ──
  const handleSaveBonus = async (orderRow, bonusType, grossRevenue, materialCost, teamMembers, totalAmount, note) => {
    const { error } = await insertOrderBonus(supabase, {
      order_id:      orderRow.id,
      order_date:    orderRow.date,
      bonus_type:    bonusType,
      gross_revenue: grossRevenue || null,
      material_cost: materialCost || null,
      team_members:  teamMembers,
      total_amount:  totalAmount,
      note:          note || null,
      status:        "PENDING",
    }, currentUser?.name);
    if (error) { showNotif?.("❌ " + error.message); return; }
    setBonusForm(null);
    loadBonuses();
    showNotif?.("✅ Bonus disimpan. Status: PENDING (dalam masa warranty)");
  };

  // ── Void bonus ──
  const handleVoid = async () => {
    if (!voidForm?.reason?.trim()) { showNotif?.("❌ Isi alasan void"); return; }
    await voidBonus(supabase, voidForm.id, voidForm.reason, currentUser?.name);
    setVoidForm(null);
    loadBonuses();
    showNotif?.("✅ Bonus di-void: " + voidForm.reason);
  };

  // ── Mark bonus PAID ──
  const handleMarkBonusPaid = async (bonus) => {
    showConfirm?.({
      message: `Tandai bonus ${BONUS_LABELS[bonus.bonus_type]} [${bonus.order_id}] sebagai DIBAYAR?\nTotal: ${fmtRp(bonus.total_amount)} dibagi ${bonus.member_count} orang = ${fmtRp(bonus.amount_per_person)}/orang`,
      confirmText: "Ya, Tandai Dibayar",
      onConfirm: async () => {
        await markBonusPaid(supabase, bonus.id, currentUser?.name);
        loadBonuses();
        showNotif?.("✅ Bonus ditandai dibayar");
      }
    });
  };

  const fmt = n => Number(n || 0).toLocaleString("id-ID");

  const filteredBonuses = bonusFilter === "ALL" ? bonuses : bonuses.filter(b => effBonusStatus(b) === bonusFilter);

  // ── WA bubble renderer (shared) ──
  const renderWABubble = (msg, row) => {
    const lines = msg.split("\n").map((line, i) => {
      const parts = line.split(/(\*[^*]+\*)/g);
      return (
        <div key={i} style={{ minHeight: "1.2em" }}>
          {parts.map((p, j) =>
            p.startsWith("*") && p.endsWith("*")
              ? <strong key={j}>{p.slice(1, -1)}</strong>
              : <span key={j}>{p}</span>
          )}
        </div>
      );
    });
    return (
      <div style={{ background: "#0b1c0b", borderRadius: 10, padding: "4px 8px 8px", marginTop: 4 }}>
        {/* Chat header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 6px 10px", borderBottom: "1px solid #1a3a1a" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#25d366", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>
            {row.role === "Teknisi" ? "🔧" : "🤝"}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12, color: "#e9edef" }}>{row.user_name}</div>
            <div style={{ fontSize: 10, color: "#8696a0" }}>{row.role}</div>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 10, color: "#8696a0" }}>AClean</div>
        </div>
        {/* Bubble */}
        <div style={{ padding: "8px 8px 4px" }}>
          <div style={{ background: "#025c4c", borderRadius: "0 10px 10px 10px", padding: "10px 12px", maxWidth: "90%", marginLeft: 6, position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: -6, width: 0, height: 0, borderRight: "8px solid #025c4c", borderBottom: "8px solid transparent" }} />
            <div style={{ fontFamily: "monospace", fontSize: 11.5, lineHeight: 1.6, color: "#e9edef", wordBreak: "break-word" }}>
              {lines}
            </div>
            <div style={{ fontSize: 10, color: "#8696a0", textAlign: "right", marginTop: 6 }}>
              {new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} ✓✓
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Sub-tab */}
      <div style={{ display: "flex", gap: 8 }}>
        {[{ k: "payroll", l: "💵 Payroll Mingguan" }, { k: "komisi", l: "🎯 Komisi Order" }].map(s => (
          <button key={s.k} onClick={() => setSubTab(s.k)} style={{
            padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13, border: "1px solid",
            borderColor: subTab === s.k ? cs.accent : cs.border,
            background: subTab === s.k ? cs.accent : cs.surface,
            color: subTab === s.k ? "#fff" : cs.muted,
          }}>{s.l}</button>
        ))}
      </div>

      {/* ── PAYROLL ── */}
      {subTab === "payroll" && (() => {
        const aktif = teknisiData.filter(t => t.active && ["Teknisi","Helper"].includes(t.role));
        return (
          <div style={{ display: "grid", gap: 14 }}>
            {/* Period selector + actions */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => setPeriodStart(addWeeks(periodStart, -1))} style={{ padding: "6px 12px", borderRadius: 6, background: cs.surface, border: "1px solid " + cs.border, color: cs.text, cursor: "pointer", fontSize: 13 }}>← Minggu Lalu</button>
              <div style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>
                📅 {fmtDate(periodStart)} — {fmtDate(periodEnd)}
              </div>
              <button onClick={() => setPeriodStart(addWeeks(periodStart, 1))} style={{ padding: "6px 12px", borderRadius: 6, background: cs.surface, border: "1px solid " + cs.border, color: cs.text, cursor: "pointer", fontSize: 13 }}>Minggu Depan →</button>
              <button onClick={() => setPeriodStart(getMondayOf(TODAY))} style={{ padding: "6px 12px", borderRadius: 6, background: cs.surface, border: "1px solid " + cs.border, color: cs.accent, cursor: "pointer", fontSize: 13 }}>Minggu Ini</button>
              <button onClick={handleGenerate} style={{ padding: "6px 16px", borderRadius: 6, background: cs.accent, border: "none", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                🔄 Generate / Refresh
              </button>
            </div>

            {/* Konfigurasi gaji harian */}
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: cs.muted, marginBottom: 4 }}>⚙️ Konfigurasi Gaji Harian</div>
              <div style={{ fontSize: 11, color: cs.muted, marginBottom: 10 }}>Ketik nominal → klik ✓ Simpan untuk menyimpan. Klik nilai tersimpan untuk edit.</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px,1fr))", gap: 10 }}>
                {aktif.map(t => {
                  const savedRate = localRates[t.id] ?? t.daily_rate ?? 0;
                  const isDirty   = editingRate[t.id] !== undefined;
                  const isEditing = isDirty;
                  return (
                    <div key={t.id} style={{ background: cs.card, borderRadius: 8, padding: "10px 12px", border: "1px solid " + (isEditing ? cs.accent : savedRate > 0 ? cs.green + "55" : cs.border) }}>
                      {/* Nama + role */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 13 }}>{t.role === "Teknisi" ? "🔧" : "🤝"}</span>
                        <span style={{ fontWeight: 700, fontSize: 13, color: cs.text, flex: 1 }}>{t.name}</span>
                        <span style={{ fontSize: 10, color: cs.muted, background: cs.surface, borderRadius: 4, padding: "1px 5px" }}>{t.role}</span>
                      </div>
                      {/* Input + actions */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 11, color: cs.muted }}>Rp</span>
                        <input
                          type="number"
                          value={isDirty ? editingRate[t.id] : savedRate}
                          onChange={e => setEditingRate(prev => ({ ...prev, [t.id]: e.target.value }))}
                          placeholder="0"
                          style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid " + (isEditing ? cs.accent : cs.border), background: cs.surface, color: cs.text, fontSize: 13, textAlign: "right" }}
                        />
                        {isDirty ? (
                          <>
                            <button onClick={() => handleSaveRate(t)} title="Simpan" style={{ padding: "4px 10px", borderRadius: 5, background: cs.accent, border: "none", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✓ Simpan</button>
                            <button onClick={() => setEditingRate(prev => { const p={...prev}; delete p[t.id]; return p; })} title="Batal" style={{ padding: "4px 8px", borderRadius: 5, background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 11 }}>✕</button>
                          </>
                        ) : savedRate > 0 ? (
                          <button onClick={() => handleDeleteRate(t)} title="Reset ke 0" style={{ padding: "4px 8px", borderRadius: 5, background: "transparent", border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 10 }}>🗑</button>
                        ) : null}
                      </div>
                      {/* Saved indicator */}
                      {savedRate > 0 && !isDirty && (
                        <div style={{ fontSize: 10, color: cs.green, marginTop: 4 }}>✅ Tersimpan: Rp {Number(savedRate).toLocaleString("id-ID")}/hari</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Ringkasan total payroll minggu ini ── */}
            {payrollRows.length > 0 && (() => {
              const totalGross   = payrollRows.reduce((s, r) => s + computeGross(r), 0);
              const totalPokok   = payrollRows.reduce((s, r) => s + Number(r.days_worked || 0) * Number(r.daily_rate || 0), 0);
              const totalFullWk  = payrollRows.reduce((s, r) => s + (r.full_week_bonus ? fullWeekBonusAmt(r.role) : 0), 0);
              const totalPotongan= payrollRows.reduce((s, r) => s + Number(r.late_days || 0) * 10000 + Number(r.kasbon_deduct || 0), 0);
              const totalManual  = payrollRows.reduce((s, r) => s + Number(r.manual_bonus || 0), 0);
              const totalSisaKasbon = payrollRows.reduce((s, r) => s + kasbonSisa(r), 0);
              const sudahBayar   = payrollRows.filter(r => r.is_paid);
              const belumBayar   = payrollRows.filter(r => !r.is_paid);
              const totalSudah   = sudahBayar.reduce((s, r) => s + computeGross(r), 0);
              const totalBelum   = belumBayar.reduce((s, r) => s + computeGross(r), 0);
              const teknisiRows  = payrollRows.filter(r => r.role === "Teknisi");
              const helperRows   = payrollRows.filter(r => r.role === "Helper");
              return (
                <div style={{ background: cs.surface, border: "1px solid " + cs.accent + "55", borderRadius: 12, padding: 16 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: cs.accent, marginBottom: 12 }}>
                    📊 Ringkasan Payroll — {fmtDate(periodStart)} s/d {fmtDate(periodEnd)}
                  </div>
                  {/* Total besar */}
                  <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 140, background: cs.card, borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>TOTAL GAJI KESELURUHAN</div>
                      <div style={{ fontWeight: 900, fontSize: 22, color: cs.accent }}>{fmtRp(totalGross)}</div>
                      <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{payrollRows.length} orang</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 120, background: cs.card, borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>✅ SUDAH DIBAYAR</div>
                      <div style={{ fontWeight: 800, fontSize: 18, color: cs.green }}>{fmtRp(totalSudah)}</div>
                      <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{sudahBayar.length} orang</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 120, background: cs.card, borderRadius: 10, padding: "12px 16px", textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>⏳ BELUM DIBAYAR</div>
                      <div style={{ fontWeight: 800, fontSize: 18, color: cs.yellow }}>{fmtRp(totalBelum)}</div>
                      <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{belumBayar.length} orang</div>
                    </div>
                  </div>
                  {/* Breakdown komponen */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8, marginBottom: 12 }}>
                    {[
                      { label: "Gaji Pokok", val: totalPokok, color: cs.text },
                      { label: "Bonus Full Week", val: totalFullWk, color: cs.green },
                      { label: "Bonus Manual", val: totalManual, color: cs.accent },
                      { label: "Potongan (telat+kasbon)", val: -totalPotongan, color: cs.red },
                      { label: "Sisa Kasbon → mgg depan", val: totalSisaKasbon, color: cs.yellow },
                    ].map(item => (
                      <div key={item.label} style={{ background: cs.card, borderRadius: 8, padding: "8px 12px" }}>
                        <div style={{ fontSize: 10, color: cs.muted }}>{item.label}</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: item.color }}>
                          {item.val < 0 ? "-" : ""}{fmtRp(Math.abs(item.val))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Per role */}
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1, background: cs.card, borderRadius: 8, padding: "8px 12px" }}>
                      <div style={{ fontSize: 10, color: cs.muted, marginBottom: 2 }}>🔧 Teknisi ({teknisiRows.length})</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>{fmtRp(teknisiRows.reduce((s,r)=>s+computeGross(r),0))}</div>
                    </div>
                    <div style={{ flex: 1, background: cs.card, borderRadius: 8, padding: "8px 12px" }}>
                      <div style={{ fontSize: 10, color: cs.muted, marginBottom: 2 }}>🤝 Helper ({helperRows.length})</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>{fmtRp(helperRows.reduce((s,r)=>s+computeGross(r),0))}</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Slip cards */}
            {loadingPayroll ? (
              <div style={{ color: cs.muted, fontSize: 13, padding: 20, textAlign: "center" }}>Memuat data...</div>
            ) : payrollRows.length === 0 ? (
              <div style={{ background: cs.surface, borderRadius: 10, padding: 24, textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                <div style={{ color: cs.muted, fontSize: 14 }}>Belum ada slip minggu ini.</div>
                <div style={{ color: cs.muted, fontSize: 12, marginTop: 4 }}>Klik "Generate / Refresh" untuk membuat otomatis dari data order.</div>
              </div>
            ) : payrollRows.map(row => {
              const gross = computeGross(row);
              const fullBonus = fullWeekBonusAmt(row.role);
              const locked = row.is_paid;          // slip dibayar → terkunci
              const owed   = kasbonOwed(row);
              const sisaKasbon = kasbonSisa(row);
              return (
                <div key={row.id} style={{ background: cs.card, border: "1px solid " + (row.is_paid ? cs.green : cs.border), borderRadius: 12, padding: 16, position: "relative", opacity: locked ? 0.92 : 1 }}>
                  {row.is_paid && <span style={{ position: "absolute", top: 12, right: 12, background: cs.green, color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>✅ DIBAYAR</span>}

                  {/* Header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <span style={{ fontSize: 20 }}>{row.role === "Helper" ? "🤝" : "🔧"}</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>{row.user_name}</div>
                      <div style={{ fontSize: 11, color: cs.muted }}>{row.role} · {fmtRp(row.daily_rate)}/hari</div>
                    </div>
                  </div>

                  {/* Grid detail */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    {/* Hari masuk */}
                    <div style={{ background: cs.surface, borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Hari Masuk {row.days_override ? "✏️" : "(auto)"}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input type="number" min={0} max={6} value={row.days_worked} disabled={locked}
                          onChange={e => {
                            const v = Math.max(0, Math.min(6, Number(e.target.value)));
                            setPayrollRows(prev => prev.map(r => r.id === row.id ? { ...r, days_worked: v, days_override: true } : r));
                          }}
                          onBlur={e => saveField(row.id, { days_worked: Math.max(0, Math.min(6, Number(e.target.value))), days_override: true })}
                          style={{ width: 50, padding: "4px 6px", borderRadius: 6, border: "1px solid " + cs.border, background: cs.card, color: cs.text, fontSize: 14, fontWeight: 700, textAlign: "center" }}
                        />
                        <span style={{ fontSize: 12, color: cs.muted }}>hari = {fmtRp(row.days_worked * row.daily_rate)}</span>
                      </div>
                    </div>

                    {/* Telat */}
                    <div style={{ background: cs.surface, borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Telat Masuk (×-Rp 10.000)</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {[0,1,2,3,4,5].map(n => (
                          <button key={n} disabled={locked} onClick={() => handleUpdateField(row, "late_days", n)}
                            style={{ padding: "3px 8px", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: locked ? "not-allowed" : "pointer", border: "1px solid",
                              background: row.late_days === n ? cs.red : cs.card,
                              borderColor: row.late_days === n ? cs.red : cs.border,
                              color: row.late_days === n ? "#fff" : cs.muted }}>
                            {n}
                          </button>
                        ))}
                      </div>
                      {row.late_days > 0 && <div style={{ fontSize: 11, color: cs.red, marginTop: 4 }}>-{fmtRp(row.late_days * 10000)}</div>}
                    </div>

                    {/* Full week bonus */}
                    <div style={{ background: cs.surface, borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Bonus Full Week (Senin–Sabtu)</div>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: locked ? "not-allowed" : "pointer" }}>
                        <input type="checkbox" checked={row.full_week_bonus} disabled={locked}
                          onChange={e => handleUpdateField(row, "full_week_bonus", e.target.checked)}
                          style={{ width: 16, height: 16 }}
                        />
                        <span style={{ fontWeight: 700, fontSize: 13, color: row.full_week_bonus ? cs.green : cs.muted }}>
                          {row.full_week_bonus ? "✅ +" + fmtRp(fullBonus) : "Belum dapat"}
                        </span>
                      </label>
                    </div>

                    {/* Kasbon — bisa dipotong sebagian, sisa carryover */}
                    <div style={{ background: cs.surface, borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>
                        Kasbon Terutang: <strong style={{ color: owed > 0 ? cs.red : cs.muted }}>{fmtRp(owed)}</strong>
                        {Number(row.kasbon_carryover) > 0 && <span style={{ color: cs.yellow }}> (incl. sisa lalu {fmtRp(row.kasbon_carryover)})</span>}
                      </div>
                      {owed > 0 ? (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 11, color: cs.muted }}>Potong:</span>
                            <input type="number" min={0} max={owed} value={row.kasbon_deduct} disabled={locked}
                              onChange={e => {
                                const v = Math.max(0, Math.min(owed, Number(e.target.value)));
                                setPayrollRows(prev => prev.map(r => r.id === row.id ? { ...r, kasbon_deduct: v } : r));
                              }}
                              onBlur={e => saveField(row.id, { kasbon_deduct: Math.max(0, Math.min(owed, Number(e.target.value))) })}
                              style={{ width: 90, padding: "4px 6px", borderRadius: 6, border: "1px solid " + cs.border, background: cs.card, color: cs.text, fontSize: 13, fontWeight: 700, textAlign: "right" }}
                            />
                            {!locked && (
                              <>
                                <button onClick={() => { const v = Math.round(owed / 2); setPayrollRows(prev => prev.map(r => r.id === row.id ? { ...r, kasbon_deduct: v } : r)); saveField(row.id, { kasbon_deduct: v }); }}
                                  style={{ padding: "3px 8px", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1px solid " + cs.border, background: cs.card, color: cs.muted }}>50%</button>
                                <button onClick={() => { setPayrollRows(prev => prev.map(r => r.id === row.id ? { ...r, kasbon_deduct: owed } : r)); saveField(row.id, { kasbon_deduct: owed }); }}
                                  style={{ padding: "3px 8px", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1px solid " + cs.border, background: cs.card, color: cs.muted }}>Penuh</button>
                              </>
                            )}
                          </div>
                          {sisaKasbon > 0 && (
                            <div style={{ fontSize: 11, color: cs.yellow, marginTop: 4 }}>
                              ↪ Sisa {fmtRp(sisaKasbon)} dikreditkan ke minggu depan
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ fontWeight: 700, fontSize: 13, color: cs.muted }}>Rp 0</div>
                      )}
                    </div>
                  </div>

                  {/* Bonus manual — multi entry */}
                  <div style={{ background: cs.surface, borderRadius: 8, padding: 10, marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: cs.muted }}>Bonus Manual (Lembur / Lainnya)</div>
                      {!locked && <button onClick={() => {
                        const entries = [...(localBonus[row.id] || []), { label: "", amount: "" }];
                        setLocalBonus(prev => ({ ...prev, [row.id]: entries }));
                      }} style={{ padding: "2px 10px", borderRadius: 5, background: cs.accent, border: "none", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>+ Tambah</button>}
                    </div>
                    {(localBonus[row.id] || []).length === 0 && (
                      <div style={{ fontSize: 11, color: cs.muted, fontStyle: "italic" }}>Belum ada — klik + Tambah</div>
                    )}
                    {(localBonus[row.id] || []).map((entry, idx) => (
                      <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                        <input type="number" placeholder="Nominal" value={entry.amount} disabled={locked}
                          onChange={e => {
                            const entries = (localBonus[row.id] || []).map((en, i) => i === idx ? { ...en, amount: e.target.value } : en);
                            setLocalBonus(prev => ({ ...prev, [row.id]: entries }));
                          }}
                          onBlur={() => saveManualBonus(row.id, localBonus[row.id] || [])}
                          style={{ width: 110, padding: "5px 8px", borderRadius: 6, border: "1px solid " + cs.border, background: cs.card, color: cs.text, fontSize: 12 }}
                        />
                        <input type="text" placeholder="Keterangan (mis: lembur)"
                          value={entry.label} disabled={locked}
                          onChange={e => {
                            const entries = (localBonus[row.id] || []).map((en, i) => i === idx ? { ...en, label: e.target.value } : en);
                            setLocalBonus(prev => ({ ...prev, [row.id]: entries }));
                          }}
                          onBlur={() => saveManualBonus(row.id, localBonus[row.id] || [])}
                          style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid " + cs.border, background: cs.card, color: cs.text, fontSize: 12 }}
                        />
                        {!locked && <button onClick={() => {
                          const entries = (localBonus[row.id] || []).filter((_, i) => i !== idx);
                          setLocalBonus(prev => ({ ...prev, [row.id]: entries }));
                          saveManualBonus(row.id, entries);
                        }} title="Hapus" style={{ padding: "4px 8px", borderRadius: 5, background: "transparent", border: "1px solid " + cs.border, color: cs.red, cursor: "pointer", fontSize: 12 }}>✕</button>}
                      </div>
                    ))}
                    {(localBonus[row.id] || []).some(e => Number(e.amount) > 0) && (
                      <div style={{ fontSize: 11, color: cs.accent, marginTop: 4, fontWeight: 700 }}>
                        Total: {fmtRp((localBonus[row.id] || []).reduce((s, e) => s + Number(e.amount || 0), 0))}
                        <span style={{ color: cs.muted, fontWeight: 400, marginLeft: 8 }}>(tersimpan saat keluar dari kolom)</span>
                      </div>
                    )}
                  </div>

                  {/* Total + Actions */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, paddingTop: 12, borderTop: "1px solid " + cs.border }}>
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted }}>TOTAL GAJI</div>
                      <div style={{ fontWeight: 800, fontSize: 20, color: cs.accent }}>{fmtRp(gross)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => setSlipPreview(prev => prev === row.user_id ? null : row.user_id)}
                        style={{ padding: "7px 14px", borderRadius: 8, background: slipPreview === row.user_id ? cs.accent : cs.surface, border: "1px solid " + (slipPreview === row.user_id ? cs.accent : cs.border), color: slipPreview === row.user_id ? "#fff" : cs.text, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                        {slipPreview === row.user_id ? "▲ Tutup Preview" : "👁 Preview Slip"}
                      </button>
                      {!row.is_paid ? (
                        <button onClick={() => handlePaid(row)} style={{ padding: "7px 14px", borderRadius: 8, background: cs.green, border: "none", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                          ✓ Tandai Dibayar
                        </button>
                      ) : isOwner && (
                        <button onClick={() => handleUnlock(row)} style={{ padding: "7px 14px", borderRadius: 8, background: cs.surface, border: "1px solid " + cs.yellow, color: cs.yellow, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                          🔓 Buka Kunci
                        </button>
                      )}
                      <button onClick={() => handleSendWA(row)} style={{ padding: "7px 14px", borderRadius: 8, background: "#25d366", border: "none", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                        📤 Kirim WA
                      </button>
                    </div>
                  </div>
                  {row.is_paid && <div style={{ fontSize: 11, color: cs.muted, marginTop: 6 }}>Dibayar oleh {row.paid_by} · {row.paid_at ? new Date(row.paid_at).toLocaleString("id-ID") : "-"}</div>}

                  {/* ── Inline slip preview ── */}
                  {slipPreview === row.user_id && (() => {
                    const bonusMinggu = bonuses.filter(b =>
                      b.status === "PAID" && (b.team_members || []).includes(row.user_name) &&
                      b.order_date >= bonusStart && b.order_date <= bonusEnd
                    );
                    const msg = buildSlipMsg(row, bonusMinggu);
                    return (
                      <div style={{ marginTop: 14, borderTop: "1px solid " + cs.border, paddingTop: 14 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 8 }}>
                          📱 Preview WA Slip — {row.user_name}
                        </div>
                        {renderWABubble(msg, row)}
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button onClick={() => handleSendWA(row)}
                            style={{ flex: 1, padding: "9px 0", borderRadius: 8, background: "#25d366", border: "none", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                            📤 Kirim Slip via WA
                          </button>
                          <button onClick={() => { navigator.clipboard?.writeText(msg); showNotif?.("📋 Teks slip disalin"); }}
                            style={{ padding: "9px 14px", borderRadius: 8, background: cs.surface, border: "1px solid " + cs.border, color: cs.text, cursor: "pointer", fontSize: 12 }}>
                            📋 Copy Teks
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── KOMISI ORDER ── */}
      {subTab === "komisi" && (() => {
        return (
          <div style={{ display: "grid", gap: 14 }}>
            {/* Info */}
            <div style={{ background: "#1e3a5f", borderRadius: 10, padding: 12, fontSize: 12, color: "#93c5fd" }}>
              ℹ️ Komisi dibayar <strong>terpisah</strong> dari payroll, setelah 30–45 hari warranty. Status otomatis berubah ke <strong>Siap Cair</strong> setelah 30 hari. Bisa di-<strong>Void</strong> jika customer complain kasus yang sama.
            </div>

            {/* Period selector */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => setBonusMonth(addMonths(bonusMonth, -1))} style={{ padding: "6px 12px", borderRadius: 6, background: cs.surface, border: "1px solid " + cs.border, color: cs.text, cursor: "pointer", fontSize: 13 }}>← Bulan Lalu</button>
              <div style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>📅 {fmtMonth(bonusMonth)}</div>
              <button onClick={() => setBonusMonth(addMonths(bonusMonth, 1))} style={{ padding: "6px 12px", borderRadius: 6, background: cs.surface, border: "1px solid " + cs.border, color: cs.text, cursor: "pointer", fontSize: 13 }}>Bulan Depan →</button>
              <button onClick={() => setBonusMonth(todayYearMonth())} style={{ padding: "6px 12px", borderRadius: 6, background: cs.surface, border: "1px solid " + cs.border, color: cs.accent, cursor: "pointer", fontSize: 13 }}>Bulan Ini</button>
            </div>

            {/* Filter status */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["ALL","PENDING","ELIGIBLE","PAID","VOID"].map(s => (
                <button key={s} onClick={() => setBonusFilter(s)} style={{
                  padding: "5px 12px", borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid",
                  background: bonusFilter === s ? (STATUS_COLORS[s] || cs.accent) : cs.surface,
                  borderColor: bonusFilter === s ? (STATUS_COLORS[s] || cs.accent) : cs.border,
                  color: bonusFilter === s ? "#fff" : cs.muted,
                }}>
                  {s === "ALL" ? "Semua" : STATUS_LABELS[s]} {s !== "ALL" && `(${bonuses.filter(b => effBonusStatus(b) === s).length})`}
                </button>
              ))}
            </div>

            {/* Orders belum di-review */}
            {ordersNoBonus.length > 0 && (
              <div style={{ background: cs.surface, borderRadius: 10, padding: 14, border: "1px solid " + cs.yellow }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: cs.yellow, marginBottom: 10 }}>⚠️ {ordersNoBonus.length} Order Bulan {fmtMonth(bonusMonth)} Belum Di-review Bonus</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {ordersNoBonus.map(o => {
                    const team = [o.teknisi, o.teknisi2, o.teknisi3, o.helper, o.helper2, o.helper3].filter(Boolean);
                    const inv = periodInvMap[o.invoice_id];
                    const isComplain = o.service === "Complain";
                    const detected = detectBonusFromInvoice(inv?.materials_detail, o.service);
                    const invTotal = Number(inv?.total || 0);
                    const isOmsetBesar = (o.service !== "Install" && invTotal >= 1000000) ||
                                         (o.service === "Install" && invTotal >= 1500000);
                    const isInstallMulti = o.service === "Install" && Number(o.units) >= 2;
                    return (
                      <div key={o.id} style={{ background: cs.card, borderRadius: 8, padding: "10px 12px", border: "1px solid " + (isComplain ? cs.red + "66" : cs.border) }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                              {isComplain && <span style={{ fontSize: 10, fontWeight: 700, background: cs.red, color: "#fff", borderRadius: 4, padding: "1px 6px" }}>🔴 COMPLAIN</span>}
                              <span style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>[{o.id}] {o.customer}</span>
                            </div>
                            <div style={{ fontSize: 11, color: cs.muted }}>{fmtDate(o.date)} · {o.service} · {o.units} unit · {team.join(", ")}</div>
                            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                              {inv?.total > 0 && <span style={{ fontSize: 11, color: cs.accent }}>Invoice: {fmtRp(inv.total)}</span>}
                              {detected.freon && <span style={{ fontSize: 10, background: "#1e3a5f", color: "#93c5fd", borderRadius: 4, padding: "1px 6px" }}>🧊 Freon</span>}
                              {detected.kapasitor && <span style={{ fontSize: 10, background: "#1e3a5f", color: "#93c5fd", borderRadius: 4, padding: "1px 6px" }}>⚡ Kapasitor</span>}
                              {detected.thermis && <span style={{ fontSize: 10, background: "#1e3a5f", color: "#93c5fd", borderRadius: 4, padding: "1px 6px" }}>🌡️ Thermis</span>}
                              {isOmsetBesar && <span style={{ fontSize: 10, background: "#14532d", color: "#86efac", borderRadius: 4, padding: "1px 6px" }}>💰 Omset {o.service === "Install" ? "≥1,5jt" : "≥1jt"}</span>}
                              {isInstallMulti && <span style={{ fontSize: 10, background: "#422006", color: "#fcd34d", borderRadius: 4, padding: "1px 6px" }}>🔩 Install {o.units} unit</span>}
                            </div>
                          </div>
                          <button onClick={() => setBonusForm({ order: o, inv, team })} style={{ padding: "6px 14px", borderRadius: 7, background: isComplain ? "#6b7280" : cs.accent, border: "none", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                            + Input Bonus
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Void form modal */}
            {voidForm && (
              <div style={{ background: "#3f1515", border: "1px solid " + cs.red, borderRadius: 10, padding: 16 }}>
                <div style={{ fontWeight: 700, color: cs.red, marginBottom: 10 }}>🚫 Void Bonus</div>
                <input value={voidForm.reason} onChange={e => setVoidForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="Alasan void (wajib) — contoh: Customer complain freon bocor lagi"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid " + cs.red, background: cs.card, color: cs.text, fontSize: 13, boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={handleVoid} style={{ padding: "7px 16px", borderRadius: 7, background: cs.red, border: "none", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Void</button>
                  <button onClick={() => setVoidForm(null)} style={{ padding: "7px 16px", borderRadius: 7, background: cs.surface, border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 12 }}>Batal</button>
                </div>
              </div>
            )}

            {/* Input bonus form */}
            {bonusForm && <BonusInputForm
              orderRow={bonusForm.order}
              inv={bonusForm.inv}
              team={bonusForm.team}
              ordersData={ordersData}
              onSave={handleSaveBonus}
              onCancel={() => setBonusForm(null)}
            />}

            {/* Daftar bonus */}
            {loadingBonus ? (
              <div style={{ color: cs.muted, fontSize: 13, padding: 20, textAlign: "center" }}>Memuat data...</div>
            ) : filteredBonuses.length === 0 ? (
              <div style={{ background: cs.surface, borderRadius: 10, padding: 24, textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
                <div style={{ color: cs.muted, fontSize: 14 }}>Belum ada komisi di filter ini.</div>
              </div>
            ) : filteredBonuses.map(b => { const est = effBonusStatus(b); return (
              <div key={b.id} style={{ background: cs.card, borderRadius: 12, padding: 14, border: "1px solid " + (STATUS_COLORS[est] || cs.border), opacity: est === "VOID" ? 0.6 : 1 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ background: STATUS_COLORS[est], color: "#fff", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{STATUS_LABELS[est]}</span>
                      <span style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>{BONUS_LABELS[b.bonus_type] || b.bonus_type}</span>
                    </div>
                    <div style={{ fontSize: 12, color: cs.muted }}>
                      [{b.order_id || "-"}] · {fmtDate(b.order_date)} · {(b.team_members || []).join(", ")}
                    </div>
                    {b.profit != null && (
                      <div style={{ fontSize: 12, color: cs.muted }}>
                        Omset: {fmtRp(b.gross_revenue)} · Material: {fmtRp(b.material_cost)} · Profit: <strong style={{ color: cs.green }}>{fmtRp(b.profit)}</strong>
                      </div>
                    )}
                    {b.note && <div style={{ fontSize: 11, color: cs.muted, fontStyle: "italic", marginTop: 2 }}>{b.note}</div>}
                    {b.void_reason && <div style={{ fontSize: 11, color: cs.red, marginTop: 2 }}>Void: {b.void_reason}</div>}
                  </div>
                  <div style={{ textAlign: "right", minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: cs.muted }}>Total Tim</div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: cs.accent }}>{fmtRp(b.total_amount)}</div>
                    <div style={{ fontSize: 11, color: cs.muted }}>÷{b.member_count || 1} = {fmtRp(b.amount_per_person)}/org</div>
                  </div>
                </div>
                {/* Actions */}
                {(est === "PENDING" || est === "ELIGIBLE") && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10, borderTop: "1px solid " + cs.border, paddingTop: 10, alignItems: "center" }}>
                    {est === "ELIGIBLE" && (
                      <button onClick={() => handleMarkBonusPaid(b)} style={{ padding: "6px 14px", borderRadius: 7, background: cs.green, border: "none", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                        ✓ Tandai Dibayar
                      </button>
                    )}
                    {est === "PENDING" && <span style={{ fontSize: 11, color: cs.yellow, padding: "6px 0" }}>⏳ Warranty — siap cair {30 - daysSinceDate(b.order_date)} hari lagi</span>}
                    <button onClick={() => setVoidForm({ id: b.id, reason: "" })} style={{ padding: "6px 14px", borderRadius: 7, background: "transparent", border: "1px solid " + cs.red, color: cs.red, cursor: "pointer", fontSize: 12 }}>
                      🚫 Void
                    </button>
                  </div>
                )}
                {est === "PAID" && <div style={{ fontSize: 11, color: cs.muted, marginTop: 6 }}>Dibayar oleh {b.paid_by} · {b.paid_at ? new Date(b.paid_at).toLocaleString("id-ID") : "-"}</div>}
              </div>
            ); })}
          </div>
        );
      })()}
    </div>
  );
}

// ── Helpers: deteksi dari invoice + install kumulatif ──
// Detect bonus material spesifik: freon (kuras vacum + isi freon / tambah freon), kapasitor AC, thermis
function detectBonusFromInvoice(materialsDetail, orderService = "") {
  const result = { freon: false, kapasitor: false, thermis: false, freonNames: [], kapasitorNames: [], thermisNames: [] };
  try {
    const items = JSON.parse(materialsDetail || "[]");
    for (const item of items) {
      const nama = (item.nama || "").toLowerCase();
      // Freon: "Kuras Vacum + Isi Freon" atau "Kuras Vacum Freon" atau "Tambah Freon"
      if ((nama.includes("kuras vacum") && nama.includes("freon")) || nama.includes("tambah freon")) {
        result.freon = true;
        result.freonNames.push(item.nama);
      }
      // Kapasitor: any item dengan "kapasitor ac" (tidak perlu "pasang")
      if (nama.includes("kapasitor ac")) {
        result.kapasitor = true;
        result.kapasitorNames.push(item.nama);
      }
      // Thermis: sparepart thermis
      if (nama.includes("thermis")) {
        result.thermis = true;
        result.thermisNames.push(item.nama);
      }
    }
  } catch {}
  return result;
}

function getInstallCumulative(ordersData, date, teamMembers) {
  const sameDay = (ordersData || []).filter(o =>
    o.date === date && o.service === "Install" && ["COMPLETED","PAID"].includes(o.status)
  );
  const relevant = sameDay.filter(o => {
    const ot = [o.teknisi, o.teknisi2, o.teknisi3, o.helper, o.helper2, o.helper3].filter(Boolean);
    return teamMembers.some(m => ot.includes(m));
  });
  const totalUnits = relevant.reduce((s, o) => s + (Number(o.units) || 0), 0);
  const tier = totalUnits >= 4 ? "install_4" : totalUnits >= 3 ? "install_3" : totalUnits >= 2 ? "install_2" : null;
  return { totalUnits, tier, orderIds: relevant.map(o => o.id) };
}

// Form input bonus per order — smart version
function BonusInputForm({ orderRow, inv, team, ordersData, onSave, onCancel }) {
  const isComplain = orderRow.service === "Complain";
  const detected   = detectBonusFromInvoice(inv?.materials_detail, orderRow.service);
  const installInfo = orderRow.service === "Install"
    ? getInstallCumulative(ordersData, orderRow.date, team) : null;

  // Default bonus type: freon jika terdeteksi, kapasitor, thermis, install, lalu margin, lalu manual untuk complain
  const defaultType = (() => {
    if (isComplain) return "manual";
    if (detected.freon) return "freon";
    if (detected.kapasitor) return "kapasitor";
    if (detected.thermis) return "thermis";
    if (installInfo?.tier) return installInfo.tier;
    return "margin_1jt";
  })();

  const [bonusType, setBonusType]       = useState(defaultType);
  const [grossRevenue, setGrossRevenue] = useState(inv?.total ? String(inv.total) : "");
  const [materialCost, setMaterialCost] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [note, setNote]                 = useState(isComplain ? "Order Complain — cek ada pekerjaan berbayar" : "");
  const [selectedTeam, setSelectedTeam] = useState(team);

  const profit = grossRevenue && materialCost ? Number(grossRevenue) - Number(materialCost) : null;

  // Auto-suggest margin tier dari profit
  useEffect(() => {
    if (!bonusType.startsWith("margin") || profit === null) return;
    const suggested = profit >= 3000000 ? "margin_3jt" : profit >= 2000000 ? "margin_2jt" : profit >= 1000000 ? "margin_1jt" : "margin_1jt";
    if (suggested !== bonusType) setBonusType(suggested);
  }, [profit]);

  const getAutoAmount = () => {
    if (bonusType === "manual") return Number(customAmount) || 0;
    return BONUS_DEFAULTS[bonusType] || 0;
  };
  const totalAmount = getAutoAmount();
  const perPerson   = selectedTeam.length > 0 ? Math.round(totalAmount / selectedTeam.length) : 0;
  const fmt = n => Number(n || 0).toLocaleString("id-ID");

  return (
    <div style={{ background: "#0f2d4a", border: "1px solid " + (isComplain ? "#ef4444" : "#3b82f6"), borderRadius: 12, padding: 16 }}>
      {/* Header */}
      <div style={{ fontWeight: 800, fontSize: 14, color: isComplain ? "#fca5a5" : "#93c5fd", marginBottom: 4 }}>
        ➕ Input Bonus — [{orderRow.id}] {orderRow.customer}
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: isComplain ? 8 : 12 }}>
        {fmtDate(orderRow.date)} · {orderRow.service} · {orderRow.units} unit
      </div>

      {/* Peringatan Complain */}
      {isComplain && (
        <div style={{ background: "#3f1515", border: "1px solid #ef4444", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#fca5a5", marginBottom: 12 }}>
          🔴 <strong>Order Complain</strong> — defaultnya tidak ada bonus. Input hanya jika ada pekerjaan/part berbayar di dalamnya.
        </div>
      )}

      {/* Deteksi dari invoice */}
      {(detected.freon || detected.kapasitor || detected.thermis || installInfo?.tier) && (
        <div style={{ background: "#0c2d4a", border: "1px solid #1d4ed8", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#60a5fa", marginBottom: 6, fontWeight: 700 }}>✨ Terdeteksi dari Invoice</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {detected.freon && (
              <button onClick={() => setBonusType("freon")} style={{ padding: "3px 10px", borderRadius: 14, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1px solid #3b82f6", background: bonusType === "freon" ? "#3b82f6" : "transparent", color: bonusType === "freon" ? "#fff" : "#93c5fd" }}>
                🧊 Isi Freon · Rp {fmt(BONUS_DEFAULTS.freon)}/tim
              </button>
            )}
            {detected.kapasitor && (
              <button onClick={() => setBonusType("kapasitor")} style={{ padding: "3px 10px", borderRadius: 14, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1px solid #3b82f6", background: bonusType === "kapasitor" ? "#3b82f6" : "transparent", color: bonusType === "kapasitor" ? "#fff" : "#93c5fd" }}>
                ⚡ Kapasitor · Rp {fmt(BONUS_DEFAULTS.kapasitor)}/tim
              </button>
            )}
            {detected.thermis && (
              <button onClick={() => setBonusType("thermis")} style={{ padding: "3px 10px", borderRadius: 14, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1px solid #3b82f6", background: bonusType === "thermis" ? "#3b82f6" : "transparent", color: bonusType === "thermis" ? "#fff" : "#93c5fd" }}>
                🌡️ Thermis · Rp {fmt(BONUS_DEFAULTS.thermis)}/tim
              </button>
            )}
            {installInfo?.tier && (
              <button onClick={() => setBonusType(installInfo.tier)} style={{ padding: "3px 10px", borderRadius: 14, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1px solid #3b82f6", background: bonusType === installInfo.tier ? "#3b82f6" : "transparent", color: bonusType === installInfo.tier ? "#fff" : "#93c5fd" }}>
                🔩 Install {installInfo.totalUnits} unit/hari · Rp {fmt(BONUS_DEFAULTS[installInfo.tier])}/tim
              </button>
            )}
          </div>
          {detected.freonNames.length > 0 && <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>Freon: {detected.freonNames.join(", ")}</div>}
          {detected.kapasitorNames.length > 0 && <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>Kapasitor: {detected.kapasitorNames.join(", ")}</div>}
          {detected.thermisNames.length > 0 && <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>Thermis: {detected.thermisNames.join(", ")}</div>}
          {installInfo?.tier && <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>Kumulatif tim hari ini: {installInfo.orderIds.join(", ")}</div>}
        </div>
      )}

      {/* Tipe bonus — dropdown lengkap */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Tipe Bonus</div>
        <select value={bonusType} onChange={e => setBonusType(e.target.value)}
          style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid #334155", background: "#1e293b", color: "#e2e8f0", fontSize: 13 }}>
          {Object.entries(BONUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}{BONUS_DEFAULTS[k] ? ` — Rp ${BONUS_DEFAULTS[k].toLocaleString("id-ID")}/tim` : ""}</option>
          ))}
        </select>
      </div>

      {/* Input margin */}
      {bonusType.startsWith("margin") && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Omset / Invoice (Rp) <span style={{ color: "#3b82f6" }}>auto</span></div>
            <input type="number" value={grossRevenue} onChange={e => setGrossRevenue(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid " + (inv?.total ? "#3b82f6" : "#334155"), background: "#1e293b", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Biaya Material Aktual (Rp)</div>
            <input type="number" value={materialCost} onChange={e => setMaterialCost(e.target.value)}
              placeholder="yg AClean bayar ke supplier" style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #334155", background: "#1e293b", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
          </div>
          {profit !== null && (
            <div style={{ gridColumn: "1/-1", padding: "6px 10px", borderRadius: 6, background: profit >= 1000000 ? "#052e16" : "#3f1515", fontSize: 13, fontWeight: 700, color: profit >= 1000000 ? "#22c55e" : "#fca5a5" }}>
              Profit: Rp {fmt(profit)}
              {profit >= 3000000 ? " → Tier 3 ✅ Rp 200rb/tim" : profit >= 2000000 ? " → Tier 2 ✅ Rp 100rb/tim" : profit >= 1000000 ? " → Tier 1 ✅ Rp 50rb/tim" : " → Belum mencapai Rp 1jt"}
            </div>
          )}
        </div>
      )}

      {/* Input manual amount */}
      {bonusType === "manual" && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Nominal Bonus (Rp)</div>
          <input type="number" value={customAmount} onChange={e => setCustomAmount(e.target.value)}
            placeholder="Masukkan nominal" style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #334155", background: "#1e293b", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
        </div>
      )}

      {/* Tim checklist */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Tim yang Dapat Bonus</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {team.map(name => (
            <label key={name} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", background: "#1e293b", borderRadius: 6, padding: "5px 10px", border: "1px solid " + (selectedTeam.includes(name) ? "#3b82f6" : "#334155") }}>
              <input type="checkbox" checked={selectedTeam.includes(name)}
                onChange={e => setSelectedTeam(prev => e.target.checked ? [...prev, name] : prev.filter(n => n !== name))}
              />
              <span style={{ fontSize: 12, color: "#e2e8f0" }}>{name}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Catatan */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Catatan (opsional)</div>
        <input value={note} onChange={e => setNote(e.target.value)}
          style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #334155", background: "#1e293b", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
      </div>

      {/* Preview */}
      <div style={{ background: "#1e293b", borderRadius: 8, padding: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Preview</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{BONUS_LABELS[bonusType]}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Dibagi {selectedTeam.length} orang: <strong style={{ color: "#93c5fd" }}>Rp {fmt(perPerson)}/orang</strong></div>
            <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>Status: PENDING — cair setelah 30 hari</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#64748b" }}>Total Tim</div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#22c55e" }}>Rp {fmt(totalAmount)}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => totalAmount > 0 && selectedTeam.length > 0 && onSave(orderRow, bonusType, grossRevenue, materialCost, selectedTeam, totalAmount, note)}
          disabled={totalAmount === 0 || selectedTeam.length === 0}
          style={{ padding: "8px 18px", borderRadius: 7, background: (totalAmount === 0 || selectedTeam.length === 0) ? "#334155" : "#3b82f6", border: "none", color: "#fff", cursor: totalAmount > 0 ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 13 }}>
          💾 Simpan Bonus
        </button>
        <button onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 7, background: "transparent", border: "1px solid #334155", color: "#64748b", cursor: "pointer", fontSize: 13 }}>
          Batal
        </button>
      </div>
    </div>
  );
}

export { GajiTab };
export default memo(TeknisiAdminView);
