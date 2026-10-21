// The inbox is read-only. Receiving media/AI/retries never depend on a browser tab.
import { isPaymentInboxSuggestion } from "./paymentMediaPolicy.js";
export async function fetchPendingPaymentSuggestions(supabase, { signal } = {}) {
  const rows = [];
  for (let from = 0; ; from += 200) {
    const query = supabase.from("payment_suggestions")
      .select("*, ai_extractions:ai_extraction_id(*)").eq("status", "PENDING")
      .order("created_at", { ascending: false }).order("id").range(from, from + 199);
    const { data, error } = await (signal && typeof query.abortSignal === "function" ? query.abortSignal(signal) : query);
    if (error) throw error;
    rows.push(...(data || []).filter(isPaymentInboxSuggestion));
    if ((data || []).length < 200) return rows;
  }
}

export function startPaymentInboxPolling({ load, onData, onNew, onState,
  doc = document, win = window, intervalMs = 300_000, now = Date.now }) {
  let stopped = false, running = null, initialized = false, lastAttempt = -Infinity;
  let failures = 0, requestController = null, timeout = null;
  const seen = new Set();
  const refresh = ({ force = false } = {}) => {
    if (stopped || (!force && doc.hidden)) return Promise.resolve(null);
    if (running) return running;
    if (!force && now() - lastAttempt < 15_000) return Promise.resolve(null);
    lastAttempt = now();
    onState?.({ loading: true });
    requestController = new AbortController();
    const timedOut = new Promise((_, reject) => { timeout = win.setTimeout(() => {
      requestController?.abort(); reject(new Error("Pembaruan bukti WA timeout; coba Perbarui kembali"));
    }, 30_000); });
    running = Promise.race([Promise.resolve().then(() => load({ signal: requestController.signal })), timedOut]).then(rows => {
      if (stopped) return null;
      const fresh = initialized ? rows.filter(row => !seen.has(row.id)) : [];
      for (const row of rows) seen.add(row.id);
      initialized = true;
      failures = 0;
      onData(rows); // Empty results must also clear resolved entries.
      onState?.({ loading: false, error: null, failures, updatedAt: now() });
      if (fresh.length) onNew?.(fresh);
      return rows;
    }).catch(error => {
      if (!stopped) onState?.({ loading: false, error: error.message || "Gagal membaca bukti WA", failures: ++failures });
      return null; // Keep the last good snapshot, never claim that an error means zero pending.
    }).finally(() => { win.clearTimeout(timeout); timeout = null; requestController = null; running = null; });
    return running;
  };
  const resume = () => refresh();
  const timer = win.setInterval(resume, intervalMs);
  doc.addEventListener("visibilitychange", resume);
  win.addEventListener("focus", resume);
  win.addEventListener("online", resume);
  refresh();
  return { refresh, stop() {
    stopped = true;
    requestController?.abort();
    win.clearTimeout(timeout);
    win.clearInterval(timer);
    doc.removeEventListener("visibilitychange", resume);
    win.removeEventListener("focus", resume);
    win.removeEventListener("online", resume);
  } };
}
