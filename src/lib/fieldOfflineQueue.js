// Antrean offline khusus aktivitas lapangan (status order + foto laporan).
// Payload foto disimpan di IndexedDB, bukan localStorage, karena ukurannya dapat besar.

const DB_NAME = "aclean-field-queue";
const DB_VERSION = 2;
const STORE = "actions";
const JOB_STORE = "job_packages";
const META_STORE = "meta";
const JOB_CACHE_TTL_MS = 36 * 60 * 60 * 1000;

let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB tidak tersedia"));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(JOB_STORE)) db.createObjectStore(JOB_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" });
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

export function fieldUserKey(user) {
  return String(user?.id || user?.email || user?.name || "").trim().toLowerCase();
}

export function fieldActionBelongsToUser(row, userKey) {
  if (!userKey) return false;
  return row?.userKey === userKey;
}

export async function listFieldActionsForUser(userKey) {
  const rows = await listFieldActions();
  return rows.filter(row => fieldActionBelongsToUser(row, userKey));
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

export const markFieldAction = patchFieldAction;

export function fieldQueueBackoffMs(attempts) {
  if (!attempts || attempts <= 0) return 0;
  return [10_000, 30_000, 90_000, 5 * 60_000, 15 * 60_000][attempts - 1] || 30 * 60_000;
}

export function isRetryableUploadStatus(status) {
  return !status || status === 408 || status === 429 || status >= 500;
}

export async function enqueueFieldStatus({ orderId, status, extra = {}, actorName, userKey, expectedUpdatedAt = null, orderSnapshot = null }) {
  if (!orderId || !status) throw new Error("Order/status antrean tidak lengkap");
  if (!userKey) throw new Error("Identitas pengguna antrean tidak tersedia");
  // Satu status per order disimpan satu kali. Tahapan berbeda (Berangkat → Tiba)
  // tetap dipertahankan agar timestamp dan audit perjalanan tidak hilang.
  return put({
    id: `status:${userKey}:${orderId}:${status}`, type: "status", orderId, status, extra, actorName,
    userKey, expectedUpdatedAt, orderSnapshot,
    createdAt: Date.now(), attempts: 0, lastAttempt: null, error: "",
  });
}

export async function enqueueFieldPhoto({ jobId, id, hash, dataUrl, label, unitNo, role, userKey }) {
  if (!jobId || !hash || !dataUrl) throw new Error("Foto antrean tidak lengkap");
  if (!userKey) throw new Error("Identitas pengguna antrean tidak tersedia");
  const health = await getFieldStorageHealth(Math.ceil(dataUrl.length * 0.75));
  if (!health.canStore) {
    const error = new Error("Penyimpanan perangkat hampir penuh. Sambungkan internet atau kosongkan ruang sebelum menambah foto.");
    error.code = "FIELD_STORAGE_FULL";
    throw error;
  }
  return put({
    id: `photo:${userKey}:${jobId}:${hash}`, type: "photo", jobId, photoId: id, hash, dataUrl,
    label: label || "Foto", unitNo: unitNo || null, role: role || "Unknown",
    userKey, createdAt: Date.now(), attempts: 0, lastAttempt: null, error: "", state: "queued",
  });
}

export async function enqueueFieldReportSubmit({ jobId, userKey, actorName, orderSnapshot }) {
  if (!jobId || !userKey) throw new Error("Identitas laporan offline tidak lengkap");
  return put({
    id: `report:${userKey}:${jobId}`, type: "report", jobId, userKey, actorName,
    orderSnapshot: orderSnapshot || {}, createdAt: Date.now(), attempts: 0,
    lastAttempt: null, error: "", state: "queued",
  });
}

export async function listQueuedFieldPhotos(jobId, userKey) {
  const rows = userKey ? await listFieldActionsForUser(userKey) : await listFieldActions();
  return rows.filter(row => row.type === "photo" && row.jobId === jobId);
}

export function queuedPhotoActionId(jobId, hash, userKey = "") {
  return userKey ? `photo:${userKey}:${jobId}:${hash}` : `photo:${jobId}:${hash}`;
}

export function queuedReportActionId(jobId, userKey) {
  return `report:${userKey}:${jobId}`;
}

export async function clearQueuedFieldPhotos(jobId, userKey) {
  const rows = await listQueuedFieldPhotos(jobId, userKey);
  await Promise.all(rows.map(row => removeFieldAction(row.id)));
}

export async function clearQueuedFieldReport(jobId, userKey) {
  if (!jobId || !userKey) return;
  await removeFieldAction(queuedReportActionId(jobId, userKey));
}

function storePut(storeName, item) {
  return getDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(item);
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error);
  }));
}

function storeGet(storeName, id) {
  return getDB().then(db => new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  }));
}

function storeDelete(storeName, id) {
  return getDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

export async function cacheFieldJobPackage(userKey, jobs, reminders = []) {
  if (!userKey) return null;
  const compactJobs = (jobs || []).map(job => ({
    id: job.id, customer: job.customer, customer_id: job.customer_id, phone: job.phone,
    address: job.address, area: job.area, service: job.service, type: job.type,
    units: job.units, teknisi: job.teknisi, helper: job.helper, teknisi2: job.teknisi2,
    helper2: job.helper2, teknisi3: job.teknisi3, helper3: job.helper3,
    date: job.date, time: job.time, time_end: job.time_end, status: job.status,
    notes: job.notes, updated_at: job.updated_at, maintenance_client_id: job.maintenance_client_id,
    maintenance_unit_ids: job.maintenance_unit_ids,
  }));
  await storePut(JOB_STORE, { id: userKey, userKey, jobs: compactJobs, reminders, cachedAt: Date.now() });
  await storePut(META_STORE, { id: "active_user", userKey, updatedAt: Date.now() });
  return compactJobs;
}

export async function loadFieldJobPackage(userKey) {
  if (!userKey) return null;
  const row = await storeGet(JOB_STORE, userKey);
  if (!row) return null;
  if (Date.now() - Number(row.cachedAt || 0) > JOB_CACHE_TTL_MS) {
    await storeDelete(JOB_STORE, userKey);
    return null;
  }
  return row;
}

export async function clearActiveFieldUser(userKey) {
  const active = await storeGet(META_STORE, "active_user");
  if (active?.userKey === userKey) await storePut(META_STORE, { id: "active_user", userKey: "", updatedAt: Date.now() });
}

export async function getFieldStorageHealth(requiredBytes = 0, navigatorLike = globalThis.navigator) {
  try {
    const estimate = await navigatorLike?.storage?.estimate?.();
    const quota = Number(estimate?.quota || 0);
    const usage = Number(estimate?.usage || 0);
    if (!quota) return { supported: false, canStore: true, usage: null, quota: null, percent: null };
    const projected = usage + Math.max(0, Number(requiredBytes || 0));
    return {
      supported: true, usage, quota, percent: Math.round((usage / quota) * 100),
      canStore: projected / quota < 0.9 && quota - projected > 5 * 1024 * 1024,
    };
  } catch {
    return { supported: false, canStore: true, usage: null, quota: null, percent: null };
  }
}

// Callback sengaja diinjeksi agar modul queue tidak bergantung pada Supabase/API global.
export async function flushFieldQueue({ userKey, syncStatus, syncPhoto, onStatusSynced, onPhotoSynced, onConflict } = {}) {
  const rows = userKey ? await listFieldActionsForUser(userKey) : await listFieldActions();
  const now = Date.now();
  let synced = 0;
  for (const row of rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
    if (row.type === "report" || row.state === "conflict") continue;
    if (row.lastAttempt && now - row.lastAttempt < fieldQueueBackoffMs(row.attempts || 0)) continue;
    try {
      const result = row.type === "status" ? await syncStatus?.(row) : await syncPhoto?.(row);
      if (!result?.success) {
        if (result?.conflict) {
          await patchFieldAction(row.id, { state: "conflict", error: result.error || "Data job berubah", lastAttempt: now });
          onConflict?.(row, result);
          continue;
        }
        throw new Error(result?.error || "Sinkronisasi gagal");
      }
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
  const remainingRows = userKey ? await listFieldActionsForUser(userKey) : await listFieldActions();
  return { synced, remaining: remainingRows.length, rows: remainingRows };
}
