import { cs } from "../theme/cs.js";

const AGENT_LOG_PAGE_SIZE = 20;

export default function AgentLogView({ agentLogs, logDateFilter, setLogDateFilter, logActionFilter, setLogActionFilter, agentLogPage, setAgentLogPage }) {
  const logDates = [...new Set(agentLogs.map(l => (l.created_at || "").slice(0, 10)).filter(Boolean))].sort().reverse();
  const filteredLogs = agentLogs.filter(l => {
    const dayMatch = logDateFilter === "Semua" || (l.created_at || "").slice(0, 10) === logDateFilter;
    const actMatch = logActionFilter === "Semua" || l.action === logActionFilter;
    return dayMatch && actMatch;
  });
  const logActions = [...new Set(agentLogs.map(l => l.action).filter(Boolean))].sort();
  const totPgLog = Math.ceil(filteredLogs.length / AGENT_LOG_PAGE_SIZE) || 1;
  const curPgLog = Math.min(agentLogPage, totPgLog);
  const pageLog = filteredLogs.slice((curPgLog - 1) * AGENT_LOG_PAGE_SIZE, curPgLog * AGENT_LOG_PAGE_SIZE);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>🤖 ARA Agent Log</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: cs.muted, fontWeight: 600 }}>Tanggal:</span>
          <select value={logDateFilter} onChange={e => { setLogDateFilter(e.target.value); setAgentLogPage(1); }}
            style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>
            <option value="Semua">Semua</option>
            {logDates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: cs.muted, fontWeight: 600 }}>Action:</span>
          <select value={logActionFilter} onChange={e => { setLogActionFilter(e.target.value); setAgentLogPage(1); }}
            style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, color: cs.text, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>
            <option value="Semua">Semua</option>
            {logActions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <span style={{ fontSize: 11, color: cs.muted, marginLeft: "auto" }}>
          {filteredLogs.length} / {agentLogs.length} log • auto-hapus &gt;90 hari
        </span>
      </div>
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
        {filteredLogs.length === 0
          ? <div style={{ padding: "32px", textAlign: "center", color: cs.muted, fontSize: 13 }}>Tidak ada log untuk filter ini.</div>
          : pageLog.map((log, i) => {
            const lC = log.status === "ERROR" ? cs.red : log.status === "WARNING" ? cs.yellow : cs.green;
            return (
              <div key={i} style={{ display: "flex", gap: 14, padding: "12px 18px", borderBottom: "1px solid " + cs.border, alignItems: "flex-start" }}>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: cs.muted, whiteSpace: "nowrap", flexShrink: 0 }}>
                  {log.created_at ? new Date(log.created_at).toLocaleString("id-ID", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : (log.time || "-")}
                </span>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: lC + "22", color: lC, border: "1px solid " + lC + "33", fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>{log.status}</span>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: cs.accent + "18", color: cs.accent, fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>{log.action}</span>
                <span style={{ fontSize: 12, color: cs.muted }}>{log.user_name ? `[${log.user_name}] ` : ""}{log.detail}</span>
              </div>
            );
          })
        }
      </div>
      {totPgLog > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0" }}>
          <button onClick={() => setAgentLogPage(p => Math.max(1, p - 1))} disabled={curPgLog === 1}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgLog === 1 ? cs.surface : cs.card, color: curPgLog === 1 ? cs.muted : cs.text, cursor: curPgLog === 1 ? "not-allowed" : "pointer", fontSize: 12 }}>← Prev</button>
          <span style={{ fontSize: 12, color: cs.text }}>Hal {curPgLog}/{totPgLog}</span>
          <button onClick={() => setAgentLogPage(p => Math.min(totPgLog, p + 1))} disabled={curPgLog === totPgLog}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgLog === totPgLog ? cs.surface : cs.card, color: curPgLog === totPgLog ? cs.muted : cs.text, cursor: curPgLog === totPgLog ? "not-allowed" : "pointer", fontSize: 12 }}>Next →</button>
          <span style={{ fontSize: 11, color: cs.muted }}>{filteredLogs.length} log</span>
        </div>
      )}
    </div>
  );
}
