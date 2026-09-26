const metrics = [];
let flushedCount = 0;
let sampledSession = null;
const PERSISTED_METRIC = /^(bootstrap\.|dashboard\.|view_data\.|finance\.)/;

const now = () => (typeof performance !== "undefined" && performance.now
  ? performance.now()
  : Date.now());

export function recordPerfMetric(name, durationMs, detail = {}) {
  const metric = {
    name,
    durationMs: Math.round(Number(durationMs) || 0),
    at: new Date().toISOString(),
    ...detail,
  };
  metrics.push(metric);
  if (metrics.length > 100) metrics.splice(0, metrics.length - 100);

  if (typeof window !== "undefined") {
    window.__ACLEAN_PERF__ = metrics;
    window.dispatchEvent(new CustomEvent("aclean:perf", { detail: metric }));
  }
  if (import.meta.env?.DEV) console.info(`[PERF] ${name}: ${metric.durationMs}ms`, detail);
  return metric;
}

export async function measureAsync(name, task, detail = {}) {
  const startedAt = now();
  try {
    const result = await task();
    recordPerfMetric(name, now() - startedAt, { ...detail, outcome: "ok" });
    return result;
  } catch (error) {
    recordPerfMetric(name, now() - startedAt, {
      ...detail,
      outcome: "error",
      error: error?.message || String(error),
    });
    throw error;
  }
}

export function getPerfMetrics() {
  return metrics.map(metric => ({ ...metric }));
}

export function resetPerfMetrics() {
  metrics.length = 0;
  flushedCount = 0;
  sampledSession = null;
  if (typeof window !== "undefined") window.__ACLEAN_PERF__ = metrics;
}

function isSampled(sampleRate) {
  if (sampledSession !== null) return sampledSession;
  try {
    const stored = sessionStorage.getItem("aclean_perf_sampled");
    if (stored === "1" || stored === "0") return (sampledSession = stored === "1");
    sampledSession = Math.random() < sampleRate;
    sessionStorage.setItem("aclean_perf_sampled", sampledSession ? "1" : "0");
  } catch {
    sampledSession = Math.random() < sampleRate;
  }
  return sampledSession;
}

// Kirim maksimal satu batch kecil. Database mengagregasikan ke satu
// row/metric/hari/role, sehingga tidak membuat tabel event yang terus membesar.
export async function flushPerfMetrics(supabase, role = "Unknown", { sampleRate = 0.1, force = false } = {}) {
  if (!supabase || (!force && !isSampled(sampleRate))) return { sampled: false, recorded: 0 };
  const endIndex = metrics.length;
  const batch = metrics.slice(flushedCount, endIndex)
    .filter(metric => PERSISTED_METRIC.test(metric.name || ""))
    .slice(0, 20)
    .map(({ name, durationMs, outcome }) => ({
    name, durationMs, outcome: outcome || "ok",
  }));
  if (!batch.length) {
    flushedCount = endIndex;
    return { sampled: true, recorded: 0 };
  }
  const { data, error } = await supabase.rpc("record_performance_metrics", {
    p_metrics: batch,
    p_role: role || "Unknown",
  });
  if (error) {
    const unavailable = /record_performance_metrics|schema cache|could not find the function/i.test(error.message || "");
    if (!unavailable && import.meta.env?.DEV) console.warn("[PERF] flush gagal:", error.message);
    return { sampled: true, recorded: 0, error };
  }
  // Tandai snapshot input ini selesai hanya sesudah RPC sukses. Metric baru yang
  // tercatat selama request tetap akan ikut flush berikutnya.
  flushedCount = endIndex;
  return { sampled: true, recorded: Number(data) || 0 };
}
