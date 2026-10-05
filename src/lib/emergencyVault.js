// Mode darurat hanya menyimpan catatan di browser Owner. Tidak ada API/database
// write, dan file ini tidak pernah menganggap catatan lokal sebagai invoice PAID.
const KEY = "aclean:emergency:v1";
const VERSION = 1;
const ITERATIONS = 250_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesToBase64 = bytes => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const base64ToBytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const storage = () => {
  if (typeof window === "undefined" || !window.localStorage) throw new Error("Penyimpanan browser tidak tersedia");
  return window.localStorage;
};
const cryptoApi = () => {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) throw new Error("Enkripsi perangkat tidak tersedia");
  return globalThis.crypto;
};
const nowIso = () => new Date().toISOString();
const clean = value => String(value ?? "").trim();

function readEnvelope() {
  const raw = storage().getItem(KEY);
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw);
    if (envelope.version !== VERSION || !envelope.salt || !envelope.iv || !envelope.ciphertext) throw new Error("format tidak dikenal");
    return envelope;
  } catch { throw new Error("Arsip darurat rusak/tidak dikenal; jangan timpa, pulihkan dari ekspor terenkripsi"); }
}

async function deriveKey(passphrase, salt) {
  const subtle = cryptoApi().subtle;
  const material = await subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function wibStamp(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
}

function assertOwner(owner) {
  if (owner?.role !== "Owner" || !clean(owner?.id)) throw new Error("Hanya akun Owner terverifikasi yang dapat mengaktifkan mode darurat");
}

function event(state, action, details = "") {
  return { ...state, events: [...state.events, { at: nowIso(), action, details }] };
}

async function encryptEnvelope(state, passphrase, previous = null) {
  const salt = previous ? base64ToBytes(previous.salt) : cryptoApi().getRandomValues(new Uint8Array(16));
  const iv = cryptoApi().getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await cryptoApi().subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(state)));
  return {
    version: VERSION, ownerId: state.ownerId, incidentId: state.incidentId,
    active: state.active, revision: (previous?.revision || 0) + 1,
    salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptEnvelope(envelope, passphrase) {
  try {
    const key = await deriveKey(passphrase, base64ToBytes(envelope.salt));
    const plain = await cryptoApi().subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.iv) }, key, base64ToBytes(envelope.ciphertext));
    const state = JSON.parse(decoder.decode(plain));
    if (state.ownerId !== envelope.ownerId || state.incidentId !== envelope.incidentId || state.active !== envelope.active)
      throw new Error("metadata berbeda");
    return state;
  } catch { throw new Error("Frasa sandi salah atau arsip darurat rusak"); }
}

export function getEmergencyVaultMeta() {
  try {
    const envelope = readEnvelope();
    return envelope && { ownerId: envelope.ownerId, incidentId: envelope.incidentId, active: envelope.active, revision: envelope.revision };
  } catch { return { active: true, corrupt: true, incidentId: "ARSIP-RUSAK" }; }
}

export async function prepareEmergencyVault({ owner, passphrase }) {
  assertOwner(owner);
  if (clean(passphrase).length < 12) throw new Error("Gunakan frasa sandi minimal 12 karakter");
  const existing = readEnvelope();
  if (existing) {
    if (existing.ownerId !== owner.id) throw new Error("Arsip ini milik Owner lain pada perangkat ini");
    const state = await decryptEnvelope(existing, passphrase);
    return { state, revision: existing.revision };
  }
  const state = event({
    version: VERSION, ownerId: owner.id, ownerName: clean(owner.name), incidentId: null,
    active: false, startedAt: null, endedAt: null, reason: "", nextSequence: 1, records: [], events: [],
  }, "PREPARE", "Perangkat Owner disiapkan saat login terverifikasi");
  const envelope = await encryptEnvelope(state, passphrase);
  storage().setItem(KEY, JSON.stringify(envelope));
  return { state, revision: envelope.revision };
}

export async function activatePreparedEmergencyVault(passphrase, reason) {
  if (!clean(reason)) throw new Error("Alasan aktivasi wajib diisi");
  const envelope = readEnvelope();
  if (!envelope) throw new Error("Perangkat belum disiapkan oleh Owner saat online");
  const current = await decryptEnvelope(envelope, passphrase);
  if (current.active) return { state: current, revision: envelope.revision };
  if (current.incidentId) throw new Error("Insiden sebelumnya sudah ditutup; arsipkan dan siapkan perangkat baru dengan aman");
  const random = bytesToBase64(cryptoApi().getRandomValues(new Uint8Array(6))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 7).toUpperCase();
  const state = event({ ...current, incidentId: `EMG-${wibStamp()}-${random}`, active: true,
    startedAt: nowIso(), reason: clean(reason) }, "ACTIVATE", clean(reason));
  const updated = await encryptEnvelope(state, passphrase, envelope);
  if (readEnvelope()?.revision !== envelope.revision) throw new Error("Arsip berubah di tab lain; ulangi aktivasi");
  storage().setItem(KEY, JSON.stringify(updated));
  return { state, revision: updated.revision };
}

export async function activateEmergencyVault({ owner, passphrase, reason }) {
  assertOwner(owner);
  if (clean(passphrase).length < 12) throw new Error("Gunakan frasa sandi minimal 12 karakter");
  if (!clean(reason)) throw new Error("Alasan aktivasi wajib diisi");
  const existing = readEnvelope();
  if (existing) {
    if (existing.ownerId !== owner.id) throw new Error("Arsip ini milik Owner lain pada perangkat ini");
    const unlocked = await decryptEnvelope(existing, passphrase);
    if (unlocked.active) return { state: unlocked, revision: existing.revision };
    if (!unlocked.incidentId) return activatePreparedEmergencyVault(passphrase, reason);
    if (unlocked.records.some(row => row.reconciliation.status !== "reconciled"))
      throw new Error("Insiden sebelumnya masih memiliki catatan yang belum direkonsiliasi");
    throw new Error("Arsip insiden lama sudah ditutup. Ekspor/simpan arsip lalu siapkan perangkat baru untuk insiden berikutnya");
  }
  const random = bytesToBase64(cryptoApi().getRandomValues(new Uint8Array(4))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 5).toUpperCase();
  const state = event({
    version: VERSION, ownerId: owner.id, ownerName: clean(owner.name),
    incidentId: `EMG-${wibStamp()}-${random}`, active: true, startedAt: nowIso(), endedAt: null,
    reason: clean(reason), nextSequence: 1, records: [], events: [],
  }, "ACTIVATE", clean(reason));
  const envelope = await encryptEnvelope(state, passphrase);
  storage().setItem(KEY, JSON.stringify(envelope));
  return { state, revision: envelope.revision };
}

export async function unlockEmergencyVault(passphrase, { ownerId = null, requireActive = true } = {}) {
  const envelope = readEnvelope();
  if (!envelope) throw new Error("Belum ada arsip darurat pada perangkat ini");
  if (ownerId && envelope.ownerId !== ownerId) throw new Error("Arsip ini milik Owner lain");
  const state = await decryptEnvelope(envelope, passphrase);
  if (requireActive && !state.active) throw new Error("Insiden ini sudah ditutup");
  return { state, revision: envelope.revision };
}

export const EMERGENCY_TYPES = ["order", "report", "payment", "material"];

export function validateEmergencyRecord(type, fields) {
  if (!EMERGENCY_TYPES.includes(type)) throw new Error("Jenis catatan tidak dikenal");
  const input = Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, clean(value)]));
  if (type === "order" && (!input.customer || !input.date || !input.service || !input.team))
    throw new Error("Order memerlukan customer, tanggal, layanan, dan tim");
  if (type === "report" && (!input.orderRef || !input.team || !input.actualUnits || !input.work))
    throw new Error("Laporan memerlukan ID order, tim, unit aktual, dan pekerjaan");
  if (type === "payment" && (!input.orderRef || !Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0))
    throw new Error("Pembayaran memerlukan ID order dan nominal positif");
  if (type === "material" && (!input.orderRef || !input.material || !Number.isFinite(Number(input.quantity)) || Number(input.quantity) <= 0))
    throw new Error("Material memerlukan ID order, nama, dan jumlah positif");
  return input;
}

export async function updateEmergencyVault(passphrase, expectedRevision, mutate) {
  const envelope = readEnvelope();
  if (!envelope || envelope.revision !== expectedRevision) throw new Error("Arsip berubah di tab lain; buka ulang sebelum menyimpan");
  const current = await decryptEnvelope(envelope, passphrase);
  if (!current.active) throw new Error("Insiden sudah ditutup");
  const next = mutate(current);
  const updated = await encryptEnvelope(next, passphrase, envelope);
  if (readEnvelope()?.revision !== expectedRevision) throw new Error("Arsip berubah di tab lain; buka ulang sebelum menyimpan");
  storage().setItem(KEY, JSON.stringify(updated));
  return { state: next, revision: updated.revision };
}

export function appendEmergencyRecord(state, type, fields) {
  if (!state.active) throw new Error("Mode darurat tidak aktif");
  const input = validateEmergencyRecord(type, fields);
  if (type !== "order" && !state.records.some(row => row.type === "order" && row.id === input.orderRef))
    throw new Error("Pilih ID order darurat yang sudah dicatat terlebih dahulu");
  if (type === "report" && input.sourcePackageId && state.records.some(row => row.type === "report" && row.fields.sourcePackageId === input.sourcePackageId))
    throw new Error("Paket laporan ini sudah pernah diimpor; tidak dibuat duplikat");
  const id = `${state.incidentId}-${String(state.nextSequence).padStart(4, "0")}`;
  const row = { id, type, createdAt: nowIso(), fields: input, reconciliation: { status: "pending", targetId: "", note: "" } };
  return event({ ...state, nextSequence: state.nextSequence + 1, records: [...state.records, row] }, "RECORD", `${type}:${id}`);
}

export function reconcileEmergencyRecord(state, recordId, targetId, note) {
  const target = clean(targetId);
  if (!target) throw new Error("ID data permanen hasil rekonsiliasi wajib diisi");
  const row = state.records.find(item => item.id === recordId);
  if (!row) throw new Error("Catatan tidak ditemukan");
  const records = state.records.map(item => item.id === recordId
    ? { ...item, reconciliation: { status: "reconciled", targetId: target, note: clean(note), at: nowIso() } }
    : item);
  return event({ ...state, records }, "RECONCILE", `${recordId}:${target}`);
}

export function closeEmergencyIncident(state) {
  if (state.records.some(row => row.reconciliation.status !== "reconciled"))
    throw new Error("Masih ada catatan yang belum direkonsiliasi; insiden tidak dapat ditutup");
  return event({ ...state, active: false, endedAt: nowIso() }, "CLOSE");
}

export function emergencyCsv(state) {
  // Spreadsheet dapat mengeksekusi formula meski sel dibungkus tanda kutip CSV.
  const quote = value => {
    const raw = String(value ?? "");
    const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = ["emergency_id", "type", "created_at", "order_ref", "customer", "team", "date", "details_json", "reconciliation_status", "target_id"];
  const rows = state.records.map(row => [row.id, row.type, row.createdAt, row.fields.orderRef, row.fields.customer,
    row.fields.team, row.fields.date, JSON.stringify(row.fields), row.reconciliation.status, row.reconciliation.targetId]);
  return [header, ...rows].map(row => row.map(quote).join(",")).join("\r\n") + "\r\n";
}

export function exportEncryptedEmergencyVault() {
  const envelope = readEnvelope();
  if (!envelope) throw new Error("Arsip darurat belum ada");
  return JSON.stringify({ format: KEY, exportedAt: nowIso(), envelope }, null, 2);
}
