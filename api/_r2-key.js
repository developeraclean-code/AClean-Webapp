// Normalisasi semua bentuk referensi objek R2 yang pernah disimpan AClean.
// Bentuk yang didukung:
// - /api/foto?key=laporan%2FJOB-1%2Fa.jpg
// - https://app.example/api/foto?key=...
// - https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
// - https://pub-xxx.r2.dev/<key>
// - key polos: laporan/JOB-1/a.jpg

export function extractR2Key(value, bucket = "aclean-files") {
  const raw = String(value || "").trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw, "https://aclean.invalid");
    const queryKey = parsed.searchParams.get("key");
    if (queryKey) return normalizeKey(queryKey);

    if (/^https?:\/\//i.test(raw)) {
      const parts = parsed.pathname.split("/").filter(Boolean).map(safeDecode);
      if (parts[0] === bucket) parts.shift();
      return normalizeKey(parts.join("/"));
    }
  } catch (_) {
    // Lanjutkan sebagai key polos.
  }

  return normalizeKey(raw);
}

export function encodeR2CanonicalPath(bucket, key) {
  const parts = [bucket, ...String(key || "").split("/")]
    .filter(Boolean)
    .map(part => encodeURIComponent(safeDecode(part)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`));
  return "/" + parts.join("/");
}

function normalizeKey(value) {
  const key = safeDecode(String(value || ""))
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
  if (!key || key.includes("\0") || key.split("/").includes("..")) return null;
  return key;
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let cursor = 0;
  const count = Math.max(1, Math.min(Number(concurrency) || 1, list.length || 1));
  await Promise.all(Array.from({ length: count }, async () => {
    while (cursor < list.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await worker(list[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }));
  return results;
}
