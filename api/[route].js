// api/[route].js — Unified API handler (1 Serverless Function)
// Menggantikan: send-wa.js, foto.js, upload-foto.js, webhook-fonnte.js, test-connection.js
// Routes:
//   POST /api/send-wa          { phone, message }
//   GET  /api/foto?key=...     proxy foto dari R2
//   POST /api/upload-foto      { base64, filename, reportId, mimeType? }
//   POST /api/webhook-fonnte   webhook WA masuk
//   POST /api/test-connection  { type, provider? }

import { createClient } from "@supabase/supabase-js";

// ── Helpers AWS4 Signature ──
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

  const canonHeaders = isUpload
    ? `content-type:${mimeType}\nx-amz-content-sha256:${ph}\nx-amz-date:${dts}\n`
    : `x-amz-content-sha256:${ph}\nx-amz-date:${dts}\n`;

  const canonUri     = `/${bucket}/${key}`;
  const canonRequest = [method, canonUri, "", canonHeaders, signedHeaders, ph].join("\n");
  const scope        = `${dshrt}/auto/s3/aws4_request`;
  const strToSign    = ["AWS4-HMAC-SHA256", dts, scope, hash(canonRequest)].join("\n");
  const signingKey   = hmac(hmac(hmac(hmac(`AWS4${secKey}`, dshrt), "auto"), "s3"), "aws4_request");
  const signature    = createHmac("sha256", signingKey).update(strToSign).digest("hex");
  const auth         = `AWS4-HMAC-SHA256 Credential=${accKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { dts, ph, auth, signedHeaders };
}

function r2Env() {
  return {
    acctId: (process.env.R2_ACCOUNT_ID || "").trim(),
    accKey: (process.env.R2_ACCESS_KEY  || "").trim(),
    secKey: (process.env.R2_SECRET_KEY  || "").trim(),
    bucket: (process.env.R2_BUCKET_NAME || "aclean-files").trim(),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const route = req.query.route;

  // ══════════════════════════════════════════════════
  // GET /api/foto?key=reports/ORD001/foto.jpg
  // ══════════════════════════════════════════════════
  if (route === "foto") {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: "key wajib" });

    const { acctId, accKey, secKey, bucket } = r2Env();
    if (!acctId || !accKey || !secKey)
      return res.status(500).json({ error: "R2 credentials tidak ada" });

    try {
      const { dts, ph, auth } = await awsSign({ method:"GET", bucket, key, acctId, accKey, secKey });
      const r2 = await fetch(`https://${acctId}.r2.cloudflarestorage.com/${bucket}/${key}`, {
        headers: { "x-amz-content-sha256": ph, "x-amz-date": dts, "Authorization": auth }
      });
      if (!r2.ok) return res.status(r2.status).json({ error: `R2 ${r2.status}` });
      const buf = await r2.arrayBuffer();
      res.setHeader("Content-Type", r2.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.status(200).send(Buffer.from(buf));
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  // ══════════════════════════════════════════════════
  // POST /api/upload-foto { base64, filename, reportId, mimeType? }
  // ══════════════════════════════════════════════════
  if (route === "upload-foto" && req.method === "POST") {
    const { base64, filename, reportId, mimeType = "image/jpeg" } = req.body || {};
    if (!base64 || !filename) return res.status(400).json({ error: "base64 dan filename wajib" });

    const { acctId, accKey, secKey, bucket } = r2Env();
    if (!acctId || !accKey || !secKey)
      return res.status(500).json({ error: "R2 credentials belum diset" });

    try {
      const raw = base64.replace(/^data:[^;]+;base64,/, "");
      const buf = Buffer.from(raw, "base64");
      if (buf.length === 0) return res.status(400).json({ error: "File kosong" });

      const safe   = (filename || "foto.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
      const folder = reportId ? `reports/${reportId}` : "uploads";
      const objKey = `${folder}/${Date.now()}_${safe}`;

      const { dts, ph, auth } = await awsSign({ method:"PUT", bucket, key:objKey, acctId, accKey, secKey, mimeType, buf });
      const r2 = await fetch(`https://${acctId}.r2.cloudflarestorage.com/${bucket}/${objKey}`, {
        method: "PUT",
        headers: { "Content-Type": mimeType, "x-amz-content-sha256": ph, "x-amz-date": dts, "Authorization": auth },
        body: buf,
      });

      if (!r2.ok) {
        const xml  = await r2.text();
        const code = (xml.match(/<Code>([^<]+)/)    || [])[1] || r2.status;
        const msg  = (xml.match(/<Message>([^<]+)/) || [])[1] || xml.slice(0, 200);
        return res.status(500).json({ success: false, error: `R2 ${code}: ${msg}` });
      }

      const fileUrl = `/api/foto?key=${encodeURIComponent(objKey)}`;
      return res.status(200).json({ success: true, url: fileUrl, key: objKey });
    } catch(err) { return res.status(500).json({ success: false, error: err.message }); }
  }

  // ══════════════════════════════════════════════════
  // POST /api/send-wa { phone, message }
  // ══════════════════════════════════════════════════
  if (route === "send-wa" && req.method === "POST") {
    const { phone, message } = req.body || {};
    if (!phone || !message) return res.status(400).json({ error: "phone dan message wajib" });

    const token = process.env.FONNTE_TOKEN;
    if (!token) return res.status(500).json({ error: "FONNTE_TOKEN belum diset" });

    try {
      const r = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: { "Authorization": token, "Content-Type": "application/json" },
        body: JSON.stringify({ target: phone, message, countryCode: "62", typing: true, delay: 1 }),
      });
      const data = await r.json();
      if (!r.ok || data.status === false)
        return res.status(500).json({ error: data.reason || "Gagal kirim WA", detail: data });
      return res.status(200).json({ success: true, data });
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  // ══════════════════════════════════════════════════
  // POST /api/webhook-fonnte — WA incoming webhook
  // ══════════════════════════════════════════════════
  if (route === "webhook-fonnte" && req.method === "POST") {
    try {
      const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const { sender, message, name } = req.body || {};
      if (!sender || !message) return res.status(400).json({ error: "Invalid payload" });

      const phone = sender.replace(/[^0-9]/g, "");
      const ml    = message.toLowerCase();
      let intent  = "UNKNOWN";
      if (/order|booking|servis|cleaning|pasang|install|perbaik|ac/.test(ml)) intent = "ORDER_NEW";
      else if (/transfer|bayar|payment|lunas|bukti/.test(ml))                 intent = "PAYMENT";
      else if (/komplain|masih|belum|rusak|panas|bocor|tidak dingin/.test(ml)) intent = "COMPLAINT";
      else if (/harga|berapa|info|tanya|jadwal|jam/.test(ml))                 intent = "FAQ";

      const { data: conv } = await sb.from("wa_conversations").select("id,unread").eq("phone", phone).single();
      let convId;
      if (conv) {
        convId = conv.id;
        await sb.from("wa_conversations").update({
          last_message: message.slice(0, 100),
          time: new Date().toLocaleTimeString("id-ID", { hour:"2-digit", minute:"2-digit" }),
          unread: (conv.unread || 0) + 1, intent,
          status: intent === "COMPLAINT" ? "ESCALATED" : "ACTIVE",
          updated_at: new Date().toISOString()
        }).eq("id", convId);
      } else {
        const { data: nc } = await sb.from("wa_conversations").insert({
          phone, name: name || phone,
          last_message: message.slice(0, 100),
          time: new Date().toLocaleTimeString("id-ID", { hour:"2-digit", minute:"2-digit" }),
          unread: 1, intent, status: "ACTIVE"
        }).select("id").single();
        convId = nc?.id;
      }
      if (convId) await sb.from("wa_messages").insert({ conversation_id: convId, role: "user", content: message });
      return res.status(200).json({ success: true });
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  // ══════════════════════════════════════════════════
  // POST /api/test-connection { type, provider? }
  // ══════════════════════════════════════════════════
  if (route === "test-connection" && req.method === "POST") {
    const { type, provider } = req.body || {};
    try {
      if (type === "wa") {
        const token = process.env.FONNTE_TOKEN;
        if (!token) return res.json({ success: false, message: "❌ FONNTE_TOKEN belum diset" });
        const r = await fetch("https://api.fonnte.com/validate", { method:"POST", headers:{ "Authorization": token } });
        const d = await r.json();
        return res.json(d.status === true
          ? { success: true,  message: `✅ WhatsApp terhubung — ${d.target || "nomor aktif"}` }
          : { success: false, message: "❌ Token tidak valid: " + (d.reason || "Unknown") });
      }

      if (type === "llm") {
        const prov = provider || "claude";
        if (prov === "claude") {
          if (!process.env.ANTHROPIC_API_KEY) return res.json({ success: false, message: "❌ ANTHROPIC_API_KEY belum diset" });
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method:"POST",
            headers:{ "Content-Type":"application/json", "x-api-key":process.env.ANTHROPIC_API_KEY, "anthropic-version":"2023-06-01" },
            body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:5, messages:[{ role:"user", content:"hi" }] })
          });
          const d = await r.json();
          return res.json(r.ok ? { success:true, message:"✅ Claude terhubung" } : { success:false, message:"❌ "+d.error?.message });
        }
        if (prov === "gemini") {
          if (!process.env.GEMINI_API_KEY) return res.json({ success:false, message:"❌ GEMINI_API_KEY belum diset" });
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
          return res.json(r.ok ? { success:true, message:"✅ Gemini terhubung" } : { success:false, message:"❌ Gemini key tidak valid" });
        }
        return res.json({ success:false, message:"Provider tidak dikenal: "+prov });
      }

      if (type === "storage") {
        const { acctId, accKey, secKey, bucket } = r2Env();
        if (!acctId || !accKey || !secKey) return res.json({ success:false, message:"❌ R2 credentials belum diset" });
        const { dts, ph, auth } = await awsSign({ method:"GET", bucket, key:"", acctId, accKey, secKey });
        const r = await fetch(`https://${acctId}.r2.cloudflarestorage.com/${bucket}`, {
          headers:{ "x-amz-content-sha256": ph, "x-amz-date": dts, "Authorization": auth }
        });
        return res.json(r.ok ? { success:true, message:`✅ R2 terhubung — bucket: ${bucket}` } : { success:false, message:`❌ R2 error ${r.status}` });
      }

      if (type === "db") {
        const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const { count, error } = await sb.from("orders").select("*", { count:"exact", head:true });
        return res.json(error ? { success:false, message:"❌ "+error.message } : { success:true, message:`✅ Supabase terhubung — ${count} orders` });
      }

      return res.status(400).json({ error: "type tidak valid" });
    } catch(err) { return res.status(500).json({ success:false, message:"Server error: "+err.message }); }
  }

  return res.status(404).json({ error: `Route '${route}' tidak ditemukan` });
}
