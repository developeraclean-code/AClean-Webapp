// api/test-connection.js — v2 FIXED (pakai _auth.js SEC-02)
// POST /api/test-connection { type: "wa"|"llm"|"storage"|"db", provider? }

import { createClient }                                  from "@supabase/supabase-js";
import { validateInternalToken, checkRateLimit, setCorsHeaders } from "./_auth.js";

async function awsSign({ method, bucket, key, acctId, accKey, secKey }) {
  const { createHmac, createHash } = await import("crypto");
  const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
  const hash = (d)    => createHash("sha256").update(d).digest("hex");
  const dts   = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  const dshrt = dts.slice(0, 8);
  const ph    = hash("");
  const signedHeaders = "x-amz-content-sha256;x-amz-date";
  const canonHeaders  = `x-amz-content-sha256:${ph}\nx-amz-date:${dts}\n`;
  const canonUri      = `/${bucket}/${key}`;
  const canonRequest  = [method, canonUri, "", canonHeaders, signedHeaders, ph].join("\n");
  const scope         = `${dshrt}/auto/s3/aws4_request`;
  const strToSign     = ["AWS4-HMAC-SHA256", dts, scope, hash(canonRequest)].join("\n");
  const signingKey    = hmac(hmac(hmac(hmac(`AWS4${secKey}`, dshrt), "auto"), "s3"), "aws4_request");
  const signature     = createHmac("sha256", signingKey).update(strToSign).digest("hex");
  const auth          = `AWS4-HMAC-SHA256 Credential=${accKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { dts, ph, auth };
}

export default async function handler(req, res) {
  // SEC-02: CORS + rate limit + auth
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  if (!checkRateLimit(req, res, 30, 60000)) return;
  if (!validateInternalToken(req, res)) return;

  const { type, provider } = req.body || {};

  try {
    // ── Test WA (Fonnte) ──
    if (type === "wa") {
      const token = process.env.FONNTE_TOKEN;
      if (!token) return res.json({ success: false, message: "❌ FONNTE_TOKEN belum diset di Vercel env vars" });

      const r = await fetch("https://api.fonnte.com/validate", {
        method: "POST",
        headers: { "Authorization": token }
      });
      const d = await r.json().catch(() => ({}));
      if (d.status === true) {
        return res.json({ success: true, message: `✅ WhatsApp terhubung — ${d.target || d.name || "device aktif"}` });
      } else {
        const reason = d.reason || d.message || "Token tidak valid atau device offline";
        return res.json({ success: false, message: `❌ Fonnte: ${reason}` });
      }
    }

    // ── Test LLM ──
    if (type === "llm") {
      const prov = provider || "gemini";

      if (prov === "claude") {
        if (!process.env.ANTHROPIC_API_KEY)
          return res.json({ success: false, message: "❌ ANTHROPIC_API_KEY belum diset" });
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 5, messages: [{ role: "user", content: "hi" }] })
        });
        const d = await r.json().catch(() => ({}));
        return res.json(r.ok
          ? { success: true,  message: "✅ Claude terhubung" }
          : { success: false, message: "❌ Claude: " + (d.error?.message || r.status) });
      }

      if (prov === "gemini") {
        if (!process.env.GEMINI_API_KEY)
          return res.json({ success: false, message: "❌ GEMINI_API_KEY belum diset" });
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const d = await r.json().catch(() => ({}));
        return res.json(r.ok
          ? { success: true,  message: "✅ Gemini terhubung" }
          : { success: false, message: "❌ Gemini key tidak valid: " + (d.error?.message || r.status) });
      }

      if (prov === "openai") {
        if (!process.env.OPENAI_API_KEY)
          return res.json({ success: false, message: "❌ OPENAI_API_KEY belum diset" });
        const r = await fetch("https://api.openai.com/v1/models", {
          headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` }
        });
        return res.json(r.ok
          ? { success: true,  message: "✅ OpenAI terhubung" }
          : { success: false, message: "❌ OpenAI key tidak valid" });
      }

      if (prov === "groq") {
        if (!process.env.GROQ_API_KEY)
          return res.json({ success: false, message: "❌ GROQ_API_KEY belum diset" });
        const r = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}` }
        });
        return res.json(r.ok
          ? { success: true,  message: "✅ Groq terhubung" }
          : { success: false, message: "❌ Groq key tidak valid" });
      }

      return res.json({ success: false, message: "Provider tidak dikenal: " + prov });
    }

    // ── Test Storage (R2) ──
    if (type === "storage") {
      const acctId = (process.env.R2_ACCOUNT_ID || "").trim();
      const accKey = (process.env.R2_ACCESS_KEY  || "").trim();
      const secKey = (process.env.R2_SECRET_KEY  || "").trim();
      const bucket = (process.env.R2_BUCKET_NAME || "aclean-files").trim();
      if (!acctId || !accKey || !secKey)
        return res.json({ success: false, message: "❌ R2 credentials belum lengkap di Vercel env" });
      const { dts, ph, auth } = await awsSign({ method: "GET", bucket, key: "", acctId, accKey, secKey });
      const r = await fetch(`https://${acctId}.r2.cloudflarestorage.com/${bucket}`, {
        headers: { "x-amz-content-sha256": ph, "x-amz-date": dts, "Authorization": auth }
      });
      return res.json(r.ok
        ? { success: true,  message: `✅ R2 terhubung — bucket: ${bucket}` }
        : { success: false, message: `❌ R2 error ${r.status} — cek credentials` });
    }

    // ── Test Database (Supabase) ──
    if (type === "db") {
      const url = process.env.VITE_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_KEY;
      if (!url || !key)
        return res.json({ success: false, message: "❌ SUPABASE_URL atau SERVICE_KEY belum diset" });
      const sb = createClient(url, key);
      const { count, error } = await sb.from("orders").select("*", { count: "exact", head: true });
      return res.json(error
        ? { success: false, message: "❌ Supabase: " + error.message }
        : { success: true,  message: `✅ Supabase terhubung — ${count} orders` });
    }

    return res.json({ success: false, message: "type tidak dikenal: " + type });

  } catch(err) {
    console.error("test-connection error:", err.message);
    return res.status(500).json({ success: false, message: "❌ Error: " + err.message });
  }
}
