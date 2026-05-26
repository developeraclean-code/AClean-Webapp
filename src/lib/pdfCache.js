// In-memory LRU cache untuk PDF blob.
// Hidup selama session browser; bersihan otomatis saat max size tercapai.
// Hilang saat refresh — acceptable karena layer R2 menangani persistence.

const MAX_ITEMS = 10;
const cache = new Map();

function makeKey(type, id, version) {
  return `${type}:${id}:${version || "v1"}`;
}

export function getCachedPDF(type, id, version) {
  const key = makeKey(type, id, version);
  if (!cache.has(key)) return null;
  // LRU: pindah ke posisi terakhir (most recently used)
  const blob = cache.get(key);
  cache.delete(key);
  cache.set(key, blob);
  return blob;
}

export function setCachedPDF(type, id, version, blob) {
  if (!blob) return;
  const key = makeKey(type, id, version);
  // Evict oldest jika sudah penuh
  if (cache.size >= MAX_ITEMS && !cache.has(key)) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, blob);
}

export function invalidateCachedPDF(type, id) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${type}:${id}:`)) cache.delete(key);
  }
}

export function clearPDFCache() {
  cache.clear();
}
