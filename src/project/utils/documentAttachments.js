export const MAX_DOCUMENT_ATTACHMENTS = 8;

export function normalizeDocumentAttachments(value) {
  let rows = value;
  if (typeof rows === "string") {
    try { rows = JSON.parse(rows); } catch { rows = []; }
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(row => row && typeof row === "object" && String(row.url || "").trim())
    .slice(0, MAX_DOCUMENT_ATTACHMENTS)
    .map((row, index) => ({
      id: String(row.id || `attachment-${index + 1}`),
      url: String(row.url).trim(),
      name: String(row.name || `Foto ${index + 1}`),
      caption: String(row.caption || ""),
      hash: row.hash ? String(row.hash) : null,
    }));
}

export function chunkDocumentAttachments(value, size = 4) {
  const rows = normalizeDocumentAttachments(value);
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

export function absoluteAttachmentUrl(url, origin = typeof window !== "undefined" ? window.location.origin : "") {
  const value = String(url || "").trim();
  if (!value || value.startsWith("data:") || /^https?:\/\//i.test(value)) return value;
  if (!origin) return value;
  try { return new URL(value, origin).toString(); } catch { return value; }
}

export async function prepareDocumentImage(file, { maxSide = 1600, quality = 0.72 } = {}) {
  if (!file || file.size > 15 * 1024 * 1024) throw new Error("Foto maksimal 15 MB");
  const raw = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", raw);
  const hash = Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 20);
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Gagal membaca foto"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${file.name || "File"} bukan gambar yang valid`));
    img.src = source;
  });
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    name: `document_${hash}.jpg`,
    originalName: file.name || "foto.jpg",
    dataUrl: canvas.toDataURL("image/jpeg", quality),
    hash,
  };
}
