// Browser-only backpressure for REST reads and explicitly known read-only RPCs.
// Auth and mutations never queue, replay or automatically retry here.
const READ_ONLY_RPCS = new Set(['get_dashboard_snapshot','get_dashboard_snapshot_v2',
  'get_dashboard_monthly_work_summary','get_statistics_snapshot','get_finance_snapshot','get_service_reports_page']);
export function createSupabaseReadTransport({ baseUrl, fetchImpl = (...args) => globalThis.fetch(...args),
  concurrency = 3, maxQueued = 200, timeoutMs = 20_000, queueTimeoutMs = 20_000,
  failureThreshold = 3, cooldownMs = 15_000, maxCooldownMs = 120_000,
  now = Date.now, timers = globalThis } = {}) {
  const base = new URL(baseUrl);
  const queue = [], listeners = new Set();
  let active = 0, failures = 0, opens = 0, epoch = 0, probeActive = false;
  let snapshot = { state: "healthy", retryAt: 0 };
  const notify = (state, retryAt = 0) => {
    if (snapshot.state === state && snapshot.retryAt === retryAt) return;
    snapshot = { state, retryAt };
    for (const listener of listeners) { try { listener(snapshot); } catch { /* UI must not break I/O. */ } }
  };
  const unavailable = (code, message, status = 502) => new Response(JSON.stringify({ code, message,
    details: "Tidak ada perubahan data atau pengulangan aksi simpan.", hint: "Pembaruan data akan dicoba kembali secara bertahap." }),
  { status, headers: { "Content-Type": "application/json" } });
  const paused = () => unavailable("APP_READ_PAUSED", "Layanan data sedang bermasalah; pembacaan diberi jeda sementara.", 429);
  const abortError = () => new DOMException("Pembacaan dibatalkan", "AbortError");
  const cleanup = job => {
    timers.clearTimeout(job.queueTimer);
    job.signal?.removeEventListener("abort", job.cancel);
  };
  const drainPaused = () => {
    for (const job of queue.splice(0)) { cleanup(job); job.resolve(paused()); }
  };
  const fail = (startedEpoch, probe) => {
    // Ignore late responses from requests already running when the circuit opened.
    if (!probe && (startedEpoch !== epoch || snapshot.state !== "healthy")) return;
    failures++;
    if (probe || failures >= failureThreshold) {
      epoch++;
      const delay = Math.min(maxCooldownMs, cooldownMs * 2 ** Math.min(opens++, 8));
      notify("paused", now() + delay);
      drainPaused();
    }
  };
  const succeed = (startedEpoch, probe) => {
    if (!probe && (startedEpoch !== epoch || snapshot.state !== "healthy")) return;
    failures = 0;
    if (probe) { opens = 0; notify("healthy"); }
  };
  const run = async (job, probe) => {
    active++;
    cleanup(job);
    const startedEpoch = epoch, controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    job.signal?.addEventListener("abort", cancel, { once: true });
    const timer = timers.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      if (job.signal?.aborted) throw abortError();
      // A deadline also releases the gate if a custom fetch ignores AbortSignal.
      const deadline = new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(abortError()), { once: true }));
      const response = await Promise.race([(async () => {
        const headers = await fetchImpl(job.input, { ...job.init, signal: controller.signal });
        // Headers alone do not finish a request. Hold the slot and deadline
        // until JSON/body is downloaded too; a stalled body must not be healthy.
        const bytes = await headers.arrayBuffer();
        return new Response([204,205,304].includes(headers.status) ? null : bytes,
          { status: headers.status, statusText: headers.statusText, headers: headers.headers });
      })(), deadline]);
      if (response.status >= 500 || response.status === 429 || response.status === 408) fail(startedEpoch, probe);
      else if (response.ok) succeed(startedEpoch, probe);
      else if (probe) {
        notify("paused", now() + cooldownMs); // 401/403 is not proof of recovery.
        drainPaused();
      }
      job.resolve(response);
    } catch (error) {
      if (job.signal?.aborted) {
        // User/navigation cancellation is not a backend outage.
        if (probe) notify("paused", now());
        job.reject(abortError());
      } else {
        fail(startedEpoch, probe);
        // A local gateway failure is 502/504; a local circuit pause is 429.
        // Actual upstream statuses/codes stay unchanged. SDK retries of upstream
        // 503/520 still pass through this same gate and cannot bypass the pause.
        job.resolve(unavailable(timedOut ? "APP_READ_TIMEOUT" : "APP_READ_NETWORK",
          timedOut ? "Pembacaan data melewati batas waktu. Silakan coba kembali." : "Koneksi layanan data terputus. Silakan coba kembali.", timedOut ? 504 : 502));
      }
    } finally {
      timers.clearTimeout(timer);
      job.signal?.removeEventListener("abort", cancel);
      active--;
      if (probe) probeActive = false;
      drain();
    }
  };
  function drain() {
    while (queue.length && active < concurrency) {
      const recovering = snapshot.state !== "healthy";
      if (recovering && (now() < snapshot.retryAt || probeActive || active > 0)) return;
      if (!recovering && failures > 0 && active > 0) return;
      const job = queue.shift();
      if (job.signal?.aborted) { cleanup(job); job.reject(abortError()); continue; }
      if (recovering) { probeActive = true; notify("checking", snapshot.retryAt); }
      void run(job, recovering);
    }
  }
  const managed = (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, base);
    const method = (init?.method || input?.method || "GET").toUpperCase();
    if (url.origin !== base.origin || !url.pathname.startsWith('/rest/v1/')) return false;
    if (['GET','HEAD'].includes(method)) return true;
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/)?.[1];
    return method === 'POST' && READ_ONLY_RPCS.has(rpc);
  };
  const guardedFetch = (input, init = {}) => {
    if (!managed(input, init)) return fetchImpl(input, init);
    const signal = init.signal || input?.signal;
    if (signal?.aborted) return Promise.reject(abortError());
    if (snapshot.state === "paused" && now() < snapshot.retryAt) return Promise.resolve(paused());
    if (queue.length >= maxQueued) return Promise.resolve(unavailable("APP_READ_QUEUE_FULL", "Terlalu banyak pembacaan data. Tunggu pembaruan berikutnya.", 429));
    return new Promise((resolve, reject) => {
      const job = { input, init, signal, resolve, reject };
      job.cancel = () => {
        const index = queue.indexOf(job);
        if (index < 0) return;
        queue.splice(index, 1); cleanup(job); reject(abortError());
      };
      job.queueTimer = timers.setTimeout(() => {
        const index = queue.indexOf(job);
        if (index < 0) return;
        queue.splice(index, 1); cleanup(job);
        resolve(unavailable("APP_READ_QUEUE_TIMEOUT", "Antrean pembacaan data terlalu lama. Silakan coba kembali.", 504));
      }, queueTimeoutMs);
      signal?.addEventListener("abort", job.cancel, { once: true });
      queue.push(job); drain();
    });
  };
  return {
    fetch: guardedFetch,
    getSnapshot: () => snapshot,
    getStats: () => ({ active, queued: queue.length, failures, ...snapshot }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
