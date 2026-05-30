// IndexedDB-based queue untuk BAP submissions saat offline.
// Tiap item: { id, report, ttdDataUrl, createdAt, attempts, lastAttempt, error }
// Worker upload TTD ke R2 + insert report ke Supabase saat online.

const DB_NAME = "aclean-bap-queue";
const DB_VERSION = 1;
const STORE = "pending";

let _dbPromise = null;
function getDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB tidak tersedia"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function withStore(mode, fn) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function enqueueBAP(item) {
  await withStore("readwrite", (s) => s.put(item));
}
export async function listPendingBAP() {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await getDB();
      const t = db.transaction(STORE, "readonly");
      const req = t.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}
export async function removeBAP(id) {
  await withStore("readwrite", (s) => s.delete(id));
}
export async function updateBAP(id, patch) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const store = t.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const cur = getReq.result;
      if (!cur) return resolve();
      const next = { ...cur, ...patch };
      const putReq = store.put(next);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

// Backoff per attempt: 0s, 10s, 30s, 90s, 5min, 15min, then 30min cap
export function bapBackoffMs(attempts) {
  if (!attempts || attempts <= 0) return 0;
  if (attempts === 1) return 10_000;
  if (attempts === 2) return 30_000;
  if (attempts === 3) return 90_000;
  if (attempts === 4) return 5 * 60_000;
  if (attempts === 5) return 15 * 60_000;
  return 30 * 60_000;
}

// Regenerate BAP number — dipanggil kalau insert kena UNIQUE conflict
async function regenerateBapNumber(supabase, todayStr) {
  const prefix = `BAP-${todayStr.replace(/-/g, "")}-`;
  const { data } = await supabase
    .from("service_reports")
    .select("bap_number")
    .like("bap_number", `${prefix}%`)
    .order("bap_number", { ascending: false })
    .limit(1);
  const last = data && data[0]?.bap_number;
  const n = last ? parseInt(last.slice(prefix.length).replace(/[^\d]/g, ""), 10) : 0;
  return prefix + String((n || 0) + 1).padStart(3, "0");
}

// Sync 1 item: upload TTD (kalau ada) → insert ke service_reports
async function syncOneItem(item, { supabase, apiHeaders }) {
  let ttdKey = null;
  if (item.ttdDataUrl) {
    const base64 = item.ttdDataUrl.split(",")[1];
    const filename = `${item.report.bap_number || "BAP-pending"}_customer_${Date.now()}.png`;
    const res = await fetch("/api/upload-foto", {
      method: "POST",
      headers: await apiHeaders(),
      body: JSON.stringify({
        base64, filename,
        folder: `signatures/${item.report.job_id}`,
        mimeType: "image/png",
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success || !d.key) throw new Error(d.error || "Upload TTD gagal");
    ttdKey = d.key;
  }

  // Insert report; kalau UNIQUE bap_number conflict, regenerate sekali
  let bapNum = item.report.bap_number;
  for (let attempt = 0; attempt < 2; attempt++) {
    const payload = { ...item.report, ttd_customer_url: ttdKey, bap_number: bapNum };
    const { error } = await supabase.from("service_reports").insert(payload);
    if (!error) return { ...payload };
    const msg = (error.message || "").toLowerCase();
    const isUniqueConflict = error.code === "23505" || msg.includes("duplicate") || msg.includes("unique");
    if (isUniqueConflict && attempt === 0) {
      bapNum = await regenerateBapNumber(supabase, item.report.date || new Date().toISOString().slice(0, 10));
      continue;
    }
    throw new Error(error.message || "Insert report gagal");
  }
  throw new Error("Tidak bisa simpan BAP setelah 2x percobaan");
}

// Flush antrian — coba sync semua item yang sudah lewat backoff. Return {synced, remaining, syncedReports[]}
export async function flushBAPQueue({ supabase, apiHeaders, onSynced }) {
  const items = await listPendingBAP();
  if (items.length === 0) return { synced: 0, remaining: 0, syncedReports: [] };
  const now = Date.now();
  let synced = 0;
  const syncedReports = [];
  for (const item of items) {
    const wait = bapBackoffMs(item.attempts || 0);
    if (item.lastAttempt && now - item.lastAttempt < wait) continue;
    try {
      const finalReport = await syncOneItem(item, { supabase, apiHeaders });
      await removeBAP(item.id);
      synced++;
      syncedReports.push(finalReport);
      onSynced?.(finalReport);
    } catch (e) {
      await updateBAP(item.id, {
        attempts: (item.attempts || 0) + 1,
        lastAttempt: now,
        error: String(e?.message || e),
      });
    }
  }
  const remaining = (await listPendingBAP()).length;
  return { synced, remaining, syncedReports };
}
