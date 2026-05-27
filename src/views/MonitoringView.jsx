import { memo, useEffect, useState, useMemo } from "react";
import { cs } from "../theme/cs.js";
import {
  fetchCronRuns,
  fetchAiUsage,
  fetchAgentLogsFiltered,
  fetchWaDeliverySummary,
} from "../data/reads.js";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const fmtUSD = (n) => "$" + (Number(n) || 0).toFixed(4);
const fmtIDR = (n) => "Rp" + (Number(n) || 0).toLocaleString("id-ID");
const fmtDuration = (ms) => {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return ms + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  return Math.floor(ms / 60000) + "m " + Math.floor((ms % 60000) / 1000) + "s";
};
const SEVERITY_COLOR = {
  debug: { bg: "#94a3b8", label: "DEBUG" },
  info: { bg: "#3b82f6", label: "INFO" },
  warn: { bg: "#f59e0b", label: "WARN" },
  error: { bg: "#ef4444", label: "ERROR" },
  critical: { bg: "#dc2626", label: "CRITICAL" },
};
const CATEGORIES = ["wa","payment","inventory","ai","auth","cron","portal","security","customer","order","invoice"];

// ─────────────────────────────────────────────
// Tab: Overview (existing health + cron + AI summary)
// ─────────────────────────────────────────────
function TabOverview({ data, onRefresh }) {
  const metrics = data?.metrics || {};
  const errorRate = metrics.errorRate || 0;
  const cron = metrics.cron || {};
  const ai = metrics.ai || {};

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{
        background: data?.health === "healthy" ? cs.green + "18" : data?.health === "degraded" ? cs.yellow + "18" : cs.red + "18",
        border: `1px solid ${data?.health === "healthy" ? cs.green : data?.health === "degraded" ? cs.yellow : cs.red}33`,
        borderRadius: 14, padding: 20, display: "grid", gap: 12
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>
              {data?.health === "healthy" ? "✅ Healthy" : data?.health === "degraded" ? "⚠️ Degraded" : "🔴 Unhealthy"}
            </div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>Last updated: {data?.timestamp ? new Date(data.timestamp).toLocaleTimeString("id-ID") : "—"}</div>
          </div>
          <button onClick={onRefresh} style={{ padding: "8px 14px", borderRadius: 8, background: cs.accent + "22", border: `1px solid ${cs.accent}33`, color: cs.accent, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
            🔄 Refresh
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
          <Card label="Errors (24h)"   value={metrics.totalErrors || 0}   color={cs.red} />
          <Card label="Warnings (24h)" value={metrics.totalWarnings || 0} color={cs.yellow} />
          <Card label="Error Rate"     value={(errorRate * 100).toFixed(1) + "%"} color={errorRate > 0.1 ? cs.red : errorRate > 0.05 ? cs.yellow : cs.green} />
          <Card label="Logs Checked"   value={metrics.totalLogsChecked || 0} color={cs.accent} />
        </div>
      </div>

      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 16 }}>
        <div style={{ fontWeight: 700, color: cs.text, marginBottom: 12, fontSize: 14 }}>⏰ Cron Jobs (24h)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12 }}>
          <Card label="Total"   value={cron.total   || 0} color={cs.accent} />
          <Card label="Success" value={cron.success || 0} color={cs.green} />
          <Card label="Failed"  value={cron.failed  || 0} color={cs.red} />
          <Card label="Skipped" value={cron.skipped || 0} color={cs.muted} />
          <Card label="Running" value={cron.running || 0} color={cs.yellow} />
        </div>
      </div>

      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 16 }}>
        <div style={{ fontWeight: 700, color: cs.text, marginBottom: 12, fontSize: 14 }}>🤖 AI Usage (24h)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12 }}>
          <Card label="Total Calls" value={ai.totalCalls || 0} color={cs.accent} />
          <Card label="Cost (USD)"  value={fmtUSD(ai.totalCostUsd)} color={cs.green} />
          <Card label="Errors"      value={ai.errorCount || 0} color={cs.red} />
        </div>
        {ai.byProvider && Object.keys(ai.byProvider).length > 0 && (
          <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
            {Object.entries(ai.byProvider).map(([prov, stats]) => (
              <div key={prov} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: cs.surface, borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: cs.text, fontWeight: 700 }}>{prov}</span>
                <span style={{ color: cs.muted }}>{stats.calls} calls · {fmtUSD(stats.cost)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 16 }}>
        <div style={{ fontWeight: 700, color: cs.text, marginBottom: 12, fontSize: 14 }}>📋 Recent Errors & Warnings</div>
        {(!metrics.recentErrors || metrics.recentErrors.length === 0) ? (
          <div style={{ color: cs.muted, fontSize: 12, textAlign: "center", padding: 20 }}>✅ No errors or warnings found</div>
        ) : (
          <div style={{ display: "grid", gap: 8, maxHeight: 400, overflowY: "auto" }}>
            {metrics.recentErrors.map((err, idx) => (
              <ErrorRow key={idx} err={err} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Tab: Cron Jobs detail
// ─────────────────────────────────────────────
function TabCron({ supabase }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [taskFilter, setTaskFilter] = useState("");

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await fetchCronRuns(supabase, { since, limit: 200 });
    if (!error && data) setRuns(data);
    setLoading(false);
  };

  useEffect(() => { if (supabase) load(); }, [supabase]);

  const filtered = useMemo(() => {
    if (!taskFilter) return runs;
    return runs.filter(r => r.task_name === taskFilter);
  }, [runs, taskFilter]);

  const taskStats = useMemo(() => {
    const stats = {};
    for (const r of runs) {
      if (!stats[r.task_name]) stats[r.task_name] = { total: 0, success: 0, failed: 0, skipped: 0, avgDuration: 0, totalDuration: 0, durCount: 0 };
      const s = stats[r.task_name];
      s.total++;
      if (r.status === "SUCCESS") s.success++;
      else if (r.status === "FAILED") s.failed++;
      else if (r.status === "SKIPPED") s.skipped++;
      if (r.duration_ms != null) { s.totalDuration += r.duration_ms; s.durCount++; }
    }
    Object.keys(stats).forEach(t => { if (stats[t].durCount > 0) stats[t].avgDuration = Math.round(stats[t].totalDuration / stats[t].durCount); });
    return stats;
  }, [runs]);

  const tasks = Object.keys(taskStats).sort();

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>⏰ Cron Runs (7 hari)</div>
        <button onClick={load} disabled={loading} style={{ padding: "6px 12px", borderRadius: 8, background: cs.accent + "22", border: `1px solid ${cs.accent}33`, color: cs.accent, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
          {loading ? "⏳" : "🔄 Refresh"}
        </button>
      </div>

      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 8, fontWeight: 700 }}>Per Task Summary</div>
        <div style={{ display: "grid", gap: 6, maxHeight: 260, overflowY: "auto" }}>
          {tasks.length === 0 ? (
            <div style={{ color: cs.muted, fontSize: 12, textAlign: "center", padding: 12 }}>Belum ada data cron run. Tunggu cron jalan minimal 1 kali.</div>
          ) : tasks.map(t => {
            const s = taskStats[t];
            const failed = s.failed > 0;
            return (
              <div key={t}
                onClick={() => setTaskFilter(taskFilter === t ? "" : t)}
                style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) repeat(4,80px) 100px", alignItems: "center", padding: "8px 12px", background: taskFilter === t ? cs.accent + "12" : cs.surface, borderRadius: 8, fontSize: 12, cursor: "pointer", border: taskFilter === t ? `1px solid ${cs.accent}` : "1px solid transparent" }}>
                <span style={{ color: cs.text, fontWeight: 700 }}>{t}</span>
                <span style={{ color: cs.muted, textAlign: "center" }}>{s.total} runs</span>
                <span style={{ color: cs.green, textAlign: "center" }}>✅ {s.success}</span>
                <span style={{ color: failed ? cs.red : cs.muted, textAlign: "center", fontWeight: failed ? 800 : 400 }}>❌ {s.failed}</span>
                <span style={{ color: cs.muted, textAlign: "center" }}>⏭ {s.skipped}</span>
                <span style={{ color: cs.muted, textAlign: "right" }}>avg {fmtDuration(s.avgDuration)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 8, fontWeight: 700 }}>
          Recent Runs {taskFilter && `· filter: ${taskFilter}`} {taskFilter && <button onClick={() => setTaskFilter("")} style={{ background: "transparent", border: "none", color: cs.accent, cursor: "pointer", textDecoration: "underline" }}>clear</button>}
        </div>
        <div style={{ display: "grid", gap: 6, maxHeight: 400, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ color: cs.muted, fontSize: 12, textAlign: "center", padding: 12 }}>Tidak ada run untuk filter ini.</div>
          ) : filtered.map(r => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) 80px 80px 80px 1fr", alignItems: "center", padding: "8px 12px", background: cs.surface, borderRadius: 8, fontSize: 11, gap: 8 }}>
              <span style={{ color: cs.text, fontWeight: 700 }}>{r.task_name}</span>
              <Badge color={r.status === "SUCCESS" ? cs.green : r.status === "FAILED" ? cs.red : r.status === "SKIPPED" ? cs.muted : r.status === "RUNNING" ? cs.yellow : cs.muted}>{r.status}</Badge>
              <span style={{ color: cs.muted }}>{fmtDuration(r.duration_ms)}</span>
              <span style={{ color: cs.muted }}>{r.items_processed || 0} items</span>
              <div style={{ color: cs.muted }}>
                <div>{new Date(r.started_at).toLocaleString("id-ID")}</div>
                {r.error_message && <div style={{ color: cs.red, marginTop: 2, wordBreak: "break-word" }}>{r.error_message}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Tab: AI Cost
// ─────────────────────────────────────────────
function TabAiCost({ supabase }) {
  const [usage, setUsage] = useState([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(7);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await fetchAiUsage(supabase, { since, limit: 500 });
    if (!error && data) setUsage(data);
    setLoading(false);
  };

  useEffect(() => { if (supabase) load(); }, [supabase, days]);

  const stats = useMemo(() => {
    let totalCost = 0, totalCalls = usage.length, totalInput = 0, totalOutput = 0, errors = 0;
    const byProvider = {};
    const byFeature = {};
    const byDay = {};
    for (const u of usage) {
      totalCost += Number(u.cost_usd) || 0;
      totalInput += Number(u.input_tokens) || 0;
      totalOutput += Number(u.output_tokens) || 0;
      if (u.error) errors++;
      const p = u.provider || "unknown";
      if (!byProvider[p]) byProvider[p] = { calls: 0, cost: 0, input: 0, output: 0 };
      byProvider[p].calls++;
      byProvider[p].cost += Number(u.cost_usd) || 0;
      byProvider[p].input += Number(u.input_tokens) || 0;
      byProvider[p].output += Number(u.output_tokens) || 0;
      const f = u.feature || "unknown";
      if (!byFeature[f]) byFeature[f] = { calls: 0, cost: 0 };
      byFeature[f].calls++;
      byFeature[f].cost += Number(u.cost_usd) || 0;
      const day = (u.created_at || "").slice(0, 10);
      if (!byDay[day]) byDay[day] = { calls: 0, cost: 0 };
      byDay[day].calls++;
      byDay[day].cost += Number(u.cost_usd) || 0;
    }
    return { totalCost, totalCalls, totalInput, totalOutput, errors, byProvider, byFeature, byDay };
  }, [usage]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>🤖 AI Cost Tracking</div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ padding: "6px 10px", borderRadius: 8, background: cs.surface, border: `1px solid ${cs.border}`, color: cs.text, fontSize: 12 }}>
          <option value={1}>1 hari</option>
          <option value={7}>7 hari</option>
          <option value={30}>30 hari</option>
          <option value={90}>90 hari</option>
        </select>
        <button onClick={load} disabled={loading} style={{ padding: "6px 12px", borderRadius: 8, background: cs.accent + "22", border: `1px solid ${cs.accent}33`, color: cs.accent, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
          {loading ? "⏳" : "🔄 Refresh"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
        <Card label="Total Cost"   value={fmtUSD(stats.totalCost)} color={cs.green} />
        <Card label="Total Calls"  value={stats.totalCalls} color={cs.accent} />
        <Card label="Input Tok."   value={stats.totalInput.toLocaleString()} color={cs.muted} />
        <Card label="Output Tok."  value={stats.totalOutput.toLocaleString()} color={cs.muted} />
        <Card label="Errors"       value={stats.errors} color={stats.errors > 0 ? cs.red : cs.green} />
      </div>

      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 8, fontWeight: 700 }}>Per Provider</div>
        {Object.keys(stats.byProvider).length === 0 ? <Empty msg="Belum ada AI usage tercatat." /> : (
          <div style={{ display: "grid", gap: 6 }}>
            {Object.entries(stats.byProvider).sort((a, b) => b[1].cost - a[1].cost).map(([p, s]) => (
              <div key={p} style={{ display: "grid", gridTemplateColumns: "minmax(100px,1fr) 80px 100px 1fr", padding: "8px 12px", background: cs.surface, borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: cs.text, fontWeight: 700 }}>{p}</span>
                <span style={{ color: cs.muted }}>{s.calls} calls</span>
                <span style={{ color: cs.green, fontWeight: 700 }}>{fmtUSD(s.cost)}</span>
                <span style={{ color: cs.muted, textAlign: "right" }}>{s.input.toLocaleString()} in · {s.output.toLocaleString()} out</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 8, fontWeight: 700 }}>Per Feature</div>
        {Object.keys(stats.byFeature).length === 0 ? <Empty msg="Belum ada data feature." /> : (
          <div style={{ display: "grid", gap: 6 }}>
            {Object.entries(stats.byFeature).sort((a, b) => b[1].cost - a[1].cost).map(([f, s]) => (
              <div key={f} style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) 80px 100px", padding: "8px 12px", background: cs.surface, borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: cs.text, fontWeight: 700 }}>{f}</span>
                <span style={{ color: cs.muted }}>{s.calls} calls</span>
                <span style={{ color: cs.green, fontWeight: 700 }}>{fmtUSD(s.cost)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 8, fontWeight: 700 }}>Per Hari</div>
        {Object.keys(stats.byDay).length === 0 ? <Empty msg="—" /> : (
          <div style={{ display: "grid", gap: 4, maxHeight: 200, overflowY: "auto" }}>
            {Object.entries(stats.byDay).sort((a, b) => b[0].localeCompare(a[0])).map(([d, s]) => (
              <div key={d} style={{ display: "grid", gridTemplateColumns: "120px 60px 80px 1fr", padding: "6px 12px", fontSize: 11 }}>
                <span style={{ color: cs.text }}>{d}</span>
                <span style={{ color: cs.muted }}>{s.calls}</span>
                <span style={{ color: cs.green, fontWeight: 700 }}>{fmtUSD(s.cost)}</span>
                <div style={{ background: cs.surface, height: 8, borderRadius: 4, overflow: "hidden", alignSelf: "center" }}>
                  <div style={{ background: cs.accent, height: "100%", width: stats.totalCost > 0 ? (s.cost / stats.totalCost * 100) + "%" : "0%" }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Tab: Audit Log (filterable)
// ─────────────────────────────────────────────
function TabAudit({ supabase }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [days, setDays] = useState(1);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await fetchAgentLogsFiltered(supabase, { severity: severity || undefined, category: category || undefined, since, limit: 200 });
    if (!error && data) setLogs(data);
    setLoading(false);
  };

  useEffect(() => { if (supabase) load(); }, [supabase, severity, category, days]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>📜 Audit Log</div>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={selectStyle()}>
          <option value="">Semua severity</option>
          {["debug","info","warn","error","critical"].map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle()}>
          <option value="">Semua kategori</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={selectStyle()}>
          <option value={1}>1 hari</option>
          <option value={3}>3 hari</option>
          <option value={7}>7 hari</option>
          <option value={30}>30 hari</option>
        </select>
        <button onClick={load} disabled={loading} style={{ padding: "6px 12px", borderRadius: 8, background: cs.accent + "22", border: `1px solid ${cs.accent}33`, color: cs.accent, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
          {loading ? "⏳" : "🔄"}
        </button>
      </div>

      <div style={{ display: "grid", gap: 6, maxHeight: 600, overflowY: "auto" }}>
        {logs.length === 0 ? (
          <Empty msg="Tidak ada log untuk filter ini." />
        ) : logs.map(l => {
          const sev = l.severity || (l.status === "ERROR" ? "error" : l.status === "WARNING" ? "warn" : "info");
          const sevConfig = SEVERITY_COLOR[sev] || SEVERITY_COLOR.info;
          return (
            <div key={l.id} style={{ display: "grid", gridTemplateColumns: "70px 70px 200px 1fr 160px", alignItems: "start", gap: 8, padding: "8px 12px", background: cs.surface, borderRadius: 8, fontSize: 11 }}>
              <Badge color={sevConfig.bg}>{sevConfig.label}</Badge>
              <span style={{ color: cs.muted, fontSize: 10 }}>{l.category || "—"}</span>
              <span style={{ color: cs.text, fontWeight: 700 }}>{l.action}</span>
              <span style={{ color: cs.muted, wordBreak: "break-word" }}>{l.detail}</span>
              <span style={{ color: cs.muted, fontSize: 10, textAlign: "right" }}>{new Date(l.created_at).toLocaleString("id-ID")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Tab: WA Delivery
// ─────────────────────────────────────────────
function TabWa({ supabase }) {
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await fetchWaDeliverySummary(supabase);
    if (!error && data) setSummary(data);
    setLoading(false);
  };

  useEffect(() => { if (supabase) load(); }, [supabase]);

  const totals = useMemo(() => summary.reduce((acc, row) => ({
    sent: acc.sent + (row.total_sent || 0),
    delivered: acc.delivered + (row.delivered || 0),
    failed: acc.failed + (row.failed || 0),
    pending: acc.pending + (row.pending || 0),
    retries: acc.retries + (row.total_retries || 0),
  }), { sent: 0, delivered: 0, failed: 0, pending: 0, retries: 0 }), [summary]);

  const deliveryRate = totals.sent > 0 ? (totals.delivered / totals.sent * 100).toFixed(1) : "—";
  const failureRate  = totals.sent > 0 ? (totals.failed    / totals.sent * 100).toFixed(1) : "—";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>📱 WhatsApp Delivery (30 hari)</div>
        <button onClick={load} disabled={loading} style={{ padding: "6px 12px", borderRadius: 8, background: cs.accent + "22", border: `1px solid ${cs.accent}33`, color: cs.accent, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
          {loading ? "⏳" : "🔄 Refresh"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
        <Card label="Total Sent"     value={totals.sent}      color={cs.accent} />
        <Card label="Delivered"      value={totals.delivered} color={cs.green} />
        <Card label="Failed"         value={totals.failed}    color={cs.red} />
        <Card label="Pending"        value={totals.pending}   color={cs.yellow} />
        <Card label="Delivery Rate"  value={deliveryRate + (deliveryRate !== "—" ? "%" : "")} color={cs.green} />
        <Card label="Failure Rate"   value={failureRate + (failureRate !== "—" ? "%" : "")} color={Number(failureRate) > 10 ? cs.red : cs.muted} />
      </div>

      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 12, color: cs.muted, marginBottom: 8, fontWeight: 700 }}>Per Hari</div>
        {summary.length === 0 ? <Empty msg="Belum ada data dispatch (atau wa_delivery_summary view belum tersedia)." /> : (
          <div style={{ display: "grid", gap: 4, maxHeight: 400, overflowY: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "120px repeat(5, 1fr)", padding: "6px 12px", fontSize: 11, color: cs.muted, fontWeight: 700 }}>
              <span>Hari</span><span>Sent</span><span>Delivered</span><span>Failed</span><span>Pending</span><span>Retries</span>
            </div>
            {summary.map(row => (
              <div key={row.day} style={{ display: "grid", gridTemplateColumns: "120px repeat(5, 1fr)", padding: "6px 12px", background: cs.surface, borderRadius: 8, fontSize: 11 }}>
                <span style={{ color: cs.text, fontWeight: 700 }}>{row.day}</span>
                <span style={{ color: cs.muted }}>{row.total_sent}</span>
                <span style={{ color: cs.green }}>{row.delivered}</span>
                <span style={{ color: row.failed > 0 ? cs.red : cs.muted }}>{row.failed}</span>
                <span style={{ color: cs.muted }}>{row.pending}</span>
                <span style={{ color: cs.muted }}>{row.total_retries}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 10, padding: 12, fontSize: 11, color: cs.muted, lineHeight: 1.6 }}>
        ℹ️ <strong>Catatan:</strong> Delivery & failed metrics butuh callback dari Fonnte yang menulis ke <code>dispatch_logs.delivered_at</code> / <code>dispatch_logs.failed_reason</code>. Saat ini metric ini akan 0 sampai webhook callback diimplementasi.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Reusable
// ─────────────────────────────────────────────
function Card({ label, value, color }) {
  return (
    <div style={{ background: cs.card, borderRadius: 10, padding: 14, border: `1px solid ${cs.border}` }}>
      <div style={{ fontSize: 11, color: cs.muted, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || cs.text }}>{value}</div>
    </div>
  );
}

function Badge({ color, children }) {
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, background: color + "22", color, fontSize: 10, fontWeight: 700, textAlign: "center" }}>{children}</span>;
}

function ErrorRow({ err }) {
  const sev = err.severity || (err.status === "ERROR" ? "error" : err.status === "WARNING" ? "warn" : "info");
  const cfg = SEVERITY_COLOR[sev] || SEVERITY_COLOR.info;
  return (
    <div style={{ background: cfg.bg + "12", border: `1px solid ${cfg.bg}33`, borderRadius: 8, padding: 10, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <Badge color={cfg.bg}>{cfg.label}</Badge>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: cs.text }}>{err.action} {err.category && <span style={{ color: cs.muted, fontWeight: 400, fontSize: 11 }}>· {err.category}</span>}</div>
          <div style={{ color: cs.muted, marginTop: 2, wordBreak: "break-word" }}>{err.detail}</div>
          <div style={{ fontSize: 10, color: cs.muted + "88", marginTop: 4 }}>{new Date(err.time).toLocaleString("id-ID")}</div>
        </div>
      </div>
    </div>
  );
}

function Empty({ msg }) {
  return <div style={{ color: cs.muted, fontSize: 12, textAlign: "center", padding: 16 }}>{msg}</div>;
}

function selectStyle() {
  return { padding: "6px 10px", borderRadius: 8, background: cs.surface, border: `1px solid ${cs.border}`, color: cs.text, fontSize: 12 };
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
function MonitoringView({ monitorData, setMonitorLoading, setMonitorData, _apiHeaders, supabase }) {
  const [activeTab, setActiveTab] = useState("overview");

  const refreshOverview = async () => {
    try {
      setMonitorLoading(true);
      const resp = await fetch("/api/monitor", { headers: _apiHeaders ? await _apiHeaders() : {} });
      const data = await resp.json();
      setMonitorData(data);
    } finally {
      setMonitorLoading(false);
    }
  };

  const tabs = [
    { id: "overview", label: "🔍 Overview" },
    { id: "cron",     label: "⏰ Cron Jobs" },
    { id: "ai",       label: "🤖 AI Cost" },
    { id: "wa",       label: "📱 WA Delivery" },
    { id: "audit",    label: "📜 Audit Log" },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 20, color: cs.text }}>🚀 Mission Control</div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>Health, cron jobs, AI cost, WA delivery, audit log</div>
      </div>

      <div style={{ display: "flex", gap: 8, borderBottom: `1px solid ${cs.border}`, overflowX: "auto" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              padding: "10px 16px",
              background: activeTab === t.id ? cs.accent + "22" : "transparent",
              border: "none",
              borderBottom: activeTab === t.id ? `2px solid ${cs.accent}` : "2px solid transparent",
              color: activeTab === t.id ? cs.accent : cs.muted,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
              whiteSpace: "nowrap",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (monitorData ? <TabOverview data={monitorData} onRefresh={refreshOverview} /> : <Empty msg="⏳ Loading monitoring data..." />)}
      {activeTab === "cron"  && <TabCron supabase={supabase} />}
      {activeTab === "ai"    && <TabAiCost supabase={supabase} />}
      {activeTab === "wa"    && <TabWa supabase={supabase} />}
      {activeTab === "audit" && <TabAudit supabase={supabase} />}
    </div>
  );
}

export default memo(MonitoringView);
