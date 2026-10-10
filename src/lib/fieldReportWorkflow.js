const DRAFT_PREFIX = "aclean:field-report:draft:v1:";
const SESSION_PREFIX = "aclean:field-report:session:v1:";
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const scopedKey = (prefix, jobId, userKey = "") => `${prefix}${userKey ? `${userKey}:` : ""}${jobId}`;

const FIELD_MEMBER_KEYS = ["teknisi", "helper", "teknisi2", "helper2", "teknisi3", "helper3"];
const DISPLAY_MEMBER_KEYS = ["teknisi", "teknisi2", "teknisi3", "helper", "helper2", "helper3"];
const PRE_REPORT_STATUSES = new Set([
  "PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "WORKING", "IN_PROGRESS", "COMPLETED",
]);

export function isFieldOrderAssigned(order, employeeName) {
  const name = String(employeeName || "").trim().toLowerCase();
  if (!name) return false;
  return FIELD_MEMBER_KEYS.some(key => String(order?.[key] || "").trim().toLowerCase() === name) ||
    (Array.isArray(order?.assigned_members) && order.assigned_members.some(member => String(member || "").trim().toLowerCase() === name));
}

// Laporan hanya menyimpan teknisi/helper utama; keanggotaan lengkap berada di order.
// Fallback ke laporan menjaga riwayat lama yang order-nya sudah tidak dimuat.
export function isFieldReportAssigned(report, order, employeeName) {
  const name = String(employeeName || "").trim().toLowerCase();
  if (!name) return false;
  return fieldReportAssignedNames(report, order).some(member => member.toLowerCase() === name);
}

// Satu job memiliki satu laporan. Sampai diverifikasi, hanya akun pengirim
// pertama yang boleh memperbaikinya; nama teknisi utama bukan bukti pengirim.
export function canOriginalReporterEdit(report, user) {
  return Boolean(report?.submitted_by_user_id && user?.id &&
    report.submitted_by_user_id === user.id &&
    ["SUBMITTED", "REVISION"].includes(report.status));
}

export function fieldReportAssignedNames(report, order) {
  const names = [
    ...DISPLAY_MEMBER_KEYS.map(key => order?.[key]),
    ...(Array.isArray(order?.assigned_members) ? order.assigned_members : []),
    ...(Array.isArray(report?.assigned_members) ? report.assigned_members : []),
    report?.teknisi, report?.helper,
  ];
  const seen = new Set();
  return names.map(value => String(value || "").trim()).filter(name => {
    const key = name.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const storage = (kind = "local") => {
  if (typeof window === "undefined") return null;
  try { return kind === "session" ? window.sessionStorage : window.localStorage; }
  catch { return null; }
};

const readJson = (store, key) => {
  try { return JSON.parse(store?.getItem(key) || "null"); }
  catch { return null; }
};

export function loadFieldReportDraft(jobId, userKey = "") {
  if (!jobId) return null;
  const store = storage();
  const key = scopedKey(DRAFT_PREFIX, jobId, userKey);
  const value = readJson(store, key);
  if (!value?.savedAt || Date.now() - value.savedAt > DRAFT_TTL_MS) {
    try { store?.removeItem(key); } catch { /* storage unavailable */ }
    return null;
  }
  return value;
}

export function hasFieldReportDraft(jobId, userKey = "") {
  return Boolean(loadFieldReportDraft(jobId, userKey));
}

export function saveFieldReportDraft(jobId, data, userKey = "") {
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
    store.setItem(scopedKey(DRAFT_PREFIX, jobId, userKey), JSON.stringify({ ...data, photos, savedAt: Date.now() }));
    return true;
  } catch { return false; }
}

export function mergeFieldReportDraftPhoto(jobId, photo, userKey = "") {
  if (!jobId || !photo?.url) return false;
  const current = loadFieldReportDraft(jobId, userKey) || {};
  const photos = [...(current.photos || []).filter(item => item.hash !== photo.hash), photo];
  return saveFieldReportDraft(jobId, { ...current, photos }, userKey);
}

export function clearFieldReportDraft(jobId, userKey = "") {
  try { storage()?.removeItem(scopedKey(DRAFT_PREFIX, jobId, userKey)); } catch { /* storage unavailable */ }
}

export function beginFieldReportSession(jobId, { recovered = false, userKey = "" } = {}) {
  if (!jobId) return null;
  const store = storage("session");
  const key = scopedKey(SESSION_PREFIX, jobId, userKey);
  const existing = readJson(store, key);
  const value = existing || { startedAt: new Date().toISOString(), uploadFailures: 0, recovered: false };
  value.recovered = Boolean(value.recovered || recovered);
  try { store?.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  return value;
}

export function recordFieldPhotoUploadFailure(jobId, count = 1, userKey = "") {
  if (!jobId || count < 1) return;
  const value = beginFieldReportSession(jobId, { userKey }) || {};
  value.uploadFailures = Number(value.uploadFailures || 0) + count;
  try { storage("session")?.setItem(scopedKey(SESSION_PREFIX, jobId, userKey), JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function finishFieldReportSession(order, { clear = true, userKey = "" } = {}) {
  const jobId = order?.id;
  const store = storage("session");
  const sessionKey = scopedKey(SESSION_PREFIX, jobId, userKey);
  const value = readJson(store, sessionKey) || beginFieldReportSession(jobId, { userKey }) || {};
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
    try { store?.removeItem(sessionKey); } catch { /* storage unavailable */ }
    clearFieldReportDraft(jobId, userKey);
  }
  return metrics;
}

export async function uploadWithRetry(upload, {
  attempts = 3, delays = [500, 1400], shouldRetry = () => true,
} = {}) {
  let lastError;
  let lastResult;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await upload(attempt);
      lastResult = result;
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
  return { success: false, error: lastError?.message || "Upload gagal", attempts, status: lastResult?.status };
}

export function findDelayedFieldReports(orders, reports, employeeName, today) {
  const reported = new Set((reports || [])
    .filter(r => r?.status !== "REJECTED" && r?.status !== "PENDING")
    .flatMap(r => [r.job_id, r.order_id].filter(Boolean)));
  return (orders || []).filter(order => {
    const assigned = isFieldOrderAssigned(order, employeeName);
    const due = order.date < today || ["COMPLETED", "REPORT_SUBMITTED"].includes(order.status);
    // Status invoice/paid menandakan workflow laporan sudah lewat. Jangan menuduh
    // laporan tertunda hanya karena dataset laporan di bootstrap sedang dipaginasi.
    return assigned && due && PRE_REPORT_STATUSES.has(order.status) && !reported.has(order.id);
  }).sort((a, b) => `${a.date} ${a.time || ""}`.localeCompare(`${b.date} ${b.time || ""}`));
}
