const metrics = [];
let flushedSequence = 0, nextSequence = 1, pendingFlush = null, retryAt = 0, generation = 0;
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
    sequence: nextSequence++,
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
    recordPerfMetric(name, now() - startedAt, { ...detail, outcome: result?.error ? "error" : "ok" });
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
  flushedSequence = 0; nextSequence = 1; pendingFlush = null; retryAt = 0; generation++;
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
  if (pendingFlush) return pendingFlush;
  if (Date.now() < retryAt) return { sampled: true, recorded: 0, paused: true };
  const currentGeneration = generation;
  const candidates = metrics.filter(metric => metric.sequence > flushedSequence)
    .filter(metric => PERSISTED_METRIC.test(metric.name || ""))
    .slice(0, 20);
  const endSequence = candidates.at(-1)?.sequence ?? (nextSequence - 1);
  const batch = candidates.map(({ name, durationMs, outcome }) => ({
    name, durationMs, outcome: outcome || "ok",
  }));
  if (!batch.length) {
    flushedSequence = endSequence;
    return { sampled: true, recorded: 0 };
  }
  pendingFlush = Promise.resolve().then(async () => {
    const controller = new AbortController(); let timer;
    try {
      const query = supabase.rpc('record_performance_metrics', { p_metrics: batch, p_role: role || 'Unknown' });
      const result = await Promise.race([
        query.abortSignal ? query.abortSignal(controller.signal) : query,
        new Promise((_,reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Performance logging timeout')); },3000); }),
      ]);
      if (result.error) throw result.error;
      if (generation === currentGeneration) flushedSequence = endSequence;
      return { sampled: true, recorded: Number(result.data) || 0 };
    } catch (error) {
      if (generation === currentGeneration) retryAt = Date.now() + 5 * 60_000;
      return { sampled: true, recorded: 0, error };
    } finally {
      clearTimeout(timer);
      if (generation === currentGeneration) pendingFlush = null;
    }
  });
  return pendingFlush;
}
