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

    // Migration 168: satu RPC menghasilkan agregat exact. Selain lebih hemat daripada lima
    // request REST, ia tidak menghitung total dari array yang sudah terkena limit.
    const snapshotResponse = await fetch(SU + "/rest/v1/rpc/get_monitoring_snapshot", {
      method: "POST",
      headers: { ...sbHeaders, "Content-Type": "application/json" },
      body: "{}",
    });
    if (snapshotResponse.ok) {
      const snap = await snapshotResponse.json();
      const logs = snap?.logs || {};
      const cron = snap?.cron || {};
      const ai = snap?.ai || {};
      const expense = snap?.expenses || {};
      let infra = null;
      try { infra = typeof snap?.infra_raw === "string" ? JSON.parse(snap.infra_raw) : snap?.infra_raw; } catch (_) { infra = null; }
      const errorCount = Number(logs.errors_24h) || 0;
      const warningCount = Number(logs.warnings_24h) || 0;
      const staleRunning = Number(cron.stale_running) || 0;
      const failed = Number(cron.failed_7d) || 0;
      let health = (errorCount === 0 && failed === 0 && staleRunning === 0) ? "healthy"
        : (errorCount < 3 && failed < 3 && staleRunning < 3) ? "degraded" : "unhealthy";
      if (infra?.level === "critical") health = "unhealthy";
      else if (infra?.level === "warning" && health === "healthy") health = "degraded";

      return res.status(200).json({
        status: "ok",
        source: "monitoring_snapshot_v2",
        timestamp: snap?.generated_at || new Date().toISOString(),
        health,
        metrics: {
          totalErrors: errorCount,
          totalWarnings: warningCount,
          errorRate: Number(logs.total_24h) > 0 ? errorCount / Number(logs.total_24h) : 0,
          totalLogsChecked: Number(logs.total_24h) || 0,
          recentErrors: (logs.recent_problems || []).map(l => ({ ...l, time: l.created_at, classification: classifyMonitorEvent(l) })),
          cron: {
            total: Number(cron.total_7d) || 0,
            success: Number(cron.success_7d) || 0,
            failed,
            skipped: Number(cron.skipped_7d) || 0,
            running: Number(cron.running_7d) || 0,
            staleRunning,
            recent: (cron.recent || []).map(c => ({
              task: c.task_name, status: c.status, duration_ms: c.duration_ms,
              items: c.items_processed, error: c.error_message, started_at: c.started_at,
            })),
            latestByTask: cron.latest_by_task || [],
          },
          ai: {
            totalCalls: Number(ai.calls_30d) || 0,
            totalCostUsd: Number(ai.cost_30d) || 0,
            errorCount: Number(ai.errors_30d) || 0,
            byProvider: ai.by_provider_30d || {},
          },
          expenses: {
            pendingAi: Number(expense.pending_ai) || 0,
            pendingAiOver24h: Number(expense.pending_ai_over_24h) || 0,
            pendingApproval: Number(expense.pending_approval) || 0,
            unresolvedMaterial: Number(expense.unresolved_material) || 0,
            duplicateWarnings: Number(expense.duplicate_warnings) || 0,
            legacyAdminHighWithoutReview: Number(expense.legacy_admin_high_without_review) || 0,
          },
          infra,
        },
      });
    }
    // Database live belum migration 168: fallback ke endpoint lama agar operasional aman.
    const snapshotUnavailable = snapshotResponse.status === 404 || snapshotResponse.status === 400;
    if (!snapshotUnavailable) {
      const detail = (await snapshotResponse.text()).slice(0, 200);
      throw new Error("Monitoring snapshot gagal: HTTP " + snapshotResponse.status + " " + detail);
    }

    const [errResponse, countResponse, cronResponse, aiResponse, infraResponse] = await Promise.all([
      fetch(SU+"/rest/v1/agent_logs?select=action,status,severity,category,detail,created_at&or=(status.eq.ERROR,status.eq.WARNING,severity.eq.error,severity.eq.warn,severity.eq.critical)&created_at=gte."+sinceParam+"&order=created_at.desc&limit=100", { headers: sbHeaders }),
      fetch(SU+"/rest/v1/agent_logs?select=id&created_at=gte."+sinceParam+"&limit=1", { headers: { ...sbHeaders, Prefer: "count=exact" } }),
      fetch(SU+"/rest/v1/cron_runs?select=task_name,status,duration_ms,error_message,items_processed,started_at,finished_at&started_at=gte."+sinceParam+"&order=started_at.desc&limit=100", { headers: sbHeaders }),
      fetch(SU+"/rest/v1/ai_usage?select=provider,model,feature,input_tokens,output_tokens,cost_usd,duration_ms,error,created_at&created_at=gte."+sinceParam+"&order=created_at.desc&limit=200", { headers: sbHeaders }),
      fetch(SU+"/rest/v1/app_settings?select=value&key=eq.infra_usage_snapshot&limit=1", { headers: sbHeaders }),
    ]);
    const failedDependency = [errResponse, countResponse, cronResponse, aiResponse, infraResponse].find(r => !r.ok);
    if (failedDependency) throw new Error("Supabase monitoring dependency gagal: HTTP " + failedDependency.status);
    const logs = errResponse.ok ? await errResponse.json() : [];
    const totalLogsIn24h = parseInt(countResponse.headers?.get?.("content-range")?.split("/")?.[1] || "0") || 0;
    const crons = cronResponse.ok ? await cronResponse.json() : [];
    const aiUsage = aiResponse.ok ? await aiResponse.json() : [];
    const infraRows = infraResponse.ok ? await infraResponse.json() : [];
    let infra = null;
    try { infra = JSON.parse(infraRows?.[0]?.value || "null"); } catch (_) { infra = null; }

    const logsArray = Array.isArray(logs) ? logs : [];
    const cronArray = Array.isArray(crons) ? crons : [];
    const aiArray = Array.isArray(aiUsage) ? aiUsage : [];

    const errorCount = logsArray.filter(l => l.status === "ERROR" || l.severity === "error" || l.severity === "critical").length;
    const warningCount = logsArray.filter(l => l.status === "WARNING" || l.severity === "warn").length;

    const cronFailed = cronArray.filter(c => c.status === "FAILED" || c.status === "TIMEOUT").length;
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
        time: l.created_at || new Date().toISOString(),
        classification: classifyMonitorEvent(l),
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
      infra,
    };

    let health = (errorCount === 0 && cronFailed === 0)
      ? "healthy"
      : (metrics.errorRate < 0.1 && cronFailed < 3) ? "degraded" : "unhealthy";
    if (infra?.level === "critical") health = "unhealthy";
    else if (infra?.level === "warning" && health === "healthy") health = "degraded";

    return res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      health,
      metrics
    });
  } catch(err) {
    return res.status(503).json({
      status: "error",
      message: err.message,
      timestamp: new Date().toISOString()
    });
  }
}

const ACTION_REQUIRED_EVENTS = new Set([
  "MAINTENANCE_NEW_UNIT_PROPOSED", "MAINTENANCE_UNIT_SELECT_NEEDED", "MAINTENANCE_AUTOLOG_SKIP",
  "SCAN_BUKTI_FUZZY", "STOCK_INSUFFICIENT", "STOCK_MATCH_AMBIGUOUS",
]);
const AUDIT_EVENTS = new Set([
  "ADMIN_EDIT_GRATIS_APPROVED", "ORDER_DELETED", "MATERIAL_KOREKSI_ADMIN",
  "MATERIAL_BUKA_KOREKSI", "STOK_UNIT_ARSIP", "INVOICE_DELETED", "CUSTOMER_DELETED",
]);

export function classifyMonitorEvent(event) {
  if (ACTION_REQUIRED_EVENTS.has(event?.action)) return "action_required";
  if (AUDIT_EVENTS.has(event?.action)) return "audit";
  const severity = event?.severity || (event?.status === "ERROR" ? "error" : event?.status === "WARNING" ? "warn" : "info");
  return ["error", "critical"].includes(severity) ? "system_error" : "warning";
}
