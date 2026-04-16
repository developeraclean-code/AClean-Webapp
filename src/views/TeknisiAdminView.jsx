import { cs } from "../theme/cs.js";

export default function TeknisiAdminView({ teknisiData, setTeknisiData, ordersData, laporanReports, currentUser, supabase, setEditTeknisi, setNewTeknisiForm, setModalTeknisi, showConfirm, showNotif, addAgentLog, openWA, TODAY }) {
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
    o.date < TODAY
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

return (
  <div style={{ display: "grid", gap: 16 }}>
    {/* GAP-7: Banner stuck jobs */}
    {(() => {
      const stuckList = ordersData.filter(o =>
        ["DISPATCHED", "ON_SITE"].includes(o.status) && o.date < TODAY
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
                <button onClick={async () => {
                  if (!await showConfirm({
                    icon: "👷", title: "Hapus dari Tim?", danger: true,
                    message: "Hapus " + t.name + " dari tim? Data order tidak terpengaruh.",

                    confirmText: "Hapus"
                  })) return;
                  setTeknisiData(prev => prev.filter(x => x.id !== t.id));
                  if (!String(t.id).startsWith("Tech")) {
                    await supabase.from("user_profiles").delete().eq("id", t.id);
                  }
                  addAgentLog("TEKNISI_DELETED", t.name + " dihapus dari tim", "WARNING");
                  showNotif("🗑️ " + t.name + " dihapus");
                }} style={{ background: cs.red + "18", border: "1px solid " + cs.red + "33", color: cs.red, padding: "6px 8px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>🗑️</button>
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
  </div>
);
}
