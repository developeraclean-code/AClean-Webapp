// Antrean offline khusus aktivitas lapangan (status order + foto laporan).
// Payload foto disimpan di IndexedDB, bukan localStorage, karena ukurannya dapat besar.

const DB_NAME = "aclean-field-queue";
const DB_VERSION = 1;
const STORE = "actions";

let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB tidak tersedia"));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function put(item) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listFieldActions() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function removeFieldAction(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function patchFieldAction(id, patch) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function fieldQueueBackoffMs(attempts) {
  if (!attempts || attempts <= 0) return 0;
  return [10_000, 30_000, 90_000, 5 * 60_000, 15 * 60_000][attempts - 1] || 30 * 60_000;
}

export function isRetryableUploadStatus(status) {
  return !status || status === 408 || status === 429 || status >= 500;
}

export async function enqueueFieldStatus({ orderId, status, extra = {}, actorName }) {
  if (!orderId || !status) throw new Error("Order/status antrean tidak lengkap");
  // Satu status per order disimpan satu kali. Tahapan berbeda (Berangkat → Tiba)
  // tetap dipertahankan agar timestamp dan audit perjalanan tidak hilang.
  return put({
    id: `status:${orderId}:${status}`, type: "status", orderId, status, extra, actorName,
    createdAt: Date.now(), attempts: 0, lastAttempt: null, error: "",
  });
}

export async function enqueueFieldPhoto({ jobId, id, hash, dataUrl, label, unitNo, role }) {
  if (!jobId || !hash || !dataUrl) throw new Error("Foto antrean tidak lengkap");
  return put({
    id: `photo:${jobId}:${hash}`, type: "photo", jobId, photoId: id, hash, dataUrl,
    label: label || "Foto", unitNo: unitNo || null, role: role || "Unknown",
    createdAt: Date.now(), attempts: 0, lastAttempt: null, error: "",
  });
}

export async function listQueuedFieldPhotos(jobId) {
  const rows = await listFieldActions();
  return rows.filter(row => row.type === "photo" && row.jobId === jobId);
}

export function queuedPhotoActionId(jobId, hash) {
  return `photo:${jobId}:${hash}`;
}

export async function clearQueuedFieldPhotos(jobId) {
  const rows = await listQueuedFieldPhotos(jobId);
  await Promise.all(rows.map(row => removeFieldAction(row.id)));
}

// Callback sengaja diinjeksi agar modul queue tidak bergantung pada Supabase/API global.
export async function flushFieldQueue({ syncStatus, syncPhoto, onStatusSynced, onPhotoSynced } = {}) {
  const rows = await listFieldActions();
  const now = Date.now();
  let synced = 0;
  for (const row of rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
    if (row.lastAttempt && now - row.lastAttempt < fieldQueueBackoffMs(row.attempts || 0)) continue;
    try {
      const result = row.type === "status" ? await syncStatus?.(row) : await syncPhoto?.(row);
      if (!result?.success) throw new Error(result?.error || "Sinkronisasi gagal");
      await removeFieldAction(row.id);
      synced += 1;
      if (row.type === "status") onStatusSynced?.(row, result);
      else onPhotoSynced?.(row, result);
    } catch (error) {
      await patchFieldAction(row.id, {
        attempts: Number(row.attempts || 0) + 1,
        lastAttempt: now,
        error: String(error?.message || error),
      });
    }
  }
  return { synced, remaining: (await listFieldActions()).length };
}
