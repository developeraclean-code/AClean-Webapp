// Data/foto draft disimpan pada perangkat teknisi, tidak pernah ditulis ke Supabase.
const DB_NAME = "aclean-emergency-field-v1";
const STORE = "drafts";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("Penyimpanan foto offline tidak tersedia pada browser ini"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Gagal membuka penyimpanan foto offline"));
  });
}

async function transaction(mode, action) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      let result = null;
      request.onsuccess = () => { result = request.result ?? null; };
      request.onerror = () => reject(request.error || new Error("Penyimpanan draft gagal"));
      tx.onerror = () => reject(tx.error || new Error("Penyimpanan draft gagal"));
      tx.oncomplete = () => resolve(result);
    });
  } finally { db.close(); }
}

export const emergencyDraftKey = assignment => `${assignment.incidentId}:${assignment.orderId}`;
export const loadEmergencyFieldDraft = assignment => transaction("readonly", store => store.get(emergencyDraftKey(assignment)));
export const saveEmergencyFieldDraft = (assignment, draft, photos, packageId) => transaction("readwrite", store =>
  store.put({ id: emergencyDraftKey(assignment), assignment, draft, photos, packageId,
    savedAt: new Date().toISOString() }));

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Foto ${file.name} tidak dapat dibuka`)); };
    image.src = url;
  });
}

export async function compressEmergencyPhoto(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("Pilih file foto/gambar");
  if (file.size > 15 * 1024 * 1024) throw new Error("Foto asli terlalu besar (maksimal 15 MB)");
  const image = await readImage(file);
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  if (dataUrl.length > 2_000_000) throw new Error("Foto masih terlalu besar setelah kompresi");
  return { name: file.name.slice(0, 160), dataUrl };
}
