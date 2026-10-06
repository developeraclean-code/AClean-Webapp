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

// Cleanup may only resolve references belonging to this configured app/bucket.
export function ownedR2Prefixes(env = process.env) {
  const prefixes = ['/api/foto?key='];
  for (const app of [env.APP_URL, env.VITE_APP_URL, 'https://a-clean-webapp.vercel.app']) {
    try { if (app) prefixes.push(new URL(app).origin + '/api/foto?key='); } catch { /* invalid optional origin */ }
  }
  for (const base of [env.R2_PUBLIC_URL, env.R2_PUBLIC_BASE_URL, env.VITE_R2_CDN_URL]) {
    try { if (base && new URL(base).protocol === 'https:') prefixes.push(base.replace(/\/+$/, '') + '/'); } catch { /* invalid optional origin */ }
  }
  const account = env.R2_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
  if (account) prefixes.push(`https://${account}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME || 'aclean-files'}/`);
  return [...new Set(prefixes)];
}

export function extractOwnedR2Key(value, prefixes = ownedR2Prefixes()) {
  const raw = String(value || '').trim();
  if (!prefixes.some(prefix => raw.startsWith(prefix))) return null;
  return extractR2Key(raw);
}

export function backupFolder(value) {
  const folder = String(value || '').trim().replace(/^Backup bulanan ke R2:\s*/, '').replace(/^backup\//, '').replace(/\/$/, '');
  const match = folder.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match || +match[2] < 1 || +match[2] > 12) return null;
  if (match[3] && (+match[3] < 1 || +match[3] > new Date(Date.UTC(+match[1], +match[2], 0)).getUTCDate())) return null;
  return folder;
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
