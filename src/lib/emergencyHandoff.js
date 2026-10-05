// Pertukaran file saat Supabase mati. Paket tugas adalah bearer credential:
// siapa pun yang memegang file dapat membuat laporan untuk order tersebut.
const ASSIGNMENT_FORMAT = "aclean-emergency-assignment-v1";
const REPORT_FORMAT = "aclean-emergency-report-v1";
const MAX_PHOTOS = 8;
const MAX_PACKAGE_BYTES = 12 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const clean = value => String(value ?? "").trim();
const randomHex = length => Array.from(crypto.getRandomValues(new Uint8Array(length)), byte => byte.toString(16).padStart(2, "0")).join("");
const hexBytes = value => Uint8Array.from(value.match(/.{2}/g) || [], hex => parseInt(hex, 16));
const toBase64 = bytes => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const fromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

function orderFor(state, orderId) {
  const order = state?.records?.find(row => row.type === "order" && row.id === orderId);
  if (!order) throw new Error("Order darurat tidak ditemukan");
  return order;
}

export function ensureEmergencyAssignment(state, orderId) {
  const order = orderFor(state, orderId);
  if (order.handoffToken) return state;
  if (!state.active) throw new Error("Insiden sudah ditutup");
  const token = randomHex(32);
  return {
    ...state,
    records: state.records.map(row => row.id === orderId ? { ...row, handoffToken: token } : row),
    events: [...state.events, { at: new Date().toISOString(), action: "ISSUE_ASSIGNMENT", details: orderId }],
  };
}

export function createEmergencyAssignment(state, orderId) {
  const order = orderFor(state, orderId);
  if (!order.handoffToken) throw new Error("Paket tugas belum diterbitkan");
  return {
    format: ASSIGNMENT_FORMAT, incidentId: state.incidentId, orderId,
    issuedAt: new Date().toISOString(), token: order.handoffToken,
    order: Object.fromEntries(["customer", "phone", "address", "date", "time", "service", "team", "plannedUnits", "notes"]
      .map(key => [key, order.fields[key] || ""])),
  };
}

export function validateEmergencyAssignment(packageData) {
  const data = packageData;
  if (data?.format !== ASSIGNMENT_FORMAT || !clean(data.incidentId).startsWith("EMG-") ||
      !clean(data.orderId).startsWith(`${data.incidentId}-`) || !/^[0-9a-f]{64}$/i.test(data.token || "") ||
      !clean(data.order?.customer) || !clean(data.order?.service))
    throw new Error("File tugas darurat tidak valid");
  return data;
}

export function validateTechnicianReport(draft) {
  const report = {
    technician: clean(draft?.technician), helper: clean(draft?.helper), team: clean(draft?.team),
    actualUnits: clean(draft?.actualUnits), work: clean(draft?.work), materials: clean(draft?.materials),
    notes: clean(draft?.notes), completedAt: clean(draft?.completedAt),
  };
  if (!report.technician || !report.team || !report.work || report.actualUnits === "" ||
      !Number.isInteger(Number(report.actualUnits)) || Number(report.actualUnits) < 0)
    throw new Error("Isi teknisi, tim, jumlah unit aktual (0 atau lebih), dan pekerjaan");
  return report;
}

function validatePhotos(photos) {
  if (!Array.isArray(photos) || photos.length > MAX_PHOTOS) throw new Error(`Maksimal ${MAX_PHOTOS} foto`);
  return photos.map(photo => {
    const name = clean(photo.name).slice(0, 160);
    const dataUrl = String(photo.dataUrl || "");
    if (!name || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > 2_000_000)
      throw new Error("Foto tidak valid atau terlalu besar; kompres foto dahulu");
    return { name, dataUrl };
  });
}

async function assignmentKey(token) {
  return crypto.subtle.importKey("raw", hexBytes(token), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function buildEmergencyReportPackage(assignment, draft, photos = [], packageId = null) {
  validateEmergencyAssignment(assignment);
  const id = packageId || crypto.randomUUID();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("ID paket laporan tidak valid");
  const payload = {
    incidentId: assignment.incidentId, orderId: assignment.orderId, packageId: id,
    createdAt: new Date().toISOString(), report: validateTechnicianReport(draft), photos: validatePhotos(photos),
  };
  const plain = encoder.encode(JSON.stringify(payload));
  if (plain.byteLength > MAX_PACKAGE_BYTES) throw new Error("Paket terlalu besar; kurangi ukuran/jumlah foto");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await assignmentKey(assignment.token), plain);
  return {
    format: REPORT_FORMAT, incidentId: assignment.incidentId, orderId: assignment.orderId,
    iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function openEmergencyReportPackage(state, reportPackage, { allowDuplicate = false } = {}) {
  if (reportPackage?.format !== REPORT_FORMAT || !clean(reportPackage.incidentId) || !clean(reportPackage.orderId) ||
      !clean(reportPackage.iv) || !clean(reportPackage.ciphertext) || reportPackage.ciphertext.length > MAX_PACKAGE_BYTES * 2)
    throw new Error("File laporan darurat tidak valid");
  if (reportPackage.incidentId !== state.incidentId) throw new Error("Laporan berasal dari insiden lain");
  const order = orderFor(state, reportPackage.orderId);
  if (!order.handoffToken) throw new Error("Order belum mempunyai paket tugas yang diterbitkan Owner");
  let payload;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(reportPackage.iv) },
      await assignmentKey(order.handoffToken), fromBase64(reportPackage.ciphertext));
    payload = JSON.parse(decoder.decode(plain));
  } catch { throw new Error("Laporan gagal dibuka: paket rusak atau tidak cocok dengan tugas Owner"); }
  if (payload?.incidentId !== state.incidentId || payload?.orderId !== order.id || !/^[0-9a-f-]{36}$/i.test(payload?.packageId || ""))
    throw new Error("Identitas laporan tidak cocok dengan order");
  if (!allowDuplicate && state.records.some(row => row.type === "report" && row.fields.sourcePackageId === payload.packageId))
    throw new Error("Paket laporan ini sudah pernah diimpor; tidak dibuat duplikat");
  return { ...payload, report: validateTechnicianReport(payload.report), photos: validatePhotos(payload.photos) };
}

export function reportFieldsFromPackage(payload) {
  return {
    orderRef: payload.orderId, team: payload.report.team, technician: payload.report.technician,
    helper: payload.report.helper, actualUnits: payload.report.actualUnits, work: payload.report.work,
    materials: payload.report.materials, notes: payload.report.notes, completedAt: payload.report.completedAt,
    sourcePackageId: payload.packageId,
    photoRefs: payload.photos.map(photo => photo.name).join(", "),
    photoCount: String(payload.photos.length),
  };
}
