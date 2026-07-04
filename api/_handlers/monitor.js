// api/_handlers/monitor.js — Handler monitoring (Batch 1 pemecahan router, Jul 2026).
// Isi dipindah APA ADANYA dari api/[route].js — di-dispatch oleh api/[route].js.

// ── MONITOR (GET, private — MonitoringView) ──
export async function monitor(req, res) {
  if (req.method !== "GET") return res.status(405).json({error: "Method not allowed"});
  const SU=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, SK=process.env.SUPABASE_SERVICE_KEY;
  if (!SU||!SK) return res.status(200).json({ status: "limited", message: "Supabase not configured" });

  try {
    const since24h = new Date(Date.now() - 24*60*60*1000).toISOString();
    const sinceParam = encodeURIComponent(since24h);
    const sbHeaders = { apikey: SK, Authorization: "Bearer " + SK };

    const [errResponse, countResponse, cronResponse, aiResponse] = await Promise.all([
      fetch(SU+"/rest/v1/agent_logs?select=action,status,severity,category,detail,created_at&or=(status.eq.ERROR,status.eq.WARNING,severity.eq.error,severity.eq.warn,severity.eq.critical)&created_at=gte."+sinceParam+"&order=created_at.desc&limit=100", { headers: sbHeaders }),
      fetch(SU+"/rest/v1/agent_logs?select=id&created_at=gte."+sinceParam+"&limit=1", { headers: { ...sbHeaders, Prefer: "count=exact" } }),
      fetch(SU+"/rest/v1/cron_runs?select=task_name,status,duration_ms,error_message,items_processed,started_at,finished_at&started_at=gte."+sinceParam+"&order=started_at.desc&limit=100", { headers: sbHeaders }),
      fetch(SU+"/rest/v1/ai_usage?select=provider,model,feature,input_tokens,output_tokens,cost_usd,duration_ms,error,created_at&created_at=gte."+sinceParam+"&order=created_at.desc&limit=200", { headers: sbHeaders }),
    ]);
    const logs = errResponse.ok ? await errResponse.json() : [];
    const totalLogsIn24h = parseInt(countResponse.headers?.get?.("content-range")?.split("/")?.[1] || "0") || 0;
    const crons = cronResponse.ok ? await cronResponse.json() : [];
    const aiUsage = aiResponse.ok ? await aiResponse.json() : [];

    const logsArray = Array.isArray(logs) ? logs : [];
    const cronArray = Array.isArray(crons) ? crons : [];
    const aiArray = Array.isArray(aiUsage) ? aiUsage : [];

    const errorCount = logsArray.filter(l => l.status === "ERROR" || l.severity === "error" || l.severity === "critical").length;
    const warningCount = logsArray.filter(l => l.status === "WARNING" || l.severity === "warn").length;

    const cronFailed = cronArray.filter(c => c.status === "FAILED").length;
    const cronSuccess = cronArray.filter(c => c.status === "SUCCESS").length;
    const cronSkipped = cronArray.filter(c => c.status === "SKIPPED").length;
    const cronRunning = cronArray.filter(c => c.status === "RUNNING").length;

    const aiTotalCost = aiArray.reduce((s, a) => s + (Number(a.cost_usd) || 0), 0);
    const aiByProvider = aiArray.reduce((m, a) => {
      const p = a.provider || "unknown";
      if (!m[p]) m[p] = { calls: 0, cost: 0, input_tokens: 0, output_tokens: 0 };
      m[p].calls++;
      m[p].cost += Number(a.cost_usd) || 0;
      m[p].input_tokens += Number(a.input_tokens) || 0;
      m[p].output_tokens += Number(a.output_tokens) || 0;
      return m;
    }, {});
    Object.keys(aiByProvider).forEach(k => { aiByProvider[k].cost = Number(aiByProvider[k].cost.toFixed(4)); });

    const metrics = {
      totalErrors: errorCount,
      totalWarnings: warningCount,
      errorRate: totalLogsIn24h > 0 ? errorCount / totalLogsIn24h : 0,
      totalLogsChecked: totalLogsIn24h,
      recentErrors: logsArray.slice(0, 10).map(l => ({
        action: l.action || "UNKNOWN",
        status: l.status || (l.severity ? l.severity.toUpperCase() : "UNKNOWN"),
        severity: l.severity || null,
        category: l.category || null,
        detail: (l.detail || "").slice(0, 200),
        time: l.created_at || new Date().toISOString()
      })),
      cron: {
        total: cronArray.length,
        success: cronSuccess,
        failed: cronFailed,
        skipped: cronSkipped,
        running: cronRunning,
        recent: cronArray.slice(0, 20).map(c => ({
          task: c.task_name,
          status: c.status,
          duration_ms: c.duration_ms,
          items: c.items_processed,
          error: c.error_message,
          started_at: c.started_at,
        })),
      },
      ai: {
        totalCalls: aiArray.length,
        totalCostUsd: Number(aiTotalCost.toFixed(4)),
        errorCount: aiArray.filter(a => a.error).length,
        byProvider: aiByProvider,
      },
    };

    const health = (errorCount === 0 && cronFailed === 0)
      ? "healthy"
      : (metrics.errorRate < 0.1 && cronFailed < 3) ? "degraded" : "unhealthy";

    return res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      health,
      metrics
    });
  } catch(err) {
    return res.status(200).json({
      status: "error",
      message: err.message,
      timestamp: new Date().toISOString()
    });
  }
}
