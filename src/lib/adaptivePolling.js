// One request per worker. Delay is measured AFTER completion, not from a fixed
// interval, so slow responses never stack. Each tab/task gets a small jitter.
export function startAdaptivePolling({ load, onResult, onError, canRun = () => true,
  intervalMs = 90_000, maxIntervalMs = 15 * 60_000, timeoutMs = 25_000,
  random = Math.random, timers = globalThis } = {}) {
  let stopped = false, running = null, timer = null, controller = null, failures = 0;
  const schedule = () => {
    if (stopped) return;
    const delay = Math.min(maxIntervalMs, intervalMs * 2 ** Math.min(failures, 5));
    timer = timers.setTimeout(refresh, delay + Math.floor(random() * intervalMs * 0.1));
  };
  function refresh() {
    if (stopped) return Promise.resolve(null);
    if (running) return running;
    timers.clearTimeout(timer);
    if (!canRun()) { schedule(); return Promise.resolve(null); }
    controller = new AbortController();
    let deadlineTimer;
    const deadline = new Promise((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("Pembaruan data dibatalkan atau timeout")), { once: true });
      deadlineTimer = timers.setTimeout(() => controller.abort(), timeoutMs);
    });
    running = Promise.race([Promise.resolve().then(() => load(controller.signal)), deadline]).then(result => {
      if (result?.error) throw result.error;
      if (!stopped) { failures = 0; onResult?.(result); }
      return result;
    }).catch(error => {
      if (!stopped) { failures++; onError?.(error); }
      return null;
    }).finally(() => {
      timers.clearTimeout(deadlineTimer);
      running = null; controller = null;
      schedule();
    });
    return running;
  }
  schedule();
  return { refresh, stop() { stopped = true; timers.clearTimeout(timer); controller?.abort(); } };
}
