// Visible Workspace only. Intentionally independent of office hours and the
// legacy background WA Monitor toggle; no messages are marked read here.
export function startWaConversationPolling({ load, onData, onState, intervalMs = 60_000,
  visibility = globalThis.document, events = globalThis.window, timers = globalThis } = {}) {
  let stopped = false, inFlight = null;
  const refresh = ({ force = false } = {}) => {
    if (stopped || (!force && visibility?.hidden)) return Promise.resolve({ skipped: true });
    if (inFlight) return inFlight;
    onState?.({ loading: true });
    inFlight = (async () => {
      try {
        const rows = await Promise.resolve().then(load);
        if (!Array.isArray(rows)) throw new Error("Daftar percakapan tidak valid");
        if (!stopped) { onData(rows); onState?.({ error: "", updatedAt: new Date().toISOString() }); }
        return { ok: true };
      } catch (error) {
        if (!stopped) onState?.({ error: error.message || "Percakapan belum dapat diperbarui" });
        return { ok: false, error: error.message };
      } finally { inFlight = null; if (!stopped) onState?.({ loading: false }); }
    })();
    return inFlight;
  };
  const resume = () => { refresh(); };
  const timer = timers.setInterval(resume, intervalMs);
  visibility?.addEventListener("visibilitychange", resume);
  events?.addEventListener("focus", resume); events?.addEventListener("online", resume);
  refresh();
  return { refresh, stop() { stopped = true; timers.clearInterval(timer); visibility?.removeEventListener("visibilitychange", resume); events?.removeEventListener("focus", resume); events?.removeEventListener("online", resume); } };
}
