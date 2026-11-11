import { randomUUID } from "node:crypto";

const SETTINGS_KEY = "wa_provider";
const SUPABASE_URL = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = () => process.env.SUPABASE_SERVICE_KEY || "";

let providerCache = { value: null, expiresAt: 0, pending: null };

export function normalizeWaProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (["fonnte", "whacenter", "wablas"].includes(provider)) return provider;
  return null;
}

export function wablasApiBase(env = process.env) {
  const raw = String(env.WABLAS_API_BASE_URL || "https://wablas.com").trim();
  let url;
  try { url = new URL(raw); } catch { throw new Error("WABLAS_API_BASE_URL tidak valid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash
    || (url.pathname !== "/" && url.pathname !== "")
    || !(url.hostname === "wablas.com" || url.hostname.endsWith(".wablas.com"))) {
    throw new Error("WABLAS_API_BASE_URL harus origin HTTPS WABLAS, mis. https://wablas.com");
  }
  return url.origin;
}

export function clearWaProviderCache() {
  providerCache = { value: null, expiresAt: 0, pending: null };
}

export async function readSelectedWaProvider({ fetchImpl = fetch, env = process.env, cacheMs = 1500 } = {}) {
  const now = Date.now();
  if (providerCache.value && providerCache.expiresAt > now) return providerCache.value;
  if (providerCache.pending) return providerCache.pending;
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "";
  const serviceKey = env.SUPABASE_SERVICE_KEY || "";
  if (!supabaseUrl || !serviceKey) throw new Error("Pengaturan provider WhatsApp belum dapat dibaca dari server");

  providerCache.pending = (async () => {
    const url = new URL(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/app_settings`);
    url.searchParams.set("key", `eq.${SETTINGS_KEY}`);
    url.searchParams.set("select", "value");
    const response = await fetchImpl(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`Pengaturan provider WhatsApp gagal dibaca (HTTP ${response.status})`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("Respons pengaturan provider WhatsApp tidak valid");
    const selected = rows.length ? normalizeWaProvider(rows[0]?.value) : "fonnte";
    if (!selected) throw new Error("Provider WhatsApp di app_settings tidak dikenal; pengiriman dihentikan");
    providerCache.value = selected;
    providerCache.expiresAt = Date.now() + Math.max(0, Number(cacheMs) || 0);
    return selected;
  })().finally(() => { providerCache.pending = null; });
  return providerCache.pending;
}

async function resolveGroupName(groupId, { fetchImpl, env }) {
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "";
  const serviceKey = env.SUPABASE_SERVICE_KEY || "";
  if (!supabaseUrl || !serviceKey) throw new Error("Pemetaan grup WhatsApp belum dapat dibaca");
  const url = new URL(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/wa_monitored_groups`);
  url.searchParams.set("group_id", `eq.${groupId}`);
  url.searchParams.set("select", "group_name");
  url.searchParams.set("limit", "1");
  const response = await fetchImpl(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`Pemetaan grup WhatsApp gagal dibaca (HTTP ${response.status})`);
  const rows = await response.json();
  const name = Array.isArray(rows) ? String(rows[0]?.group_name || "").trim() : "";
  if (!name) throw new Error("Nama grup WhaCenter belum terpetakan di wa_monitored_groups");
  return name;
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

export async function sendWithConfiguredWaProvider(init = {}, {
  fetchImpl = fetch,
  env = process.env,
  provider: providerOverride,
  selectedProvider,
} = {}) {
  const requestedProvider = providerOverride ?? selectedProvider;
  const provider = requestedProvider === undefined
    ? await readSelectedWaProvider({ fetchImpl, env })
    : normalizeWaProvider(requestedProvider);
  if (!provider) return jsonResponse({ status: false, reason: "Provider WhatsApp tidak dikenal; pesan tidak dikirim" }, 400);
  if (!init || String(init.method || "POST").toUpperCase() !== "POST") return jsonResponse({ status: false, reason: "Permintaan provider WhatsApp tidak valid" }, 400);

  if (provider === "fonnte") {
    const token = env.FONNTE_TOKEN;
    if (!token) return jsonResponse({ status: false, reason: "FONNTE_TOKEN belum dikonfigurasi di server" }, 503);
    const headers = new Headers(init.headers || {});
    headers.set("Authorization", token);
    if (!headers.has("Content-Type") && typeof init.body === "string") headers.set("Content-Type", "application/json");
    return fetchImpl("https://api.fonnte.com/send", { ...init, headers });
  }

  if (provider === "wablas") {
    const token = String(env.WABLAS_TOKEN || "").trim();
    const secret = String(env.WABLAS_SECRET_KEY || "").trim();
    if (!token || !secret) return jsonResponse({ status: false, reason: "WABLAS_TOKEN dan WABLAS_SECRET_KEY wajib dikonfigurasi di server" }, 503);
    let payload;
    try { payload = typeof init.body === "string" ? JSON.parse(init.body) : init.body || {}; }
    catch { return jsonResponse({ status: false, reason: "Payload WhatsApp tidak valid" }, 400); }
    const target = String(payload.target || payload.number || payload.phone || "").trim();
    const message = String(payload.message || "");
    if (!target || !message) return jsonResponse({ status: false, reason: "Nomor tujuan dan pesan wajib diisi" }, 400);
    if (Array.from(message).length > 1024) return jsonResponse({ status: false, reason: "Pesan WABLAS maksimal 1024 karakter" }, 400);

    const hasDocument = String(payload.url || payload.file || "").trim() !== "";
    const requestId = String(payload.ref_id || payload.requestId || payload.outbox_id || payload.id || randomUUID()).slice(0, 100);
    const group = payload.isGroup === true || payload.isGroup === "true" || /@g\.us$/i.test(target)
      || /^\d+-\d{5,}$/.test(target) || /^\d{16,}$/.test(target);
    const filename = String(payload.filename || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
    const item = hasDocument
      ? { phone: target, document: String(payload.url || payload.file).trim(), caption: message, ...(filename ? { filename } : {}), isGroup: group, ref_id: requestId }
      : { phone: target, message, isGroup: group, ref_id: requestId };
    const headers = new Headers({
      Authorization: `${token}.${secret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    if (env.WABLAS_DEVICE_ID) headers.set("X-Device-ID", String(env.WABLAS_DEVICE_ID).trim());

    let base;
    try { base = wablasApiBase(env); }
    catch (error) { return jsonResponse({ status: false, reason: error.message }, 503); }
    const endpoint = hasDocument ? "/api/v2/send-document" : "/api/v2/send-message";
    const response = await fetchImpl(`${base}${endpoint}`, {
      method: "POST", headers, body: JSON.stringify({ data: [item] }), signal: init.signal || AbortSignal.timeout(20000),
    });
    const raw = await response.clone().json().catch(() => null);
    if (!response.ok || raw?.status !== true) {
      const rejected = raw?.status === false || (response.status >= 400 && response.status < 500 && response.status !== 408);
      if (!rejected) throw new Error("Hasil kirim WABLAS belum pasti; periksa riwayat sebelum mencoba lagi");
      return jsonResponse({ status: false, reason: String(raw?.message || raw?.error || `WABLAS HTTP ${response.status}`), ref_id: requestId }, response.status);
    }
    const resultSet = Array.isArray(raw.data) ? raw.data : [raw.data || {}];
    const messages = resultSet.flatMap(entry => Array.isArray(entry?.messages) ? entry.messages : entry?.messages ? [entry.messages] : []);
    const providerIds = messages.map(entry => String(entry?.id || "")).filter(Boolean);
    if (!providerIds.length && raw.id) providerIds.push(String(raw.id));
    return jsonResponse({ ...raw, status: true, id: providerIds.length === 1 ? providerIds[0] : providerIds, ref_id: requestId }, response.status);
  }

  const deviceId = String(env.WHACENTER_DEVICE_ID || "").trim();
  if (!deviceId) return jsonResponse({ status: false, reason: "WHACENTER_DEVICE_ID belum dikonfigurasi di server" }, 503);
  let payload;
  try { payload = typeof init.body === "string" ? JSON.parse(init.body) : init.body || {}; }
  catch { return jsonResponse({ status: false, reason: "Payload WhatsApp tidak valid" }, 400); }
  const target = String(payload.target || payload.number || payload.phone || "").trim();
  const message = String(payload.message || "");
  if (!target || !message) return jsonResponse({ status: false, reason: "Nomor tujuan dan pesan wajib diisi" }, 400);

  const isGroup = /@g\.us$/i.test(target) || /^\d+-\d{5,}$/.test(target);
  const url = new URL(isGroup ? "https://app.whacenter.com/api/sendGroup" : "https://app.whacenter.com/api/send");
  const form = new FormData();
  form.set("device_id", deviceId);
  form.set(isGroup ? "group" : "number", isGroup ? await resolveGroupName(target, { fetchImpl, env }) : target);
  form.set("message", message);
  const fileUrl = String(payload.url || payload.file || "").trim();
  if (fileUrl) {
    let parsed;
    try { parsed = new URL(fileUrl); } catch { return jsonResponse({ status: false, reason: "URL lampiran tidak valid" }, 400); }
    if (parsed.protocol !== "https:") return jsonResponse({ status: false, reason: "Lampiran WhatsApp harus memakai HTTPS" }, 400);
    form.set("file", parsed.toString());
  }

  let response;
  try {
    response = await fetchImpl(url, { method: "POST", body: form, signal: init.signal || AbortSignal.timeout(20000) });
  } catch (error) {
    // Preserve uncertainty to callers. Never send via Fonnte after a WhaCenter timeout.
    throw error;
  }
  const parsed = await response.clone().json().catch(() => null);
  const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const accepted = response.ok && (raw.status === true || raw.success === true);
  const rejected = raw.status === false || raw.success === false
    || (response.status >= 400 && response.status < 500 && response.status !== 408);
  if (!accepted && !rejected) {
    // A missing/invalid confirmation is not proof that nothing was sent.
    // Propagate uncertainty so callers cannot mark it FAILED and invite a duplicate.
    throw new Error("Hasil kirim WhaCenter belum pasti; periksa riwayat sebelum mengirim ulang");
  }
  const normalized = {
    ...raw,
    status: accepted,
    ...(accepted ? {} : { reason: String(raw.reason || raw.message || `WhaCenter menolak pesan (HTTP ${response.status})`) }),
    ...(raw.id || raw.message_id ? { id: raw.id || raw.message_id } : {}),
  };
  return jsonResponse(normalized, response.status, { "cache-control": "no-store" });
}

export async function testWaProvider(provider, { fetchImpl = fetch, env = process.env } = {}) {
  const selected = normalizeWaProvider(provider);
  if (!selected) return { ok: false, success: false, message: "Pilih Fonnte, WhaCenter, atau WABLAS" };
  if (selected === "fonnte") {
    const token = env.FONNTE_TOKEN;
    if (!token) return { ok: false, success: false, message: "FONNTE_TOKEN belum dikonfigurasi di server" };
    try {
      const response = await fetchImpl("https://api.fonnte.com/device", {
        method: "POST", headers: { Authorization: token }, signal: AbortSignal.timeout(10000),
      });
      const body = await response.json().catch(() => ({}));
      const deviceConnected = String(body.device_status || "").toLowerCase() === "connect";
      const ok = response.ok && body.status === true && deviceConnected;
      const message = ok ? "Fonnte terhubung"
        : body.status === true && !deviceConnected ? "Token Fonnte valid, tetapi perangkat terputus"
          : String(body.reason || `Fonnte HTTP ${response.status}`);
      return { ok, success: ok, provider: selected, message };
    } catch (error) { return { ok: false, success: false, provider: selected, message: error.name === "AbortError" ? "Fonnte timeout" : "Tidak dapat menghubungi Fonnte" }; }
  }

  if (selected === "wablas") {
    const token = String(env.WABLAS_TOKEN || "").trim();
    const secret = String(env.WABLAS_SECRET_KEY || "").trim();
    if (!token || !secret) return { ok: false, success: false, provider: selected, message: "WABLAS_TOKEN dan WABLAS_SECRET_KEY belum dikonfigurasi di server" };
    let base;
    try { base = wablasApiBase(env); }
    catch (error) { return { ok: false, success: false, provider: selected, message: error.message };
    }
    try {
      // Device Info documents token-in-query authentication. Keep this request
      // server-only and never log its URL because it contains the WABLAS token.
      const url = new URL(`${base}/api/device/info`);
      url.searchParams.set("token", token);
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000), redirect: "error" });
      const body = await response.json().catch(() => ({}));
      const connected = response.ok && body.status === true && body.data?.active === true
        && String(body.data?.status || "").toLowerCase() === "connected";
      return { ok: connected, success: connected, provider: selected,
        message: connected ? "WABLAS terhubung" : String(body.message || body.data?.status || `WABLAS HTTP ${response.status}`) };
    } catch (error) {
      return { ok: false, success: false, provider: selected, message: error.name === "AbortError" ? "WABLAS timeout" : "Tidak dapat menghubungi WABLAS" };
    }
  }

  const deviceId = String(env.WHACENTER_DEVICE_ID || "").trim();
  if (!deviceId) return { ok: false, success: false, provider: selected, message: "WHACENTER_DEVICE_ID belum dikonfigurasi di server" };
  try {
    const url = new URL("https://app.whacenter.com/api/statusDevice");
    url.searchParams.set("device_id", deviceId);
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
    const body = await response.json().catch(() => ({}));
    const connected = response.ok && body.status === true && String(body.data?.status || "").toUpperCase() === "CONNECTED";
    return { ok: connected, success: connected, provider: selected, message: connected ? "WhaCenter terhubung" : String(body.message || body.data?.status || `WhaCenter HTTP ${response.status}`) };
  } catch (error) { return { ok: false, success: false, provider: selected, message: error.name === "AbortError" ? "WhaCenter timeout" : "Tidak dapat menghubungi WhaCenter" }; }
}

// Best-effort operational alerts share the same gateway selection and acceptance
// rules as workspace sends. No retry/fallback after an uncertain response.
export async function sendConfiguredWaNotification(phone, message, options = {}) {
  if (!phone || !message) return false;
  try {
    const response = await sendWithConfiguredWaProvider({
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: phone, message, countryCode: "62" }),
      signal: AbortSignal.timeout(12000),
    }, options);
    const body = await response.json().catch(() => null);
    return response.ok && body?.status === true;
  } catch { return false; }
}
