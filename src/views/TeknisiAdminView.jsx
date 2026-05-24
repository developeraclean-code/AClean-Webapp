import { memo, useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import {
  fetchWeeklyPayroll, fetchDaysWorkedFromOrders, fetchKasbonByPeriod,
  fetchOrderBonusesByPeriod, fetchOrdersWithoutBonus,
} from "../data/reads.js";
import {
  updateUserDailyRate, upsertWeeklyPayroll, updateWeeklyPayroll,
  markPayrollPaid, insertOrderBonus, updateOrderBonus, markBonusPaid, voidBonus, deleteOrderBonus,
} from "../data/writes.js";

// ── Payroll helpers ──
const BONUS_LABELS = {
  margin_1jt: "Margin >1jt", margin_2jt: "Margin >2jt", margin_3jt: "Margin >3jt",
  freon: "Isi Freon", kapasitor: "Kapasitor",
  install_2: "Pasang >2 Unit/hari", install_3: "Pasang >3 Unit/hari", install_4: "Pasang >4 Unit/hari",
  manual: "Bonus Manual",
};
const BONUS_DEFAULTS = {
  margin_1jt: 50000, margin_2jt: 100000, margin_3jt: 200000,
  freon: 25000, kapasitor: 35000,
  install_2: 100000, install_3: 200000, install_4: 300000,
  manual: 0,
};
const STATUS_COLORS = { PENDING: "#f59e0b", ELIGIBLE: "#3b82f6", PAID: "#22c55e", VOID: "#ef4444" };
const STATUS_LABELS = { PENDING: "Dalam Warranty", ELIGIBLE: "Siap Cair", PAID: "Sudah Dibayar", VOID: "Void" };

// Hitung Senin terdekat sebelum/sama dengan today
function getMondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function getSaturdayOf(mondayStr) {
  const d = new Date(mondayStr + "T00:00:00");
  d.setDate(d.getDate() + 5);
  return d.toISOString().slice(0, 10);
}
function addWeeks(mondayStr, n) {
  const d = new Date(mondayStr + "T00:00:00");
  d.setDate(d.getDate() + n * 7);
  return d.toISOString().slice(0, 10);
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
  const [editingRate, setEditingRate] = useState({}); // { userId: newRate }

  // ── Komisi state ──
  const [bonuses, setBonuses]           = useState([]);
  const [ordersNoBonus, setOrdersNoBonus] = useState([]);
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

  // ── Load bonuses ──
  const loadBonuses = useCallback(async () => {
    setLoadingBonus(true);
    const [bonRes, ordRes] = await Promise.all([
      fetchOrderBonusesByPeriod(supabase, addWeeks(periodStart, -8), getSaturdayOf(addWeeks(periodStart, 1))),
      fetchOrdersWithoutBonus(supabase, periodStart, periodEnd),
    ]);
    setBonuses(bonRes.data || []);
    // Filter orders yang belum punya bonus entry
    const existingOrderIds = new Set((bonRes.data || []).map(b => b.order_id));
    setOrdersNoBonus((ordRes.data || []).filter(o => !existingOrderIds.has(o.id)));
    setLoadingBonus(false);
  }, [supabase, periodStart, periodEnd]);

  useEffect(() => { if (subTab === "payroll") loadPayroll(); }, [subTab, loadPayroll]);
  useEffect(() => { if (subTab === "komisi") loadBonuses(); }, [subTab, loadBonuses]);

  // ── Generate payroll untuk semua aktif teknisi/helper ──
  const handleGenerate = async () => {
    setLoadingPayroll(true);
    const aktif = teknisiData.filter(t => t.active && ["Teknisi","Helper"].includes(t.role));
    for (const t of aktif) {
      // Hitung hari masuk dari orders
      const { data: oData } = await fetchDaysWorkedFromOrders(supabase, t.name, periodStart, periodEnd);
      const uniqueDays = new Set((oData || []).map(o => o.date));
      const daysWorked = uniqueDays.size;

      // Kasbon periode ini
      const { data: kData } = await fetchKasbonByPeriod(supabase, t.name, periodStart, periodEnd);
      const kasbonTotal = (kData || []).reduce((s, e) => s + Number(e.amount), 0);

      // Existing row untuk preserve checklist manual
      const existing = payrollRows.find(r => r.user_id === t.id);

      await upsertWeeklyPayroll(supabase, {
        user_id:        t.id,
        user_name:      t.name,
        role:           t.role,
        period_start:   periodStart,
        period_end:     periodEnd,
        days_worked:    existing?.days_override ? existing.days_worked : daysWorked,
        days_override:  existing?.days_override || false,
        daily_rate:     t.daily_rate || 0,
        late_days:      existing?.late_days || 0,
        full_week_bonus: existing?.full_week_bonus || false,
        kasbon_total:   kasbonTotal,
        manual_bonus:   existing?.manual_bonus || 0,
        manual_bonus_note: existing?.manual_bonus_note || null,
        is_paid:        existing?.is_paid || false,
        created_by:     currentUser?.name,
      });
    }
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

  // ── Tandai bayar ──
  const handlePaid = async (row) => {
    showConfirm?.({
      message: `Tandai payroll ${row.user_name} (${fmtDate(row.period_start)} – ${fmtDate(row.period_end)}) sebagai DIBAYAR?`,
      confirmText: "Ya, Tandai Dibayar",
      onConfirm: async () => {
        await markPayrollPaid(supabase, row.id, currentUser?.name);
        setPayrollRows(prev => prev.map(r => r.id === row.id ? { ...r, is_paid: true, paid_at: new Date().toISOString(), paid_by: currentUser?.name } : r));
        showNotif?.("✅ Payroll " + row.user_name + " ditandai dibayar");
      }
    });
  };

  // ── Kirim WA slip ──
  const handleSendWA = async (row) => {
    const t = teknisiData.find(x => x.id === row.user_id);
    if (!t?.phone) { showNotif?.("❌ Nomor HP " + row.user_name + " tidak ditemukan"); return; }

    // Ambil bonus PAID periode ini untuk orang ini
    const bonusMinggu = bonuses.filter(b =>
      b.status === "PAID" && (b.team_members || []).includes(row.user_name) &&
      b.order_date >= periodStart && b.order_date <= periodEnd
    );
    const totalBonus = bonusMinggu.reduce((s, b) => s + Number(b.amount_per_person || 0), 0);

    const late = row.late_days > 0 ? `\nTelat Masuk : ${row.late_days} hari × -Rp 10.000 = -Rp ${(row.late_days * 10000).toLocaleString("id-ID")}` : "";
    const kasbon = row.kasbon_total > 0 ? `\nKasbon : -${fmtRp(row.kasbon_total)}` : "";
    const fullWeek = row.full_week_bonus ? `\nBonus Full Week : +${fmtRp(row.role === "Helper" ? 75000 : 100000)}` : "";
    const manBonus = row.manual_bonus > 0 ? `\nBonus Manual : +${fmtRp(row.manual_bonus)}${row.manual_bonus_note ? " (" + row.manual_bonus_note + ")" : ""}` : "";
    const bonusLines = bonusMinggu.map(b => `[${b.order_id || "-"}] ${BONUS_LABELS[b.bonus_type] || b.bonus_type} : +${fmtRp(b.amount_per_person)}`).join("\n");

    const msg = `📋 *SLIP GAJI MINGGUAN*\n━━━━━━━━━━━━━━━━━━━━━\n👷 *${row.user_name}* | ${row.role}\nPeriode: ${fmtDate(row.period_start)} – ${fmtDate(row.period_end)}\n━━━━━━━━━━━━━━━━━━━━━\n*GAJI POKOK*\nHari Masuk : ${row.days_worked} hari × ${fmtRp(row.daily_rate)}\n             = ${fmtRp(row.days_worked * row.daily_rate)}${fullWeek}${late}${kasbon}${manBonus}\n━━━━━━━━━━━━━━━━━━━━━\n*KOMISI ORDER*\n${bonusLines || "Belum ada komisi dibayar minggu ini"}\nTotal Komisi : ${fmtRp(totalBonus)}\n━━━━━━━━━━━━━━━━━━━━━\n*TOTAL GAJI : ${fmtRp(row.gross_salary)}*\nStatus : ${row.is_paid ? "✅ SUDAH DIBAYAR" : "⏳ BELUM DIBAYAR"}\n━━━━━━━━━━━━━━━━━━━━━`;

    openWA?.(t.phone, msg);
    await markPayrollPaid.wa_sent_at || updateWeeklyPayroll(supabase, row.id, { wa_sent_at: new Date().toISOString() });
    showNotif?.("📤 WA slip dikirim ke " + row.user_name);
  };

  // ── Update daily_rate dari UI ──
  const handleSaveRate = async (t) => {
    const newRate = Number(editingRate[t.id] ?? t.daily_rate ?? 0);
    await updateUserDailyRate(supabase, t.id, newRate);
    setEditingRate(prev => { const p = { ...prev }; delete p[t.id]; return p; });
    showNotif?.("✅ Gaji harian " + t.name + " diperbarui: " + fmtRp(newRate));
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

  const filteredBonuses = bonusFilter === "ALL" ? bonuses : bonuses.filter(b => b.status === bonusFilter);

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
              <div style={{ fontWeight: 700, fontSize: 13, color: cs.muted, marginBottom: 10 }}>⚙️ Konfigurasi Gaji Harian</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: 10 }}>
                {aktif.map(t => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, background: cs.card, borderRadius: 8, padding: "8px 12px" }}>
                    <span style={{ fontSize: 11, color: cs.muted, width: 16, textAlign: "center" }}>{t.role === "Teknisi" ? "🔧" : "🤝"}</span>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: cs.text }}>{t.name}</span>
                    <input
                      type="number"
                      value={editingRate[t.id] ?? (t.daily_rate || 0)}
                      onChange={e => setEditingRate(prev => ({ ...prev, [t.id]: e.target.value }))}
                      style={{ width: 90, padding: "4px 6px", borderRadius: 6, border: "1px solid " + cs.border, background: cs.surface, color: cs.text, fontSize: 12, textAlign: "right" }}
                    />
                    {editingRate[t.id] !== undefined && (
                      <button onClick={() => handleSaveRate(t)} style={{ padding: "3px 8px", borderRadius: 5, background: cs.accent, border: "none", color: "#fff", cursor: "pointer", fontSize: 11 }}>✓</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

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
              const gross = Number(row.gross_salary || 0);
              const fullBonus = row.role === "Helper" ? 75000 : 100000;
              return (
                <div key={row.id} style={{ background: cs.card, border: "1px solid " + (row.is_paid ? cs.green : cs.border), borderRadius: 12, padding: 16, position: "relative" }}>
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
                        <input type="number" min={0} max={6} value={row.days_worked}
                          onChange={e => handleUpdateField(row, "days_worked", Number(e.target.value))}
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
                          <button key={n} onClick={() => handleUpdateField(row, "late_days", n)}
                            style={{ padding: "3px 8px", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid",
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
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                        <input type="checkbox" checked={row.full_week_bonus}
                          onChange={e => handleUpdateField(row, "full_week_bonus", e.target.checked)}
                          style={{ width: 16, height: 16 }}
                        />
                        <span style={{ fontWeight: 700, fontSize: 13, color: row.full_week_bonus ? cs.green : cs.muted }}>
                          {row.full_week_bonus ? "✅ +" + fmtRp(fullBonus) : "Belum dapat"}
                        </span>
                      </label>
                    </div>

                    {/* Kasbon */}
                    <div style={{ background: cs.surface, borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Kasbon (auto dari Biaya)</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: row.kasbon_total > 0 ? cs.red : cs.muted }}>
                        {row.kasbon_total > 0 ? "-" + fmtRp(row.kasbon_total) : "Rp 0"}
                      </div>
                    </div>
                  </div>

                  {/* Bonus manual */}
                  <div style={{ background: cs.surface, borderRadius: 8, padding: 10, marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: cs.muted, marginBottom: 6 }}>Bonus Manual (Lembur / Lainnya)</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input type="number" placeholder="Nominal" value={row.manual_bonus || ""}
                        onChange={e => handleUpdateField(row, "manual_bonus", Number(e.target.value))}
                        style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid " + cs.border, background: cs.card, color: cs.text, fontSize: 12 }}
                      />
                      <input type="text" placeholder="Keterangan (opsional)" value={row.manual_bonus_note || ""}
                        onChange={e => handleUpdateField(row, "manual_bonus_note", e.target.value)}
                        style={{ flex: 2, padding: "5px 8px", borderRadius: 6, border: "1px solid " + cs.border, background: cs.card, color: cs.text, fontSize: 12 }}
                      />
                    </div>
                  </div>

                  {/* Total + Actions */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, paddingTop: 12, borderTop: "1px solid " + cs.border }}>
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted }}>TOTAL GAJI</div>
                      <div style={{ fontWeight: 800, fontSize: 20, color: cs.accent }}>{fmtRp(gross)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {!row.is_paid && (
                        <button onClick={() => handlePaid(row)} style={{ padding: "7px 14px", borderRadius: 8, background: cs.green, border: "none", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                          ✓ Tandai Dibayar
                        </button>
                      )}
                      <button onClick={() => handleSendWA(row)} style={{ padding: "7px 14px", borderRadius: 8, background: "#25d366", border: "none", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                        📤 Kirim WA
                      </button>
                    </div>
                  </div>
                  {row.is_paid && <div style={{ fontSize: 11, color: cs.muted, marginTop: 6 }}>Dibayar oleh {row.paid_by} · {row.paid_at ? new Date(row.paid_at).toLocaleString("id-ID") : "-"}</div>}
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
              <button onClick={() => setPeriodStart(addWeeks(periodStart, -1))} style={{ padding: "6px 12px", borderRadius: 6, background: cs.surface, border: "1px solid " + cs.border, color: cs.text, cursor: "pointer", fontSize: 13 }}>← Minggu Lalu</button>
              <div style={{ fontWeight: 700, color: cs.text, fontSize: 14 }}>📅 {fmtDate(periodStart)} — {fmtDate(periodEnd)}</div>
              <button onClick={() => setPeriodStart(addWeeks(periodStart, 1))} style={{ padding: "6px 12px", borderRadius: 6, background: cs.surface, border: "1px solid " + cs.border, color: cs.text, cursor: "pointer", fontSize: 13 }}>Minggu Depan →</button>
              <button onClick={() => setPeriodStart(getMondayOf(TODAY))} style={{ padding: "6px 12px", borderRadius: 6, background: cs.surface, border: "1px solid " + cs.border, color: cs.accent, cursor: "pointer", fontSize: 13 }}>Minggu Ini</button>
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
                  {s === "ALL" ? "Semua" : STATUS_LABELS[s]} {s !== "ALL" && `(${bonuses.filter(b => b.status === s).length})`}
                </button>
              ))}
            </div>

            {/* Orders belum di-review */}
            {ordersNoBonus.length > 0 && (
              <div style={{ background: cs.surface, borderRadius: 10, padding: 14, border: "1px solid " + cs.yellow }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: cs.yellow, marginBottom: 10 }}>⚠️ {ordersNoBonus.length} Order Minggu Ini Belum Di-review Bonus</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {ordersNoBonus.map(o => {
                    const team = [o.teknisi, o.teknisi2, o.teknisi3, o.helper, o.helper2, o.helper3].filter(Boolean);
                    const inv = invoicesData?.find(i => i.id === o.invoice_id);
                    return (
                      <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 10, background: cs.card, borderRadius: 8, padding: "8px 12px", flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>[{o.id}] {o.customer}</div>
                          <div style={{ fontSize: 11, color: cs.muted }}>{fmtDate(o.date)} · {o.service} · {o.units} unit · {team.join(", ")}</div>
                          {inv && <div style={{ fontSize: 11, color: cs.accent }}>Invoice: {fmtRp(inv.total)}</div>}
                        </div>
                        <button onClick={() => setBonusForm({ order: o, inv, team })} style={{ padding: "6px 14px", borderRadius: 7, background: cs.accent, border: "none", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                          + Input Bonus
                        </button>
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
            ) : filteredBonuses.map(b => (
              <div key={b.id} style={{ background: cs.card, borderRadius: 12, padding: 14, border: "1px solid " + (STATUS_COLORS[b.status] || cs.border), opacity: b.status === "VOID" ? 0.6 : 1 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ background: STATUS_COLORS[b.status], color: "#fff", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{STATUS_LABELS[b.status]}</span>
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
                {(b.status === "PENDING" || b.status === "ELIGIBLE") && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10, borderTop: "1px solid " + cs.border, paddingTop: 10 }}>
                    {b.status === "ELIGIBLE" && (
                      <button onClick={() => handleMarkBonusPaid(b)} style={{ padding: "6px 14px", borderRadius: 7, background: cs.green, border: "none", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                        ✓ Tandai Dibayar
                      </button>
                    )}
                    {b.status === "PENDING" && <span style={{ fontSize: 11, color: cs.yellow, padding: "6px 0" }}>⏳ Dalam masa warranty</span>}
                    <button onClick={() => setVoidForm({ id: b.id, reason: "" })} style={{ padding: "6px 14px", borderRadius: 7, background: "transparent", border: "1px solid " + cs.red, color: cs.red, cursor: "pointer", fontSize: 12 }}>
                      🚫 Void
                    </button>
                  </div>
                )}
                {b.status === "PAID" && <div style={{ fontSize: 11, color: cs.muted, marginTop: 6 }}>Dibayar oleh {b.paid_by} · {b.paid_at ? new Date(b.paid_at).toLocaleString("id-ID") : "-"}</div>}
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// Form input bonus per order
function BonusInputForm({ orderRow, inv, team, onSave, onCancel }) {
  const [bonusType, setBonusType]     = useState("margin_1jt");
  const [grossRevenue, setGrossRevenue] = useState(inv?.total || "");
  const [materialCost, setMaterialCost] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [note, setNote]               = useState("");
  const [selectedTeam, setSelectedTeam] = useState(team);

  const profit = grossRevenue && materialCost ? Number(grossRevenue) - Number(materialCost) : null;

  const getAutoAmount = () => {
    if (bonusType === "manual") return Number(customAmount) || 0;
    return BONUS_DEFAULTS[bonusType] || 0;
  };
  const totalAmount = getAutoAmount();
  const perPerson   = selectedTeam.length > 0 ? totalAmount / selectedTeam.length : 0;

  const fmt = n => n ? Number(n).toLocaleString("id-ID") : "0";

  return (
    <div style={{ background: "#0f2d4a", border: "1px solid #3b82f6", borderRadius: 12, padding: 16 }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#93c5fd", marginBottom: 12 }}>
        ➕ Input Bonus — [{orderRow.id}] {orderRow.customer}
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
        {orderRow.date} · {orderRow.service} · {orderRow.units} unit
      </div>

      {/* Tipe bonus */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Tipe Bonus</div>
        <select value={bonusType} onChange={e => setBonusType(e.target.value)}
          style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid #334155", background: "#1e293b", color: "#e2e8f0", fontSize: 13 }}>
          {Object.entries(BONUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v} {BONUS_DEFAULTS[k] ? `— Rp ${BONUS_DEFAULTS[k].toLocaleString("id-ID")}/tim` : ""}</option>
          ))}
        </select>
      </div>

      {/* Revenue & material (hanya untuk margin) */}
      {bonusType.startsWith("margin") && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Omset (Rp)</div>
            <input type="number" value={grossRevenue} onChange={e => setGrossRevenue(e.target.value)}
              placeholder="dari invoice" style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #334155", background: "#1e293b", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Biaya Material (Rp)</div>
            <input type="number" value={materialCost} onChange={e => setMaterialCost(e.target.value)}
              placeholder="input manual" style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #334155", background: "#1e293b", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
          </div>
          {profit != null && (
            <div style={{ gridColumn: "1/-1", fontSize: 13, fontWeight: 700, color: profit > 0 ? "#22c55e" : "#ef4444" }}>
              Profit: Rp {fmt(profit)} {profit >= 3000000 ? "→ Tier 3 (200rb)" : profit >= 2000000 ? "→ Tier 2 (100rb)" : profit >= 1000000 ? "→ Tier 1 (50rb)" : "→ Belum mencapai threshold"}
            </div>
          )}
        </div>
      )}

      {/* Custom amount untuk manual */}
      {bonusType === "manual" && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Nominal Bonus (Rp)</div>
          <input type="number" value={customAmount} onChange={e => setCustomAmount(e.target.value)}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #334155", background: "#1e293b", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
        </div>
      )}

      {/* Tim */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Tim (checklist siapa yang dapat)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {team.map(name => (
            <label key={name} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", background: "#1e293b", borderRadius: 6, padding: "4px 10px", border: "1px solid " + (selectedTeam.includes(name) ? "#3b82f6" : "#334155") }}>
              <input type="checkbox" checked={selectedTeam.includes(name)}
                onChange={e => setSelectedTeam(prev => e.target.checked ? [...prev, name] : prev.filter(n => n !== name))}
              />
              <span style={{ fontSize: 12, color: "#e2e8f0" }}>{name}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Note */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Catatan (opsional)</div>
        <input value={note} onChange={e => setNote(e.target.value)}
          style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #334155", background: "#1e293b", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
      </div>

      {/* Preview */}
      <div style={{ background: "#1e293b", borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 13 }}>
        <div style={{ color: "#64748b", marginBottom: 4 }}>Preview Bonus</div>
        <div style={{ color: "#e2e8f0" }}>Total Tim: <strong style={{ color: "#22c55e" }}>Rp {fmt(totalAmount)}</strong></div>
        <div style={{ color: "#e2e8f0" }}>Per Orang ({selectedTeam.length} org): <strong style={{ color: "#93c5fd" }}>Rp {fmt(perPerson)}</strong></div>
        <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>Status: PENDING (warranty 30 hari)</div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onSave(orderRow, bonusType, grossRevenue, materialCost, selectedTeam, totalAmount, note)}
          style={{ padding: "8px 18px", borderRadius: 7, background: "#3b82f6", border: "none", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
          Simpan Bonus
        </button>
        <button onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 7, background: "transparent", border: "1px solid #334155", color: "#64748b", cursor: "pointer", fontSize: 13 }}>
          Batal
        </button>
      </div>
    </div>
  );
}

export default memo(TeknisiAdminView);
