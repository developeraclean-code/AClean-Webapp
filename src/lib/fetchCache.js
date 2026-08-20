// Cache fetch sederhana ber-TTL (singleton module-level). Diekstrak dari App.jsx
// (de-monolith bertahap, 20 Agu 2026). App.jsx meng-inject cachedFetch/
// invalidateCache ke helper data-layer (loadAllData, createOrder, dll) — perilaku
// identik: _fetchCache tetap satu instance module-level di sini.
const CACHE_TTL = 60_000; // 1 menit
const _fetchCache = { store: {} };

// Kembalikan hasil cache bila masih segar (<TTL), kalau tidak jalankan fetcher
// lalu simpan. `fetcher` = fungsi yang mengembalikan Promise.
export function cachedFetch(key, fetcher) {
  const hit = _fetchCache.store[key];
  if (hit && Date.now() - hit.ts < CACHE_TTL) return Promise.resolve(hit.value);
  return fetcher().then(result => {
    _fetchCache.store[key] = { value: result, ts: Date.now() };
    return result;
  });
}

// Kosongkan cache: tanpa argumen = semua; dengan key = hanya key tsb.
export function invalidateCache(...keys) {
  if (keys.length === 0) { _fetchCache.store = {}; return; }
  keys.forEach(k => delete _fetchCache.store[k]);
}
