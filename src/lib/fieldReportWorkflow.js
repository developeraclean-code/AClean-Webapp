const DRAFT_PREFIX = "aclean:field-report:draft:v1:";
const SESSION_PREFIX = "aclean:field-report:session:v1:";
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const storage = (kind = "local") => {
  if (typeof window === "undefined") return null;
  try { return kind === "session" ? window.sessionStorage : window.localStorage; }
  catch { return null; }
};

const readJson = (store, key) => {
  try { return JSON.parse(store?.getItem(key) || "null"); }
  catch { return null; }
};

export function loadFieldReportDraft(jobId) {
  if (!jobId) return null;
  const store = storage();
  const value = readJson(store, DRAFT_PREFIX + jobId);
  if (!value?.savedAt || Date.now() - value.savedAt > DRAFT_TTL_MS) {
    try { store?.removeItem(DRAFT_PREFIX + jobId); } catch { /* storage unavailable */ }
    return null;
  }
  return value;
}

export function hasFieldReportDraft(jobId) {
  return Boolean(loadFieldReportDraft(jobId));
}

export function saveFieldReportDraft(jobId, data) {
  if (!jobId) return false;
  const store = storage();
  if (!store) return false;
  // Base64 foto sengaja tidak masuk localStorage: satu foto dapat melampaui kuota
  // browser. URL R2 yang sudah berhasil tetap dipulihkan.
  const photos = (data.photos || []).filter(photo => photo?.url).map(photo => ({
    id: photo.id, label: photo.label || "", url: photo.url,
    data_url: photo.url, hash: photo.hash || "", unit_no: photo.unit_no || null,
    restored: true, uploading: false, errMsg: "",
  }));
  try {
    store.setItem(DRAFT_PREFIX + jobId, JSON.stringify({ ...data, photos, savedAt: Date.now() }));
    return true;
  } catch { return false; }
}

export function clearFieldReportDraft(jobId) {
  try { storage()?.removeItem(DRAFT_PREFIX + jobId); } catch { /* storage unavailable */ }
}

export function beginFieldReportSession(jobId, { recovered = false } = {}) {
  if (!jobId) return null;
  const store = storage("session");
  const key = SESSION_PREFIX + jobId;
  const existing = readJson(store, key);
  const value = existing || { startedAt: new Date().toISOString(), uploadFailures: 0, recovered: false };
  value.recovered = Boolean(value.recovered || recovered);
  try { store?.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  return value;
}

export function recordFieldPhotoUploadFailure(jobId, count = 1) {
  if (!jobId || count < 1) return;
  const value = beginFieldReportSession(jobId) || {};
  value.uploadFailures = Number(value.uploadFailures || 0) + count;
  try { storage("session")?.setItem(SESSION_PREFIX + jobId, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function finishFieldReportSession(order, { clear = true } = {}) {
  const jobId = order?.id;
  const store = storage("session");
  const value = readJson(store, SESSION_PREFIX + jobId) || beginFieldReportSession(jobId) || {};
  const started = Date.parse(value.startedAt || "");
  const planned = Date.parse(`${order?.date || ""}T${order?.time || "00:00"}:00`);
  const now = Date.now();
  const metrics = {
    job_id: jobId,
    duration_seconds: Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 1000)) : null,
    upload_failures: Number(value.uploadFailures || 0),
    draft_recovered: Boolean(value.recovered),
    report_delay_minutes: Number.isFinite(planned) ? Math.max(0, Math.round((now - planned) / 60000)) : null,
  };
  if (clear) {
    try { store?.removeItem(SESSION_PREFIX + jobId); } catch { /* storage unavailable */ }
    clearFieldReportDraft(jobId);
  }
  return metrics;
}

export async function uploadWithRetry(upload, {
  attempts = 3, delays = [500, 1400], shouldRetry = () => true,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await upload(attempt);
      if (result?.success) return { ...result, attempts: attempt };
      lastError = new Error(result?.error || "Upload gagal");
      if (!shouldRetry(result, lastError) || attempt === attempts) break;
    } catch (error) {
      lastError = error;
      if (!shouldRetry(null, error) || attempt === attempts) break;
    }
    const delay = delays[Math.min(attempt - 1, delays.length - 1)] || 0;
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  }
  return { success: false, error: lastError?.message || "Upload gagal", attempts };
}

export function findDelayedFieldReports(orders, reports, employeeName, today) {
  const name = (employeeName || "").toLowerCase();
  const reported = new Set((reports || []).filter(r => r?.status !== "REJECTED").map(r => r.job_id));
  return (orders || []).filter(order => {
    const assigned = [order.teknisi, order.helper, order.teknisi2, order.helper2, order.teknisi3, order.helper3]
      .some(person => (person || "").toLowerCase() === name);
    const due = order.date < today || ["COMPLETED", "REPORT_SUBMITTED"].includes(order.status);
    return assigned && due && !["CANCELLED", "INVOICE_APPROVED"].includes(order.status) && !reported.has(order.id);
  }).sort((a, b) => `${a.date} ${a.time || ""}`.localeCompare(`${b.date} ${b.time || ""}`));
}
