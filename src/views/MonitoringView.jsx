import { memo, useEffect, useState, useMemo } from "react";
import { cs } from "../theme/cs.js";
import {
  fetchCronRuns,
  fetchAiUsage,
  fetchAgentLogsFiltered,
  fetchWaDeliverySummary,
} from "../data/reads.js";
import { auditInvoices, auditQuoteDeviation } from "../lib/invoicing.js";

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
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await fetchAgentLogsFiltered(supabase, { severity: severity || undefined, category: category || undefined, since, limit: days >= 90 ? 1000 : 300 });
    if (!error && data) setLogs(data);
    setLoading(false);
  };

  useEffect(() => { setPage(1); if (supabase) load(); }, [supabase, severity, category, days]);

  const totalPages = Math.ceil(logs.length / PAGE_SIZE) || 1;
  const curPage = Math.min(page, totalPages);
  const pageLogs = logs.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

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
          <option value={90}>90 hari (semua)</option>
        </select>
        <button onClick={load} disabled={loading} style={{ padding: "6px 12px", borderRadius: 8, background: cs.accent + "22", border: `1px solid ${cs.accent}33`, color: cs.accent, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
          {loading ? "⏳" : "🔄"}
        </button>
        <span style={{ fontSize: 11, color: cs.muted, marginLeft: "auto" }}>{logs.length} log • retensi 90 hari</span>
      </div>

      <div style={{ display: "grid", gap: 6, maxHeight: 600, overflowY: "auto" }}>
        {logs.length === 0 ? (
          <Empty msg="Tidak ada log untuk filter ini." />
        ) : pageLogs.map(l => {
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

      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 4 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={curPage === 1}
            style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${cs.border}`, background: curPage === 1 ? cs.surface : cs.card, color: curPage === 1 ? cs.muted : cs.text, cursor: curPage === 1 ? "not-allowed" : "pointer", fontSize: 12 }}>← Prev</button>
          <span style={{ fontSize: 12, color: cs.text }}>Hal {curPage}/{totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={curPage === totalPages}
            style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${cs.border}`, background: curPage === totalPages ? cs.surface : cs.card, color: curPage === totalPages ? cs.muted : cs.text, cursor: curPage === totalPages ? "not-allowed" : "pointer", fontSize: 12 }}>Next →</button>
        </div>
      )}
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
// Tab: WA Snapshots (Phase 2 review window 4-11 Juni)
// ─────────────────────────────────────────────
function TabWaSnapshots({ supabase, apiHeaders }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyDate, setBusyDate] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const load = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from("wa_daily_snapshots")
        .select("*").order("snapshot_date", { ascending: false }).limit(60);
      setRows(data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const runBackfill = async (date) => {
    if (!apiHeaders) { alert("Auth header tidak tersedia."); return; }
    if (!confirm(`Backfill semua pesan ${date} ke Pending AI?\n\nAkan re-run parser kasbon+biaya+approval. Idempotent (skip yang sudah ada).`)) return;
    setBusyDate(date);
    setLastResult(null);
    try {
      const h = await apiHeaders();
      const resp = await fetch(`/api/cron-reminder?task=wa-backfill&from=${date}&to=${date}`, { headers: h });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Backfill gagal");
      setLastResult({ date, ...json });
    } catch (e) {
      alert("Backfill gagal: " + e.message);
    } finally { setBusyDate(null); }
  };

  const fmtSize = (b) => b ? (b/1024).toFixed(1) + " KB" : "—";
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 12, color: cs.muted }}>
          Snapshot harian percakapan 3 grup (cron 20:00 WIB). Periode review awal: <b>4–11 Juni 2026</b>.
          Hapus manual via SQL/Supabase setelah analisa selesai.
        </div>
        <button onClick={load} disabled={loading}
          style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.text, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
          {loading ? "Loading..." : "↻ Refresh"}
        </button>
      </div>
      {rows.length === 0 && !loading && (
        <div style={{ padding: 24, background: cs.card, borderRadius: 10, textAlign: "center", color: cs.muted, fontSize: 13 }}>
          Belum ada snapshot. Cron jalan tiap 20:00 WIB.
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map(r => (
          <div key={r.id} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: 12, display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>📅 {r.snapshot_date}</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 4 }}>
                {r.groups_count} grup · {r.total_messages} msg · {r.total_with_image} foto · {r.total_ai_classified} AI · {r.total_expenses_inserted} biaya · {fmtSize(r.size_bytes)}
              </div>
              <div style={{ fontSize: 10, color: cs.muted, marginTop: 4, fontFamily: "monospace" }}>{r.r2_key}</div>
            </div>
            <div style={{ display: "flex", gap: 6, flexDirection: "column", alignItems: "flex-end" }}>
              <a href={r.r2_url} target="_blank" rel="noreferrer"
                style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "55", color: cs.accent, borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
                ⬇️ Download JSON
              </a>
              <button onClick={() => runBackfill(r.snapshot_date)} disabled={busyDate === r.snapshot_date}
                style={{ background: "#f59e0b22", border: "1px solid #f59e0b55", color: "#f59e0b", borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: busyDate ? "wait" : "pointer", whiteSpace: "nowrap" }}>
                {busyDate === r.snapshot_date ? "⏳ Running..." : "🔁 Backfill ke Pending AI"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {lastResult && (
        <div style={{ padding: 12, background: "#10b98122", border: "1px solid #10b98155", borderRadius: 8, fontSize: 12, color: cs.text }}>
          ✅ <b>Backfill {lastResult.date} selesai.</b><br/>
          Logs di-scan: <b>{lastResult.counters?.logs_scanned}</b> ·
          Kasbon: <b>{(lastResult.counters?.kasbon_single_inserted || 0) + (lastResult.counters?.kasbon_multi_inserted || 0)}</b> ·
          Biaya: <b>{lastResult.counters?.biaya_inserted}</b> ·
          Approval di-ACK: <b>{lastResult.counters?.approval_acked}</b> ·
          Dup skipped: <b>{lastResult.counters?.skipped_dup}</b> ·
          No-match: <b>{lastResult.counters?.skipped_no_match}</b>
        </div>
      )}
      <div style={{ fontSize: 11, color: cs.muted, padding: 12, background: "#f59e0b22", border: "1px solid #f59e0b55", borderRadius: 8 }}>
        ⏰ <b>Auto-cleanup aktif:</b> manifest snapshot &gt; 60 hari dihapus otomatis tiap 03:00 UTC (10:00 WIB) via cron <code>snapshot-cleanup</code>. R2 objek ikut di-purge cron <code>r2-cleanup-90d</code>.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Tab: AI Observations (Phase 2 shadow log — Gap 1/2/3 monitor only, NO actions)
// ─────────────────────────────────────────────
const SOURCE_LABEL = {
  gap1_carrier:      "📦 Gap 1 · Carrier 'dibawa <X>'",
  gap2_laporan_team: "📋 Gap 2 · Laporan 'team X dan Y'",
  gap3_bon_ext:      "💰 Gap 3 · Bon extended (perbaikan/tol/cuci)",
};
function TabWaObservations({ supabase }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [confFilter, setConfFilter] = useState("all");
  const [days, setDays] = useState(3);

  const load = async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      let q = supabase.from("wa_ai_observations").select("*").gte("observed_at", since).order("observed_at", { ascending: false }).limit(300);
      if (sourceFilter !== "all") q = q.eq("source", sourceFilter);
      if (confFilter !== "all") q = q.eq("match_confidence", confFilter);
      const { data } = await q;
      setRows(data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [sourceFilter, confFilter, days]);

  const counts = useMemo(() => {
    const c = { total: rows.length, gap1: 0, gap2: 0, gap3: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const r of rows) { c[r.source.replace("_carrier","").replace("_laporan_team","").replace("_bon_ext","")] = (c[r.source.replace("_carrier","").replace("_laporan_team","").replace("_bon_ext","")] || 0) + 1; c[r.match_confidence] = (c[r.match_confidence] || 0) + 1; }
    return { total: rows.length, gap1: rows.filter(r=>r.source==="gap1_carrier").length, gap2: rows.filter(r=>r.source==="gap2_laporan_team").length, gap3: rows.filter(r=>r.source==="gap3_bon_ext").length, HIGH: rows.filter(r=>r.match_confidence==="HIGH").length, MEDIUM: rows.filter(r=>r.match_confidence==="MEDIUM").length, LOW: rows.filter(r=>r.match_confidence==="LOW").length };
  }, [rows]);

  const confColor = (c) => c === "HIGH" ? "#10b981" : c === "MEDIUM" ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ padding: 12, background: "#3b82f622", border: "1px solid #3b82f655", borderRadius: 8, fontSize: 12, color: cs.text }}>
        🧪 <b>Shadow mode:</b> parser cuma LOG ke <code>wa_ai_observations</code>. Tidak ada auto-mark order COMPLETED, auto-create draft invoice, atau auto-insert material/expense. Owner review manual. Akan diaktifkan jadi action mode setelah confidence ≥95%.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          style={{ background: cs.card, color: cs.text, border: "1px solid " + cs.border, borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
          <option value="all">Semua source</option>
          <option value="gap1_carrier">Gap 1 · Carrier</option>
          <option value="gap2_laporan_team">Gap 2 · Laporan</option>
          <option value="gap3_bon_ext">Gap 3 · Bon ext</option>
        </select>
        <select value={confFilter} onChange={e => setConfFilter(e.target.value)}
          style={{ background: cs.card, color: cs.text, border: "1px solid " + cs.border, borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
          <option value="all">Semua confidence</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
        <select value={days} onChange={e => setDays(parseInt(e.target.value))}
          style={{ background: cs.card, color: cs.text, border: "1px solid " + cs.border, borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
          <option value={1}>1 hari</option>
          <option value={3}>3 hari</option>
          <option value={7}>7 hari</option>
          <option value={30}>30 hari</option>
        </select>
        <button onClick={load} disabled={loading}
          style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.text, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
          {loading ? "..." : "↻"}
        </button>
        <div style={{ marginLeft: "auto", fontSize: 11, color: cs.muted }}>
          {counts.total} obs · Gap1: {counts.gap1} · Gap2: {counts.gap2} · Gap3: {counts.gap3} · <span style={{ color: "#10b981" }}>{counts.HIGH} HIGH</span> · <span style={{ color: "#f59e0b" }}>{counts.MEDIUM} MED</span> · <span style={{ color: "#ef4444" }}>{counts.LOW} LOW</span>
        </div>
      </div>

      {rows.length === 0 && !loading && (
        <div style={{ padding: 24, background: cs.card, borderRadius: 10, textAlign: "center", color: cs.muted, fontSize: 13 }}>
          Tidak ada observasi sesuai filter. Coba ubah filter atau perpanjang range hari.
        </div>
      )}
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map(r => (
          <div key={r.id} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: cs.muted + "22", color: cs.text, fontWeight: 700 }}>
                {SOURCE_LABEL[r.source] || r.source}
              </span>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: confColor(r.match_confidence) + "22", color: confColor(r.match_confidence), fontWeight: 700 }}>
                {r.match_confidence}
              </span>
              <span style={{ fontSize: 11, color: cs.muted }}>{new Date(r.observed_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</span>
              <span style={{ fontSize: 11, color: cs.muted }}>· {r.sender_name} @ {r.group_name}</span>
            </div>
            <div style={{ fontSize: 12, color: cs.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.message_text}</div>
            <div style={{ fontSize: 11, color: cs.muted, fontStyle: "italic" }}>🧠 {r.notes}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Tab: Rekonsiliasi Invoice (P2) — daftar invoice yang melanggar invarian
// (total ≠ Σ line item, atau labor/material desync). Read-only, sumber: tabel invoices.
// ─────────────────────────────────────────────
function TabInvoiceRecon({ supabase }) {
  const [rows, setRows] = useState([]);
  const [devRows, setDevRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [days, setDays] = useState(30);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await supabase
      .from("invoices")
      .select("id,customer,service,status,labor,material,total,discount,trade_in_amount,materials_detail,job_id,quotation_id,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(3000);
    if (!error && data) {
      setScanned(data.length);
      setRows(auditInvoices(data, { skipCancelled: true }));
      // Deviasi vs Quotation
      const { data: quos } = await supabase
        .from("quotations")
        .select("id,customer,total,invoice_id,job_id,status")
        .gt("total", 0)
        .limit(2000);
      setDevRows(auditQuoteDeviation(data, quos || []));
    }
    setLoading(false);
  };

  useEffect(() => { if (supabase) load(); }, [supabase, days]);

  const totalGap = rows.reduce((s, r) => s + Math.abs(r.diff.total || 0), 0);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>🧾 Rekonsiliasi Invoice</div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={selectStyle()}>
          <option value={7}>7 hari</option>
          <option value={30}>30 hari</option>
          <option value={90}>90 hari</option>
          <option value={3650}>Semua</option>
        </select>
        <button onClick={load} disabled={loading} style={{ padding: "6px 12px", borderRadius: 8, background: cs.accent + "22", border: `1px solid ${cs.accent}33`, color: cs.accent, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
          {loading ? "⏳" : "🔄"}
        </button>
        <span style={{ fontSize: 11, color: cs.muted, marginLeft: "auto" }}>
          {scanned} invoice dipindai • <b style={{ color: rows.length ? "#f59e0b" : "#22c55e" }}>{rows.length} tidak konsisten</b>
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160, background: cs.surface, borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: cs.muted }}>Invoice bermasalah</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: rows.length ? "#f59e0b" : "#22c55e" }}>{rows.length}</div>
        </div>
        <div style={{ flex: 1, minWidth: 160, background: cs.surface, borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: cs.muted }}>Total selisih nilai</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: cs.text }}>{fmtIDR(totalGap)}</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 6, maxHeight: 600, overflowY: "auto" }}>
        {rows.length === 0 ? (
          <Empty msg={loading ? "⏳ Memindai..." : "✅ Semua invoice konsisten untuk rentang ini."} />
        ) : rows.map(r => (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "150px 1fr 90px", alignItems: "start", gap: 8, padding: "8px 12px", background: cs.surface, borderRadius: 8, fontSize: 11 }}>
            <div>
              <div style={{ color: cs.text, fontWeight: 700, fontFamily: "monospace" }}>{r.id}</div>
              <div style={{ color: cs.muted, fontSize: 10 }}>{r.status} · {r.service}</div>
            </div>
            <div style={{ color: cs.muted }}>
              <div style={{ color: cs.text }}>{r.customer}</div>
              <div style={{ fontSize: 10 }}>
                {!r.hasLines && <span style={{ color: "#ef4444" }}>⚠ tanpa line item · </span>}
                total {fmtIDR(r.actual.total)} (harusnya {fmtIDR(r.expected.total)})
                {r.diff.material !== 0 && <> · material Δ{fmtIDR(r.diff.material)}</>}
                {r.diff.labor !== 0 && <> · jasa Δ{fmtIDR(r.diff.labor)}</>}
              </div>
            </div>
            <span style={{ color: Math.abs(r.diff.total) > 0 ? "#ef4444" : "#f59e0b", fontWeight: 800, textAlign: "right" }}>
              Δ{fmtIDR(Math.abs(r.diff.total) || Math.abs(r.diff.material))}
            </span>
          </div>
        ))}
      </div>
      {/* ── Deviasi Invoice vs Quotation ── */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: cs.text, marginBottom: 6 }}>
          📋 Invoice menyimpang dari Quotation <span style={{ fontSize: 11, color: devRows.length ? "#f59e0b" : "#22c55e", fontWeight: 800 }}>({devRows.length})</span>
        </div>
        <div style={{ display: "grid", gap: 6, maxHeight: 360, overflowY: "auto" }}>
          {devRows.length === 0 ? (
            <Empty msg="✅ Tidak ada invoice yang menyimpang dari quotation." />
          ) : devRows.map(d => (
            <div key={d.quotationId + d.invoiceId} style={{ display: "grid", gridTemplateColumns: "1fr 110px", alignItems: "start", gap: 8, padding: "8px 12px", background: cs.surface, borderRadius: 8, fontSize: 11 }}>
              <div>
                <div style={{ color: cs.text, fontWeight: 700 }}>{d.customer || "—"}</div>
                <div style={{ color: cs.muted, fontSize: 10, fontFamily: "monospace" }}>
                  {d.quotationId} → {d.invoiceId} · {d.status} · cocok via {d.matchedBy}
                </div>
                <div style={{ fontSize: 10, color: cs.muted }}>
                  quote {fmtIDR(d.quoteTotal)} → invoice {fmtIDR(d.invoiceTotal)}
                </div>
              </div>
              <span style={{ color: d.diff > 0 ? "#22c55e" : "#ef4444", fontWeight: 800, textAlign: "right" }}>
                {d.diff > 0 ? "+" : ""}{fmtIDR(d.diff)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 10, color: cs.muted }}>
        Catatan: jalur baru (submit & verify laporan) sudah konsisten otomatis. Sisa temuan biasanya dari Edit Nilai / Invoice Gabungan / ARA / data lama (sebelum P0). Deviasi quotation = invoice yang totalnya beda dari penawaran (tambahan/kurang di lapangan) — perlu dicek manual.
      </div>
    </div>
  );
}

// 🏢 Link Maintenance — pemeriksa missing-link: order maintenance yang putus link unit/client/invoice
function TabMaintLink({ apiHeaders }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(120);
  const [err, setErr] = useState("");

  const load = async () => {
    if (!apiHeaders) { setErr("Auth header tidak tersedia."); return; }
    setLoading(true); setErr("");
    try {
      const h = await apiHeaders();
      const resp = await fetch("/api/maintenance", {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link-audit", days }),
      });
      const jj = await resp.json();
      if (!resp.ok) { setErr(jj.error || "Gagal memuat audit"); setData(null); }
      else setData(jj);
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (apiHeaders) load(); /* eslint-disable-next-line */ }, [apiHeaders, days]);

  const s = data?.summary || {};
  const totalIssues = (s.missing_logs || 0) + (s.unverified || 0) + (s.invoice_unlinked || 0) + (s.unlinked_candidates || 0);

  const Section = ({ title, hint, color, rows, render }) => (
    <div>
      <div style={{ fontWeight: 700, fontSize: 13, color: cs.text, marginBottom: 2 }}>
        {title} <span style={{ fontSize: 11, color: rows.length ? color : "#22c55e", fontWeight: 800 }}>({rows.length})</span>
      </div>
      {hint && <div style={{ fontSize: 10, color: cs.muted, marginBottom: 6 }}>{hint}</div>}
      <div style={{ display: "grid", gap: 6, maxHeight: 320, overflowY: "auto", marginBottom: 12 }}>
        {rows.length === 0 ? <Empty msg="✅ Bersih." /> : rows.map(render)}
      </div>
    </div>
  );

  const card = (key, main, sub, badge, badgeColor) => (
    <div key={key} style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 8, padding: "8px 12px", background: cs.surface, borderRadius: 8, fontSize: 11 }}>
      <div>
        <div style={{ color: cs.text, fontWeight: 700 }}>{main}</div>
        <div style={{ color: cs.muted, fontSize: 10, fontFamily: "monospace" }}>{sub}</div>
      </div>
      {badge && <span style={{ color: badgeColor, fontWeight: 800, fontSize: 10, whiteSpace: "nowrap" }}>{badge}</span>}
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>🏢 Pemeriksa Link Maintenance</div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={selectStyle()}>
          <option value={30}>30 hari</option>
          <option value={120}>120 hari</option>
          <option value={365}>1 tahun</option>
          <option value={3650}>Semua</option>
        </select>
        <button onClick={load} disabled={loading} style={{ padding: "6px 12px", borderRadius: 8, background: cs.accent + "22", border: `1px solid ${cs.accent}33`, color: cs.accent, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
          {loading ? "⏳" : "🔄"}
        </button>
        <span style={{ fontSize: 11, color: cs.muted, marginLeft: "auto" }}>
          <b style={{ color: totalIssues ? "#ef4444" : "#22c55e" }}>{totalIssues} perlu tindakan</b>
        </span>
      </div>

      {err && <div style={{ fontSize: 11, color: "#ef4444" }}>⚠ {err}</div>}
      {!data ? <Empty msg={loading ? "⏳ Memindai..." : "—"} /> : (
        <>
          <Section
            title="🔴 History unit kosong (laporan VERIFIED, 0 log)"
            hint="Pekerjaan selesai & terverifikasi tapi belum tercatat ke unit mana pun. Pilih unit di order lalu verifikasi ulang laporan."
            color="#ef4444"
            rows={data.missing_logs || []}
            render={(r) => card(r.order_id, `${r.customer} — ${r.client}`, `${r.order_id} · ${r.service} · ${r.date} · ${r.status}`, "0 log", "#ef4444")}
          />
          <Section
            title="🟠 Order belum di-link (HP cocok perusahaan)"
            hint="Nomor HP order cocok dengan PIC perusahaan maintenance tapi order belum ditautkan. Tautkan supaya history tercatat."
            color="#f59e0b"
            rows={data.unlinked_candidates || []}
            render={(r) => card(r.order_id, `${r.customer} → ${r.suggest_client}`, `${r.order_id} · ${r.service} · ${r.date} · ${r.status}`, "perlu link", "#f59e0b")}
          />
          <Section
            title="🟡 Laporan maintenance belum diverifikasi"
            hint="Autolog baru jalan saat laporan diverifikasi. Verifikasi di Laporan Tim agar history terisi."
            color="#eab308"
            rows={data.unverified || []}
            render={(r) => card(r.order_id, r.customer, `${r.order_id} · ${r.service} · ${r.date}`, "SUBMITTED", "#eab308")}
          />
          <Section
            title="🟠 Invoice belum ter-link ke perusahaan"
            hint="Invoice order maintenance tapi maintenance_client_id kosong — tak muncul di tagihan B2B perusahaan."
            color="#f59e0b"
            rows={data.invoice_unlinked || []}
            render={(r) => card(r.invoice_id, r.customer, `${r.invoice_id} · ${r.order_id} · ${r.status}`, fmtIDR(r.total), "#f59e0b")}
          />
          <Section
            title="🔵 Link lemah (tercatat via posisi, bukan ID unit)"
            hint="Sudah ada log tapi sebagian unit laporan tak punya maint_unit_id (dicocokkan posisi — rawan salah AC bila urutan beda). Idealnya teknisi pilih unit via 'Tambah dari Daftar Maintenance'."
            color="#3b82f6"
            rows={data.weak_links || []}
            render={(r) => card(r.order_id, `${r.customer} — ${r.client}`, `${r.order_id} · ${r.service} · ${r.date}`, `${r.units_no_id}/${r.units_total} tanpa ID`, "#3b82f6")}
          />
          <div style={{ fontSize: 10, color: cs.muted }}>
            Window {data.window_days} hari. Pemeriksa ini hanya membaca data (tidak mengubah apa pun). Lakukan perbaikan dari menu terkait (Planning Order / Laporan Tim / Maintenance).
          </div>
        </>
      )}
    </div>
  );
}

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
    { id: "overview",     label: "🔍 Overview" },
    { id: "cron",         label: "⏰ Cron Jobs" },
    { id: "ai",           label: "🤖 AI Cost" },
    { id: "wa",           label: "📱 WA Delivery" },
    { id: "snapshots",    label: "📸 WA Snapshots" },
    { id: "observations", label: "🧪 AI Observations" },
    { id: "recon",        label: "🧾 Rekonsiliasi Invoice" },
    { id: "maintlink",    label: "🏢 Link Maintenance" },
    { id: "audit",        label: "📜 Audit Log" },
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
      {activeTab === "wa"        && <TabWa supabase={supabase} />}
      {activeTab === "snapshots"    && <TabWaSnapshots supabase={supabase} apiHeaders={_apiHeaders} />}
      {activeTab === "observations" && <TabWaObservations supabase={supabase} />}
      {activeTab === "recon"     && <TabInvoiceRecon supabase={supabase} />}
      {activeTab === "maintlink" && <TabMaintLink apiHeaders={_apiHeaders} />}
      {activeTab === "audit"     && <TabAudit supabase={supabase} />}
    </div>
  );
}

export default memo(MonitoringView);
