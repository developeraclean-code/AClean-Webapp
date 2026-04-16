import { memo } from "react";
import { cs } from "../theme/cs.js";

function MonitoringView({ monitorData, setMonitorLoading, setMonitorData }) {
  const data = monitorData;
  if (!data) return <div style={{ padding: 24, color: cs.muted }}>⏳ Loading monitoring data...</div>;

  const metrics = data.metrics || {};
  const errorRate = metrics.errorRate || 0;
  const hasHighErrors = errorRate > 0.1;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 20, color: cs.text }}>🔍 System Monitoring</div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>Real-time health status & error tracking</div>
      </div>

      <div style={{
        background: data.health === "healthy" ? cs.green + "18" : data.health === "degraded" ? cs.yellow + "18" : cs.red + "18",
        border: `1px solid ${data.health === "healthy" ? cs.green : data.health === "degraded" ? cs.yellow : cs.red}33`,
        borderRadius: 14, padding: 20, display: "grid", gap: 12
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>
              {data.health === "healthy" ? "✅ Healthy" : data.health === "degraded" ? "⚠️ Degraded" : "🔴 Unhealthy"}
            </div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 4 }}>Last updated: {new Date(data.timestamp).toLocaleTimeString("id-ID")}</div>
          </div>
          <button onClick={() => {
            setMonitorLoading(true);
            fetch("/api/monitor").then(r => r.json()).then(d => {
              setMonitorData(d);
              setMonitorLoading(false);
            });
          }} style={{ padding: "8px 14px", borderRadius: 8, background: cs.accent + "22", border: `1px solid ${cs.accent}33`, color: cs.accent, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
            🔄 Refresh Now
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
          <div style={{ background: cs.card, borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11, color: cs.muted, fontWeight: 700, marginBottom: 6 }}>Total Errors (24h)</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: cs.red }}>{metrics.totalErrors || 0}</div>
          </div>
          <div style={{ background: cs.card, borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11, color: cs.muted, fontWeight: 700, marginBottom: 6 }}>Total Warnings (24h)</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: cs.yellow }}>{metrics.totalWarnings || 0}</div>
          </div>
          <div style={{ background: cs.card, borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11, color: cs.muted, fontWeight: 700, marginBottom: 6 }}>Error Rate</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: errorRate > 0.1 ? cs.red : errorRate > 0.05 ? cs.yellow : cs.green }}>
              {(errorRate * 100).toFixed(1)}%
            </div>
          </div>
          <div style={{ background: cs.card, borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11, color: cs.muted, fontWeight: 700, marginBottom: 6 }}>Logs Checked</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: cs.accent }}>{metrics.totalLogsChecked || 0}</div>
          </div>
        </div>

        {hasHighErrors && (
          <div style={{ background: cs.red + "22", border: `1px solid ${cs.red}44`, borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 700, color: cs.red, fontSize: 13 }}>⚠️ High Error Rate Detected</div>
            <div style={{ fontSize: 11, color: cs.red, marginTop: 4, opacity: 0.8 }}>
              Error rate is {(errorRate * 100).toFixed(1)}% (threshold: 10%). Check recent errors below.
            </div>
          </div>
        )}
      </div>

      <div style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 16 }}>
        <div style={{ fontWeight: 700, color: cs.text, marginBottom: 12, fontSize: 14 }}>📋 Recent Errors & Warnings (Last 24h)</div>
        {(!metrics.recentErrors || metrics.recentErrors.length === 0) ? (
          <div style={{ color: cs.muted, fontSize: 12, textAlign: "center", padding: 20 }}>✅ No errors or warnings found</div>
        ) : (
          <div style={{ display: "grid", gap: 8, maxHeight: "400px", overflowY: "auto" }}>
            {metrics.recentErrors.map((err, idx) => (
              <div key={idx} style={{
                background: err.status === "ERROR" ? cs.red + "12" : cs.yellow + "12",
                border: `1px solid ${err.status === "ERROR" ? cs.red : cs.yellow}33`,
                borderRadius: 8, padding: 10, fontSize: 12
              }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ fontWeight: 700, color: err.status === "ERROR" ? cs.red : cs.yellow, minWidth: 50 }}>
                    {err.status === "ERROR" ? "❌" : "⚠️"} {err.status}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: cs.text }}>{err.action}</div>
                    <div style={{ color: cs.muted, marginTop: 2, wordBreak: "break-word" }}>{err.detail}</div>
                    <div style={{ fontSize: 11, color: cs.muted + "88", marginTop: 4 }}>
                      {new Date(err.time).toLocaleString("id-ID")}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 11, color: cs.muted, lineHeight: 1.6 }}>
          <strong>📊 Health Status:</strong><br />
          • <strong>Healthy:</strong> Error rate &lt; 5%<br />
          • <strong>Degraded:</strong> Error rate 5-10%<br />
          • <strong>Unhealthy:</strong> Error rate &gt; 10%<br /><br />
          <strong>🔄 Auto-refresh:</strong> Every 30 seconds<br />
          <strong>📌 Data Period:</strong> Last 24 hours
        </div>
      </div>
    </div>
  );
}

export default memo(MonitoringView);
