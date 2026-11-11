import { fotoProxyUrl } from "../../lib/fotoUrl.js";

export const safePdfFilename = (value) => String(value || "Laporan")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-zA-Z0-9._-]+/g, "_")
  .replace(/^_+|_+$/g, "")
  .slice(0, 80) || "Laporan";

function blobToDataUrl(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return `data:${blob.type};base64,${btoa(binary)}`;
  });
}

async function loadOnePhoto(url, index, fetchImpl, origin) {
  if (/^data:image\/(png|jpe?g);base64,/i.test(url)) return { index, src: url, error: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const proxied = fotoProxyUrl(url);
    const absoluteUrl = new URL(proxied, origin).toString();
    const response = await fetchImpl(absoluteUrl, { credentials: "same-origin", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.size > 8 * 1024 * 1024) throw new Error("Foto melebihi 8 MB");
    if (!/^image\/(png|jpe?g)$/i.test(blob.type || "")) throw new Error("Format foto bukan JPEG/PNG");
    return { index, src: await blobToDataUrl(blob), error: null };
  } catch (error) {
    return { index, src: null, error: error?.message || "Foto tidak dapat dimuat" };
  } finally {
    clearTimeout(timeout);
  }
}

// Use the same-origin photo proxy for R2 URLs so PDF generation does not depend
// on custom CDN CORS settings. Limit concurrency to keep a report export light.
export async function loadDailyReportPhotos(urls, {
  fetchImpl = globalThis.fetch,
  origin = globalThis.location?.origin || "http://localhost",
  concurrency = 3,
} = {}) {
  const validUrls = (Array.isArray(urls) ? urls : []).filter((url) => typeof url === "string" && url.trim());
  const results = [];
  for (let start = 0; start < validUrls.length; start += concurrency) {
    const batch = validUrls.slice(start, start + concurrency);
    results.push(...await Promise.all(batch.map((url, offset) => loadOnePhoto(url, start + offset, fetchImpl, origin))));
  }
  return results;
}
