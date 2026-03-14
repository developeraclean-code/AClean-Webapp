// api/[route].js — Unified API Handler v2
// Satu file menggantikan semua:
//   send-wa.js, foto.js, upload-foto.js, webhook-fonnte.js, test-connection.js
//
// Cara Vercel routing bekerja:
//   /api/send-wa          → route = "send-wa"
//   /api/foto?key=...     → route = "foto" ATAU key ada tanpa route
//   /api/upload-foto      → route = "upload-foto"
//   /api/webhook-fonnte   → route = "webhook-fonnte"
//   /api/test-connection  → route = "test-connection"

import { createClient } from "@supabase/supabase-js";
import { validateInternalToken, checkRateLimit, setCorsHeaders } from "./_auth.js";

// ── Body size 10MB untuk upload foto ──
export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

// ── AWS4 Signature helper untuk Cloudflare R2 ──
async function awsSign({ method, bucket, key, acctId, accKey, secKey, mimeType, buf }) {
  const { createHmac, createHash } = await import("crypto");
  const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
  const hash = (d)    => createHash("sha256").update(d).digest("hex");

  const dts   = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  const dshrt = dts.slice(0, 8);
  const ph    = buf ? hash(buf) : hash("");

  const isUpload      = method === "PUT";
  const signedHeaders = isUpload
    ? "content-type;x-amz-content-sha256;x-amz-date"
    : "x-amz-content-sha256;x-amz-date";
  const canonHeaders  = isUpload
    ? `content-type:${mimeType}\nx-amz-content-sha256:${ph}\nx-amz-date:${dts}\n`
    : `x-amz-content-sha256:${ph}\nx-amz-date:${dts}\n`;

  const canonUri     = `/${bucket}/${key}`;
  const canonRequest = [method, canonUri, "", canonHeaders, signedHeaders, ph].join("\n");
  const scope        = `${dshrt}/auto/s3/aws4_request`;
  const strToSign    = ["AWS4-HMAC-SHA256", dts, scope, hash(canonRequest)].join("\n");
  const signingKey   = hmac(hmac(hmac(hmac(`AWS4${secKey}`, dshrt), "auto"), "s3"), "aws4_request");
  const signature    = createHmac("sha256", signingKey).update(strToSign).digest("hex");
  const auth         = `AWS4-HMAC-SHA256 Credential=${accKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { dts, ph, auth };
}

// ── R2 env helper ──
function r2Env() {
  return {
    acctId: (process.env.R2_ACCOUNT_ID || "").trim(),
    accKey: (process.env.R2_ACCESS_KEY  || "").trim(),
    secKey: (process.env.R2_SECRET_KEY  || "").trim(),
    bucket: (process.env.R2_BUCKET_NAME || "aclean-files").trim(),
  };
}

// ── Main handler ──
export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const route = req.query.route;

  // ── Foto: dipanggil via <img src="/api/foto?key=..."> — TIDAK butuh token ──
  // Bisa masuk sebagai: /api/foto?key=xxx (route="foto")
  // Atau standalone: /api/foto?key=xxx (route=undefined, key ada)
  const isFotoRequest = route === "foto" || (!route && req.query.key);
  if (isFotoRequest) {
    return handleFoto(req, res);
  }

  // ── Webhook Fonnte: dari server Fonnte, tidak punya internal token ──
  const isWebhook = route === "webhook-fonnte";
  if (isWebhook) {
    return handleWebhook(req, res);
  }

  // ── Semua route lain: wajib internal token (SEC-02) ──
  if (!checkRateLimit(req, res, 120, 60000)) return;
  if (!validateInternalToken(req, res)) return;

  // ── Route dispatch ──
  if (route === "send-wa")        return handleSendWA(req, res);
  if (route === "upload-foto")    return handleUploadFoto(req, res);
  if (route === "test-connection") return handleTestConnection(req, res);

  return res.status(404).json({ error: `Route '${route}' tidak ditemukan` });
}

// ════════════════════════════════════════════════════════════
// HANDLER: GET /api/foto?key=...
// Proxy foto dari R2 — no auth (dipanggil dari <img src>)
// ════════════════════════════════════════════════════════════
async function handleFoto(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const rawKey = req.query.key;
  if (!rawKey) return res.status(400).json({ error: "key wajib" });

  // Sanitasi key — cegah path traversal
  const key = decodeURIComponent(rawKey)
    .replace(/\.\.\//g, "")
    .replace(/^\/+/, "")
    .trim();
  if (key.length < 3) return res.status(400).json({ error: "key tidak valid" });

  const { acctId, accKey, secKey, bucket } = r2Env();
  if (!acctId || !accKey || !secKey)
    return res.status(500).json({ error: "R2 credentials belum diset" });

  try {
    const { dts, ph, auth } = await awsSign({ method: "GET", bucket, key, acctId, accKey, secKey });
    const r2 = await fetch(`https://${acctId}.r2.cloudflarestorage.com/${bucket}/${key}`, {
      headers: { "x-amz-content-sha256": ph, "x-amz-date": dts, "Authorization": auth },
    });

    if (!r2.ok) {
      if (r2.status === 404) return res.status(404).json({ error: "Foto tidak ditemukan" });
      return res.status(r2.status).json({ error: `R2 error ${r2.status}` });
    }

    const contentType = r2.headers.get("content-type") || "image/jpeg";
    const buf = await r2.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(Buffer.from(buf));
  } catch (err) {
    console.error("foto error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ════════════════════════════════════════════════════════════
// HANDLER: POST /api/send-wa { phone, message }
// Kirim WA via Fonnte
// ════════════════════════════════════════════════════════════
async function handleSendWA(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { phone, message } = req.body || {};

  // Validasi input
  if (!phone)   return res.status(400).json({ error: "phone wajib", detail: "phone kosong" });
  if (!message) return res.status(400).json({ error: "message wajib", detail: "message kosong" });

  // Normalisasi nomor HP ke format 628xxx
  const normPhone = String(phone).replace(/^0/, "62").replace(/[^0-9]/g, "");
  if (normPhone.length < 8)
    return res.status(400).json({ error: "Format nomor HP tidak valid", detail: `"${phone}" → "${normPhone}"` });

  const token = process.env.FONNTE_TOKEN;
  if (!token)
    return res.status(500).json({ error: "FONNTE_TOKEN belum diset di Vercel env vars" });

  try {
    // Fonnte wajib form-data, bukan JSON
    const form = new URLSearchParams();
    form.append("target",      normPhone);
    form.append("message",     message);
    form.append("countryCode", "62");
    form.append("typing",      "true");
    form.append("delay",       "1");

    const r = await fetch("https://api.fonnte.com/send", {
      method:  "POST",
      headers: { "Authorization": token },
      body:    form,
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok || data.status === false) {
      const reason = data.reason || data.message || "Unknown";
      console.error("Fonnte send error:", reason, "| target:", normPhone);

      // Pesan error yang informatif
      let msg = "Gagal kirim WA";
      if (reason.includes("disconnected") || reason.includes("disconnect") ||
          (reason.includes("invalid") && reason.includes("device"))) {
        msg = "Device WhatsApp Fonnte disconnect — scan ulang QR di app.fonnte.com";
      } else if (reason.includes("invalid") || reason.includes("body")) {
        msg = "Token Fonnte tidak valid";
      } else if (reason.includes("quota") || reason.includes("limit")) {
        msg = "Quota Fonnte habis";
      }

      return res.status(500).json({ error: msg, detail: reason, target: normPhone });
    }

    return res.status(200).json({ success: true, data, target: normPhone });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ════════════════════════════════════════════════════════════
// HANDLER: POST /api/upload-foto { base64, filename, reportId, mimeType? }
// Upload foto ke Cloudflare R2
// ════════════════════════════════════════════════════════════
async function handleUploadFoto(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { base64, filename, reportId, mimeType = "image/jpeg" } = req.body || {};
  if (!base64 || !filename)
    return res.status(400).json({ error: "base64 dan filename wajib" });

  const { acctId, accKey, secKey, bucket } = r2Env();
  if (!acctId || !accKey || !secKey)
    return res.status(500).json({ error: "R2 credentials belum diset di Vercel env" });

  try {
    const raw = base64.replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 0) return res.status(400).json({ error: "File kosong setelah decode" });

    const safe   = (filename || "foto.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
    const folder = reportId ? `reports/${reportId}` : "uploads";
    const objKey = `${folder}/${Date.now()}_${safe}`;

    const { dts, ph, auth } = await awsSign({
      method: "PUT", bucket, key: objKey, acctId, accKey, secKey, mimeType, buf,
    });

    const r2 = await fetch(`https://${acctId}.r2.cloudflarestorage.com/${bucket}/${objKey}`, {
      method:  "PUT",
      headers: { "Content-Type": mimeType, "x-amz-content-sha256": ph, "x-amz-date": dts, "Authorization": auth },
      body:    buf,
    });

    if (!r2.ok) {
      const xml  = await r2.text();
      const code = (xml.match(/<Code>([^<]+)/)    || [])[1] || r2.status;
      const msg  = (xml.match(/<Message>([^<]+)/) || [])[1] || xml.slice(0, 200);
      console.error("R2 upload error:", code, msg);
      return res.status(500).json({ success: false, error: `R2 ${code}: ${msg}` });
    }

    const fileUrl = `/api/foto?key=${encodeURIComponent(objKey)}`;
    console.log("✅ R2 upload OK:", objKey, buf.length + "B");
    return res.status(200).json({ success: true, url: fileUrl, key: objKey });
  } catch (err) {
    console.error("upload-foto error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ════════════════════════════════════════════════════════════
// HANDLER: POST /api/webhook-fonnte — WA incoming
// Dari server Fonnte — tanpa internal token
// ════════════════════════════════════════════════════════════
async function handleWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const sb = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
    const { sender, message, name } = req.body || {};
    if (!sender || !message) return res.status(400).json({ error: "Invalid payload" });

    const phone = sender.replace(/[^0-9]/g, "");
    const ml    = message.toLowerCase();

    // Klasifikasi intent
    let intent = "UNKNOWN";
    if (/order|booking|servis|cleaning|pasang|install|perbaik|ac/.test(ml)) intent = "ORDER_NEW";
    else if (/transfer|bayar|payment|lunas|bukti/.test(ml))                  intent = "PAYMENT";
    else if (/komplain|masih|belum|rusak|panas|bocor|tidak dingin/.test(ml)) intent = "COMPLAINT";
    else if (/harga|berapa|info|tanya|jadwal|jam/.test(ml))                  intent = "FAQ";

    // Upsert conversation
    const { data: conv } = await sb
      .from("wa_conversations").select("id,unread").eq("phone", phone).single();

    let convId;
    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

    if (conv) {
      convId = conv.id;
      await sb.from("wa_conversations").update({
        last_message: message.slice(0, 100),
        time: timeStr,
        unread: (conv.unread || 0) + 1,
        intent,
        status: intent === "COMPLAINT" ? "ESCALATED" : "ACTIVE",
        updated_at: now.toISOString(),
      }).eq("id", convId);
    } else {
      const { data: nc } = await sb.from("wa_conversations").insert({
        phone, name: name || phone,
        last_message: message.slice(0, 100),
        time: timeStr, unread: 1, intent, status: "ACTIVE",
      }).select("id").single();
      convId = nc?.id;
    }

    if (convId) {
      await sb.from("wa_messages").insert({
        conversation_id: convId, role: "user", content: message,
        created_at: now.toISOString(),
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("webhook error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ════════════════════════════════════════════════════════════
// HANDLER: POST /api/test-connection { type, provider? }
// Test koneksi semua provider dari Settings
// ════════════════════════════════════════════════════════════
async function handleTestConnection(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { type, provider } = req.body || {};

  try {
    // ── WA (Fonnte) ──
    if (type === "wa") {
      const token = process.env.FONNTE_TOKEN;
      if (!token)
        return res.json({ success: false, message: "❌ FONNTE_TOKEN belum diset di Vercel env vars" });

      const r = await fetch("https://api.fonnte.com/validate", {
        method: "POST",
        headers: { "Authorization": token },
      });
      const d = await r.json().catch(() => ({}));

      if (d.status === true) {
        const name   = d.name   || "";
        const target = d.target || d.device || "";
        return res.json({
          success: true,
          message: `✅ WhatsApp terhubung${target ? " — " + target : ""}${name ? " (" + name + ")" : ""}`,
        });
      }

      const reason = d.reason || d.message || "Token tidak valid";
      let hint = "";
      if (reason.includes("disconnect")) hint = " → Scan ulang QR di app.fonnte.com";
      return res.json({ success: false, message: `❌ Fonnte: ${reason}${hint}` });
    }

    // ── LLM ──
    if (type === "llm") {
      const prov = provider || "gemini";

      if (prov === "gemini") {
        const key = process.env.GEMINI_API_KEY;
        if (!key) return res.json({ success: false, message: "❌ GEMINI_API_KEY belum diset" });
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        const d = await r.json().catch(() => ({}));
        return res.json(r.ok
          ? { success: true,  message: "✅ Gemini terhubung (API key valid)" }
          : { success: false, message: "❌ Gemini: " + (d.error?.message || r.status) });
      }

      if (prov === "claude") {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) return res.json({ success: false, message: "❌ ANTHROPIC_API_KEY belum diset" });
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method:  "POST",
          headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body:    JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 5, messages: [{ role: "user", content: "hi" }] }),
        });
        const d = await r.json().catch(() => ({}));
        return res.json(r.ok
          ? { success: true,  message: "✅ Claude (Anthropic) terhubung" }
          : { success: false, message: "❌ Claude: " + (d.error?.message || r.status) });
      }

      if (prov === "openai") {
        const key = process.env.OPENAI_API_KEY;
        if (!key) return res.json({ success: false, message: "❌ OPENAI_API_KEY belum diset" });
        const r = await fetch("https://api.openai.com/v1/models", {
          headers: { "Authorization": `Bearer ${key}` },
        });
        return res.json(r.ok
          ? { success: true,  message: "✅ OpenAI terhubung" }
          : { success: false, message: "❌ OpenAI: key tidak valid" });
      }

      if (prov === "groq") {
        const key = process.env.GROQ_API_KEY;
        if (!key) return res.json({ success: false, message: "❌ GROQ_API_KEY belum diset" });
        const r = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { "Authorization": `Bearer ${key}` },
        });
        return res.json(r.ok
          ? { success: true,  message: "✅ Groq terhubung" }
          : { success: false, message: "❌ Groq: key tidak valid" });
      }

      return res.json({ success: false, message: `Provider '${prov}' tidak dikenal` });
    }

    // ── Storage (Cloudflare R2) ──
    if (type === "storage") {
      const { acctId, accKey, secKey, bucket } = r2Env();
      if (!acctId || !accKey || !secKey)
        return res.json({ success: false, message: "❌ R2 credentials belum lengkap (R2_ACCOUNT_ID / R2_ACCESS_KEY / R2_SECRET_KEY)" });

      const { dts, ph, auth } = await awsSign({ method: "GET", bucket, key: "", acctId, accKey, secKey });
      const r = await fetch(`https://${acctId}.r2.cloudflarestorage.com/${bucket}`, {
        headers: { "x-amz-content-sha256": ph, "x-amz-date": dts, "Authorization": auth },
      });
      return res.json(r.ok
        ? { success: true,  message: `✅ R2 terhubung — bucket: ${bucket}` }
        : { success: false, message: `❌ R2 error ${r.status} — cek credentials` });
    }

    // ── Database (Supabase) ──
    if (type === "db") {
      const url = process.env.VITE_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_KEY;
      if (!url || !key)
        return res.json({ success: false, message: "❌ VITE_SUPABASE_URL atau SUPABASE_SERVICE_KEY belum diset" });

      const sb = createClient(url, key);
      const { count, error } = await sb.from("orders").select("*", { count: "exact", head: true });
      return res.json(error
        ? { success: false, message: "❌ Supabase: " + error.message }
        : { success: true,  message: `✅ Supabase terhubung — ${count ?? 0} orders` });
    }

    return res.status(400).json({ error: `type '${type}' tidak valid. Gunakan: wa, llm, storage, db` });

  } catch (err) {
    console.error("test-connection error:", err.message);
    return res.status(500).json({ success: false, message: "❌ Server error: " + err.message });
  }
}
