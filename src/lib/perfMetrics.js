const metrics = [];

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
  if (typeof window !== "undefined") window.__ACLEAN_PERF__ = metrics;
}
