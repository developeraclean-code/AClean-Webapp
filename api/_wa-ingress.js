import { createHash, randomUUID } from "node:crypto";
import { sanitizeName, validateAndNormalizePhone, validateMessage } from "./_validate.js";

const SAFE_MEDIA_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/;

export function safeFonnteMediaUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !SAFE_MEDIA_HOST.test(url.hostname) || !(url.hostname === "fonnte.com" || url.hostname.endsWith(".fonnte.com"))) return null;
    url.hash = "";
    const normalized = url.toString();
    return normalized.length <= 4096 ? normalized : null;
  } catch { return null; }
}

export function whacenterMediaHosts(env = process.env) {
  return [...new Set(String(env.WHACENTER_MEDIA_HOSTS || "").split(",")
    .map(host => host.trim().toLowerCase())
    .filter(host => SAFE_MEDIA_HOST.test(host)))].slice(0, 32);
}

export function safeWhacenterMediaUrl(value, { env = process.env } = {}) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !SAFE_MEDIA_HOST.test(url.hostname)) return null;
    const builtin = url.hostname === "whacenter.com" || url.hostname.endsWith(".whacenter.com");
    if (!builtin && !whacenterMediaHosts(env).includes(url.hostname)) return null;
    url.hash = "";
    const normalized = url.toString();
    return normalized.length <= 4096 ? normalized : null;
  } catch { return null; }
}

const TYPES = { image: "image", photo: "image", imagemessage: "image", document: "document", file: "document", documentmessage: "document", video: "video", videomessage: "video", audio: "audio", ptt: "audio", sticker: "sticker", text: "text", chat: "text", conversation: "text" };
const FIELDS = ["provider", "device", "sender", "from", "to", "member", "participant", "group", "isGroup", "type", "name", "message", "text", "caption", "url", "media", "filename", "extension", "mimetype", "timestamp", "inboxid", "id", "message_id"];

export function normalizeWaIngress(body = {}, { provider = "fonnte", env = process.env } = {}) {
  const raw = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const providerName = provider === "whacenter" ? "whacenter" : "fonnte";
  const explicitGroup = [raw.group, raw.sender, raw.from].find(value => typeof value === "string" && (value.endsWith("@g.us") || /^\d+-\d+$/.test(value)));
  const senderRaw = String(explicitGroup || raw.sender || raw.from || raw.group || "").slice(0, 100);
  const memberRaw = String(raw.member || raw.participant || (explicitGroup && raw.from !== explicitGroup ? raw.from : "") || "").slice(0, 100);
  const isGroup = !!memberRaw || raw.isGroup === true || raw.isGroup === "true" || senderRaw.includes("@g.us") || /^\d+-\d+/.test(senderRaw);
  // A WhatsApp LID is not a phone number. Never invent a customer from its digits.
  const identity = [raw.sender, raw.from].find(value => value && !/@lid\b/i.test(String(value)));
  const identityText = String(identity || "");
  const phone = isGroup || (identityText.includes("@") && !/@(?:s\.whatsapp\.net|c\.us)$/i.test(identityText)) ? null : validateAndNormalizePhone(identityText.replace(/@(?:s\.whatsapp\.net|c\.us)$/i, ""));
  const sourceUrl = providerName === "whacenter"
    ? (safeWhacenterMediaUrl(raw.media, { env }) || safeWhacenterMediaUrl(raw.url, { env }) || safeWhacenterMediaUrl(raw.message, { env }))
    : (safeFonnteMediaUrl(raw.url) || safeFonnteMediaUrl(raw.message));
  const originalType = String(raw.type || "").toLowerCase().replace(/[^a-z]/g, "");
  const fileName = String(raw.filename || (sourceUrl ? new URL(sourceUrl).pathname : ""));
  const mime = String(raw.mimetype || "").toLowerCase();
  const documentFile = /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar)$/i.test(fileName);
  const inferredType = documentFile || mime === "application/pdf" ? "document"
    : /\.(mp4|mov|webm|3gp)$/i.test(fileName) || mime.startsWith("video/") ? "video"
    : /\.(ogg|mp3|m4a|wav|aac)$/i.test(fileName) || mime.startsWith("audio/") ? "audio" : "image";
  let type = TYPES[originalType] || (!originalType && sourceUrl ? inferredType : originalType || "text");
  if (type === "text" && sourceUrl) type = inferredType;
  const candidate = [raw.message, raw.text, raw.caption].find(value => typeof value === "string" && value.trim()) || "";
  const message = validateMessage(candidate) || (sourceUrl ? `[${type}] ${sourceUrl}` : isGroup ? "(empty/system message)" : null);
  let reviewReason = !isGroup && !phone ? "Identitas pengirim belum dapat dipastikan; jangan menebak nomor dari LID." : null;
  if (!isGroup && !message) reviewReason ||= "Pesan/media kosong atau format belum dikenali; periksa arsip WA.";
  if (!isGroup && ["image", "document"].includes(type) && !sourceUrl) reviewReason ||= `Foto/dokumen diterima tanpa URL media ${providerName} yang diizinkan; file belum dapat diunduh.`;
  if (!isGroup && type === "document" && documentFile && !/\.pdf$/i.test(fileName)) reviewReason ||= "Dokumen diterima; format ini perlu diperiksa manual dan tidak dianalisis sebagai gambar pembayaran.";
  if (candidate.length > 4096) reviewReason ||= "Pesan melebihi 4096 karakter; perlu diperiksa manual.";
  const payload = {};
  for (const key of FIELDS) {
    const value = raw[key];
    const limit = ["message", "text", "caption"].includes(key) ? 8192 : ["url", "media"].includes(key) ? 4096 : key === "filename" ? 256 : 100;
    if (["string", "number", "boolean"].includes(typeof value)) payload[key] = typeof value === "string" ? value.slice(0, limit) : value;
  }
  // Provider IDs/timestamps survive retries. Without any stable identity, keep
  // both identical messages instead of silently dropping a legitimate second one.
  payload.provider = providerName;
  const stableId = raw.inboxid || raw.id || raw.message_id || raw.timestamp || sourceUrl || randomUUID();
  const eventKey = "wa_" + createHash("sha256").update(JSON.stringify([providerName, String(raw.device || raw.to || ""), phone || senderRaw, memberRaw, String(stableId), type, candidate, sourceUrl])).digest("hex");
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

export async function captureWaIngress(event, { supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_KEY, fetchImpl = fetch, env = process.env } = {}) {
  if (!supabaseUrl || !serviceKey) throw new Error("Penyimpanan webhook belum dikonfigurasi");
  const extraHosts = event.media_url && event.payload?.provider === "whacenter" ? whacenterMediaHosts(env) : [];
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/capture_wa_webhook_214`, {
    method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_event: event, ...(extraHosts.length ? { p_media_hosts: extraHosts } : {}) }), signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) {
    let detail = {};
    try { detail = await response.json() || {}; } catch { /* never log the raw response */ }
    const code = /^[A-Z0-9]{5,12}$/.test(String(detail.code || "")) ? detail.code : "unknown";
    // Return only known static diagnostics: database messages can contain private payloads.
    const reason = detail.message === "URL media tidak aman" ? "URL media ditolak database" : "RPC penerimaan gagal";
    throw new Error(`Penerimaan webhook belum tersimpan (HTTP ${response.status}, code=${code}, ${reason}); periksa migrasi 214/233`);
  }
  const result = await response.json();
  if (!result?.receipt_id || !result?.received_at || typeof result.duplicate !== "boolean") throw new Error("Respons penyimpanan webhook tidak valid");
  if (!event.is_group && event.phone && event.message && !result.message_id) throw new Error("Pesan belum terkonfirmasi tersimpan");
  return result;
}

function mediaDownloadError(code, message) {
  const error = new Error(`${message} [WA_MEDIA_${code}]`);
  error.waMediaCode = `WA_MEDIA_${code}`;
  return error;
}

function mediaTransportError(error) {
  const known = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID"]);
  const candidate = error?.cause?.code || error?.code;
  const code = ["AbortError", "TimeoutError"].includes(error?.name) ? "TIMEOUT" : known.has(candidate) ? candidate : "FETCH_FAILED";
  return mediaDownloadError(code, "Unduhan media provider gagal");
}

export async function downloadIngressMedia(url, { fetchImpl = fetch, maxBytes = 10 * 1024 * 1024, provider = "fonnte", env = process.env, timeoutMs = 10000 } = {}) {
  if (!["fonnte", "whacenter"].includes(provider)) throw mediaDownloadError("PROVIDER_REJECTED", "Provider media tidak dikenal");
  const safeUrl = provider === "whacenter" ? safeWhacenterMediaUrl(url, { env }) : safeFonnteMediaUrl(url);
  if (!safeUrl) throw mediaDownloadError("URL_REJECTED", "URL media tidak aman atau host belum diizinkan");
  const signal = AbortSignal.timeout(timeoutMs);
  let target = safeUrl, response;
  // WhaCenter's media gateway redirects to object storage. Validate every hop
  // before making the next request; no auth headers, cookies or TLS bypass.
  for (let redirects = 0; ; redirects++) {
    try { response = await fetchImpl(target, { signal, redirect: provider === "whacenter" ? "manual" : "error" }); }
    catch (error) { throw mediaTransportError(error); }
    if (provider !== "whacenter" || ![301, 302, 303, 307, 308].includes(response.status)) break;
    try { await response.body?.cancel(); } catch { /* release redirect response */ }
    if (redirects >= 3) throw mediaDownloadError("REDIRECT_LIMIT", "Redirect media melebihi batas tiga kali");
    const location = response.headers.get("location");
    if (!location) throw mediaDownloadError("REDIRECT_LOCATION_MISSING", "Redirect media tidak memiliki tujuan");
    let next;
    try { next = new URL(location, target).toString(); }
    catch { throw mediaDownloadError("REDIRECT_REJECTED", "Tujuan redirect media tidak valid"); }
    target = safeWhacenterMediaUrl(next, { env });
    if (!target) throw mediaDownloadError("REDIRECT_HOST_REJECTED", "Host redirect media belum diizinkan; periksa WHACENTER_MEDIA_HOSTS");
  }
  if (!response.ok) {
    try { await response.body?.cancel(); } catch { /* release failure response */ }
    throw mediaDownloadError(`HTTP_${response.status}`, `${provider === "whacenter" ? "WhaCenter" : "Fonnte"} media HTTP ${response.status}`);
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    try { await response.body?.cancel(); } catch { /* release oversized response */ }
    throw mediaDownloadError("TOO_LARGE", "Media melebihi batas 10 MB; periksa file asli di WA");
  }
  const reader = response.body?.getReader?.();
  const chunks = []; let size = 0;
  try {
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) { await reader.cancel(); throw mediaDownloadError("TOO_LARGE", "Media melebihi batas 10 MB"); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
    } else {
      const bytes = Buffer.from(await response.arrayBuffer()); size = bytes.length; chunks.push(bytes);
    }
  } catch (error) { throw error.waMediaCode ? error : mediaTransportError(error); }
  if (!size || size > maxBytes) throw mediaDownloadError(size ? "TOO_LARGE" : "EMPTY", size ? "Media melebihi batas 10 MB" : "File media kosong; perlu retry");
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
