// Cache fetch sederhana ber-TTL (singleton module-level). Diekstrak dari App.jsx
// (de-monolith bertahap, 20 Agu 2026). App.jsx meng-inject cachedFetch/
// invalidateCache ke helper data-layer (loadAllData, createOrder, dll) — perilaku
// identik: _fetchCache tetap satu instance module-level di sini.
const CACHE_TTL = 60_000; // 1 menit
const _fetchCache = { store: {} };
const pending = new Map();
let scope = null;

// Scope is an identity, never a role or an access-control substitute.
export function setFetchCacheScope(identity) {
  if (scope === identity) return;
  scope = identity;
  invalidateCache();
}

// Kembalikan hasil cache bila masih segar (<TTL), kalau tidak jalankan fetcher
// lalu simpan. `fetcher` = fungsi yang mengembalikan Promise.
export function cachedFetch(key, fetcher) {
  const hit = _fetchCache.store[key];
  if (hit && Date.now() - hit.ts < CACHE_TTL) return Promise.resolve(hit.value);
  if (pending.has(key)) return pending.get(key);
  const request = Promise.resolve().then(fetcher).then(result => {
    // Invalidation/logout detaches in-flight requests too. Their late completion
    // must not repopulate the next user's cache or undo a mutation's invalidation.
    if (pending.get(key) === request && !result?.error) {
      _fetchCache.store[key] = { value: result, ts: Date.now() };
    }
    return result;
  }).finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}

// Kosongkan cache: tanpa argumen = semua; dengan key = hanya key tsb.
export function invalidateCache(...keys) {
  if (keys.length === 0) { _fetchCache.store = {}; pending.clear(); return; }
  // A mutation of an entity invalidates its recent/bootstrap projection too.
  const families = { orders: ["orders", "orders_bootstrap"], invoices: ["invoices", "invoices_bootstrap"], service_reports: ["service_reports", "service_reports_bootstrap"] };
  keys.flatMap(key => families[key] || [key]).forEach(k => { delete _fetchCache.store[k]; pending.delete(k); });
}
