import { createHash, randomUUID } from "node:crypto";
import { sanitizeName, validateAndNormalizePhone, validateMessage } from "./_validate.js";

export function safeFonnteMediaUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !(url.hostname === "fonnte.com" || url.hostname.endsWith(".fonnte.com"))) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

const TYPES = { image: "image", photo: "image", imagemessage: "image", document: "document", file: "document", documentmessage: "document", video: "video", videomessage: "video", audio: "audio", ptt: "audio", sticker: "sticker", text: "text", chat: "text", conversation: "text" };
const FIELDS = ["device", "sender", "from", "member", "participant", "group", "isGroup", "type", "name", "message", "text", "caption", "url", "filename", "extension", "mimetype", "timestamp", "inboxid", "id", "message_id"];

export function normalizeWaIngress(body = {}) {
  const raw = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const senderRaw = String(raw.sender || raw.from || raw.group || "").slice(0, 100);
  const memberRaw = String(raw.member || raw.participant || "").slice(0, 100);
  const isGroup = !!memberRaw || raw.isGroup === true || raw.isGroup === "true" || senderRaw.includes("@g.us") || /^\d+-\d+/.test(senderRaw);
  // A WhatsApp LID is not a phone number. Never invent a customer from its digits.
  const identity = [raw.sender, raw.from].find(value => value && !/@lid\b/i.test(String(value)));
  const identityText = String(identity || "");
  const phone = isGroup || (identityText.includes("@") && !/@(?:s\.whatsapp\.net|c\.us)$/i.test(identityText)) ? null : validateAndNormalizePhone(identityText.replace(/@(?:s\.whatsapp\.net|c\.us)$/i, ""));
  const sourceUrl = safeFonnteMediaUrl(raw.url) || safeFonnteMediaUrl(raw.message);
  const originalType = String(raw.type || "").toLowerCase().replace(/[^a-z]/g, "");
  let type = TYPES[originalType] || (!originalType && sourceUrl ? (/\.pdf(?:\?|$)/i.test(sourceUrl) ? "document" : "image") : originalType || "text");
  if (type === "text" && sourceUrl && /\.(png|jpe?g|webp|gif|pdf)(?:\?|$)/i.test(sourceUrl)) type = /\.pdf(?:\?|$)/i.test(sourceUrl) ? "document" : "image";
  const candidate = [raw.message, raw.text, raw.caption].find(value => typeof value === "string" && value.trim()) || "";
  const message = validateMessage(candidate) || (sourceUrl ? `[${type}] ${sourceUrl}` : isGroup ? "(empty/system message)" : null);
  let reviewReason = !isGroup && !phone ? "Identitas pengirim belum dapat dipastikan; jangan menebak nomor dari LID." : null;
  if (!isGroup && !message) reviewReason ||= "Pesan/media kosong atau format belum dikenali; periksa arsip WA.";
  if (!isGroup && ["image", "document"].includes(type) && !sourceUrl) reviewReason ||= "Foto/dokumen diterima tanpa URL Fonnte yang aman; file belum dapat diunduh.";
  if (candidate.length > 4096) reviewReason ||= "Pesan melebihi 4096 karakter; perlu diperiksa manual.";
  const payload = {};
  for (const key of FIELDS) {
    const value = raw[key];
    const limit = ["message", "text", "caption"].includes(key) ? 8192 : key === "url" ? 4096 : key === "filename" ? 256 : 100;
    if (["string", "number", "boolean"].includes(typeof value)) payload[key] = typeof value === "string" ? value.slice(0, limit) : value;
  }
  // Provider IDs/timestamps survive retries. Without any stable identity, keep
  // both identical messages instead of silently dropping a legitimate second one.
  const stableId = raw.inboxid || raw.id || raw.message_id || raw.timestamp || sourceUrl || randomUUID();
  const eventKey = "wa_" + createHash("sha256").update(JSON.stringify([String(raw.device || ""), phone || senderRaw, memberRaw, String(stableId), type, candidate, sourceUrl])).digest("hex");
  const caption = candidate.trim();
  const operationalPhoto = /^(pagi|pulang|sore|selesai|morning)\s+tas\s*\d{1,2}$/i.test(caption) || /^material\s+(pagi|pulang)$/i.test(caption);
  return {
    event_key: eventKey, payload, sender: senderRaw, member: memberRaw, phone, type,
    message, name: sanitizeName(String(raw.name || phone || senderRaw || "Tidak diketahui")),
    is_group: isGroup, media_url: sourceUrl, review_reason: reviewReason,
    capture_media: !isGroup && ["image", "document"].includes(type) && !!sourceUrl && !operationalPhoto,
    processable: !reviewReason && (isGroup || ["text", "image", "document"].includes(type)),
  };
}

export async function captureWaIngress(event, { supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_KEY, fetchImpl = fetch } = {}) {
  if (!supabaseUrl || !serviceKey) throw new Error("Penyimpanan webhook belum dikonfigurasi");
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/capture_wa_webhook_214`, {
    method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_event: event }), signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`Penerimaan webhook belum tersimpan (HTTP ${response.status}); periksa migrasi 214`);
  const result = await response.json();
  if (!result?.receipt_id || !result?.received_at || typeof result.duplicate !== "boolean") throw new Error("Respons penyimpanan webhook tidak valid");
  if (!event.is_group && event.phone && event.message && !result.message_id) throw new Error("Pesan belum terkonfirmasi tersimpan");
  return result;
}

export async function downloadIngressMedia(url, { fetchImpl = fetch, maxBytes = 10 * 1024 * 1024 } = {}) {
  if (!safeFonnteMediaUrl(url)) throw new Error("URL media tidak aman");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000), redirect: "error" });
  if (!response.ok) throw new Error(`Fonnte media HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Media melebihi batas 10 MB; periksa file asli di WA");
  const reader = response.body?.getReader?.();
  const chunks = []; let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new Error("Media melebihi batas 10 MB; periksa file asli di WA"); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
  } else {
    const bytes = Buffer.from(await response.arrayBuffer()); size = bytes.length; chunks.push(bytes);
  }
  if (!size || size > maxBytes) throw new Error(size ? "Media melebihi batas 10 MB" : "File media kosong; perlu retry");
  return { buffer: Buffer.concat(chunks), mimeType: (response.headers.get("content-type") || "image/jpeg").split(";")[0].trim() };
}

export async function readWaIngressHealth({ supabaseUrl, serviceKey, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/get_wa_ingress_health_214`, {
      method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: "{}", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Ingress health unavailable");
    const value = await response.json();
    if (!value || !Array.isArray(value.incidents) || !Number.isSafeInteger(value.review_count) || !Number.isSafeInteger(value.recent_received)) throw new Error("Invalid ingress health");
    return { available: true, last_received_at: Number.isFinite(Date.parse(value.last_received_at)) ? new Date(value.last_received_at).toISOString() : null,
      review_count: value.review_count, recent_received: value.recent_received,
      incidents: value.incidents.slice(0,20).map(row => ({ id: String(row.id).slice(0,100), sender: String(row.sender || "Tidak diketahui").slice(0,100),
        type: String(row.msg_type || "unknown").slice(0,40), reason: String(row.intake_error || "Periksa bentuk pesan/media").slice(0,300),
        created_at: Number.isFinite(Date.parse(row.created_at)) ? new Date(row.created_at).toISOString() : null })) };
  } catch {
    // An unavailable capture monitor must be visible, not mistaken for no gaps.
    return { available: false, error: "Status penerimaan webhook belum tersedia; periksa koneksi/migrasi 214" };
  }
}
