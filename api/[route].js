// api/[route].js - AClean Unified API Router
import { setCorsHeaders, checkRateLimit, validateInternalToken } from "./_auth.js";
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };
const PUBLIC_ROUTES = ["receive-wa", "test-connection", "_auth", "foto", "get-llm-config", "upload-foto"];

// ── VALIDATION HELPERS ──
function validateAndNormalizePhone(phone) {
  if (!phone) return null;
  let normalized = String(phone).replace(/[^0-9+]/g, "");
  if (normalized.startsWith("+62")) normalized = normalized.substring(1);
  if (normalized.startsWith("0")) normalized = "62" + normalized.substring(1);
  if (!normalized.startsWith("62")) normalized = "62" + normalized;

  // Must be valid Indonesian phone: 62 + 9-12 digits (total 11-14 digits)
  if (!/^62\d{9,12}$/.test(normalized)) return null;
  return normalized;
}

function validateMessage(msg, maxLen = 4096) {
  if (!msg || typeof msg !== "string") return null;
  const trimmed = msg.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) return null;
  return trimmed;
}

function sanitizeName(s) {
  return (s||"").replace(/[\r\n\t]/g, " ").slice(0, 100);
}

export default async function handler(req, res) {
  const route = String(req.query.route || "");
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!PUBLIC_ROUTES.includes(route)) {
    const authOk = validateInternalToken(req, res);
    if (!authOk) return; // validateInternalToken sudah kirim response 401/500
  }

  try {

    // ── SEND-WA ──
    if (route === "send-wa") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const b = req.body || {};

      // ── VALIDATION: Phone number ──
      const target = validateAndNormalizePhone(b.phone);
      if (!target) return res.status(400).json({ error: "Invalid phone number format" });

      // ── VALIDATION: Message ──
      const msg = validateMessage(b.message, 4096);
      if (!msg) return res.status(400).json({ error: "Message is required and must be 1-4096 characters" });

      const FT = process.env.FONNTE_TOKEN;
      if (!FT) return res.status(500).json({ error: "FONNTE_TOKEN belum diset", detail: "FONNTE_TOKEN_NOT_SET" });

      // ── ATTACHMENT: Fonnte Premium supports sending file via url field ──
      // b.url = publicly accessible file URL (PDF, image, etc)
      // b.filename = optional display filename
      const payload = { target, message: msg, delay: "2", countryCode: "62" };
      if (b.url && typeof b.url === "string" && b.url.startsWith("http")) {
        payload.url = b.url;
        if (b.filename) payload.filename = String(b.filename).slice(0, 100);
      }

      const r = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: { "Authorization": FT, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.status === false) return res.status(502).json({ success: false, error: d.reason || "Fonnte error" });
      return res.status(200).json({ success: true, target, withAttachment: !!b.url });
    }

    // ── RECEIVE-WA (public) ──
    if (route === "receive-wa") {
      if (req.method === "GET") return res.status(200).json({ status: "ok", service: "AClean WA Webhook" });
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      if (!await checkRateLimit(req, res, 60, 60000)) return;
      const wb = req.body || {};

      // ── VALIDATION: Phone number ──
      const sender = validateAndNormalizePhone(wb.sender);
      if (!sender) return res.status(400).json({ error: "Invalid phone number format" });

      // ── VALIDATION: Message length & content ──
      const message = validateMessage(wb.message, 4096);
      if (!message) return res.status(400).json({ error: "Message is required and must be 1-4096 characters" });

      // ── VALIDATION: Group message check ──
      if (wb.isGroup === true || wb.isGroup === "true") return res.status(200).json({ status: "skipped" });

      const FT = process.env.FONNTE_TOKEN;
      const OP = process.env.OWNER_PHONE;
      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;

      // Read toggles
      let autoOn = process.env.AUTOREPLY_ENABLED === "true";
      let fwdOn  = process.env.FORWARD_TO_OWNER !== "false";
      if (SU && SK) {
        try {
          const sR = await fetch(
            SU + "/rest/v1/app_settings?select=key,value&key=in.(wa_autoreply_enabled,wa_forward_to_owner)",
            { headers: { apikey: SK, Authorization: "Bearer " + SK } }
          );
          if (sR.ok) {
            const sArr = await sR.json();
            const sMap = Object.fromEntries((sArr||[]).map(s => [s.key, s.value]));
            if (sMap.wa_autoreply_enabled !== undefined) autoOn = sMap.wa_autoreply_enabled === "true";
            if (sMap.wa_forward_to_owner  !== undefined) fwdOn  = sMap.wa_forward_to_owner  !== "false";
          }
        } catch(sErr) {
          console.warn("[receive-wa] settings fetch failed, using defaults:", sErr.message);
        }
      }

      const nowIso = new Date().toISOString();
      const senderName = sanitizeName(wb.name || ("+" + sender));

      // ── Save inbound message ke wa_messages (schema: phone,name,content,role,created_at) ──
      if (SU && SK) fetch(SU + "/rest/v1/wa_messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
        body: JSON.stringify({ phone: sender, name: senderName, content: message, role: "customer", created_at: nowIso })
      }).catch(err => console.error("[WA_MSG_SAVE]", err.message));

      // ── Upsert wa_conversations (phone unik, increment unread, update last) ──
      if (SU && SK) {
        // Fetch existing unread count, then upsert
        fetch(SU + "/rest/v1/wa_conversations?phone=eq." + encodeURIComponent(sender) + "&select=unread", {
          headers: { apikey: SK, Authorization: "Bearer " + SK }
        }).then(r => r.json()).then(rows => {
          const prevUnread = (rows?.[0]?.unread) || 0;
          return fetch(SU + "/rest/v1/wa_conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify({ phone: sender, name: senderName, last: message.slice(0, 80), updated_at: nowIso, unread: prevUnread + 1 })
          });
        }).catch(err => console.error("[WA_CONV_UPSERT]", err.message));
      }

      // Auto-reply
      const ml = message.toLowerCase().trim();
      let reply = null;
      if (autoOn) {
        const SALAM = ["halo","hi","hello","hai","pagi","siang","sore","malam","selamat","assalamu","permisi"];
        const HARGA_KW = ["harga","tarif","biaya","berapa","rate","pricelist","price","harganya"];
        const ORDER_KW = ["order","pesan","booking","buat","jadwal","service","cuci","cleaning","install","pasang","perbaikan","repair","complain","garansi","bongkar"];
        const STATUS_KW = ["status","cek order","cek jadwal","kapan","sudah","selesai","belum","progress"];
        const BAYAR_KW  = ["bayar","transfer","lunas","pembayaran","invoice","tagihan","dp","uang"];
        const LOKASI_KW = ["alamat","lokasi","dimana","area","jangkauan","coverage","bisa ke"];

        if (SALAM.some(k => ml.startsWith(k) || ml.includes(k + " ")))
          reply = "Halo! 👋 Selamat datang di *AClean Service AC*.\n\nKami melayani:\n✅ Cuci/Service AC\n✅ Perbaikan & Isi Freon\n✅ Pasang AC Baru\n✅ Bongkar & Pindah AC\n\nKetik *HARGA* untuk info tarif, atau *ORDER* untuk pesan layanan. Ada yang bisa kami bantu? 😊";
        else if (HARGA_KW.some(k => ml.includes(k))) {
          try {
            const pR = await fetch(SU + "/rest/v1/harga_layanan?select=service,type,harga&order=service.asc,type.asc", {
              headers: { apikey: SK, Authorization: "Bearer " + SK }
            });
            if (pR.ok) {
              const prices = await pR.json();
              if (prices && prices.length > 0) {
                const priceText = prices.map(p => `  • ${p.service} ${p.type}: Rp${(p.harga||0).toLocaleString("id-ID")}`).join("\n");
                reply = `💰 *Harga AClean Service AC*\n\n${priceText}\n\nKetik *ORDER* untuk pesan! 😊\n\n_Jam operasional: 08.00–17.00 WIB_`;
              } else {
                reply = "💰 *Harga AClean Service AC*\n\nUntuk info harga terbaru, hubungi admin kami.\n\nAdmin akan segera membalas! 😊";
              }
            } else {
              reply = "💰 *Harga AClean Service AC*\n\nUntuk info harga terbaru, hubungi admin kami.\n\nAdmin akan segera membalas! 😊";
            }
          } catch(_) {
            reply = "💰 *Harga AClean Service AC*\n\nUntuk info harga terbaru, hubungi admin kami.\n\nAdmin akan segera membalas! 😊";
          }
        }
        else if (LOKASI_KW.some(k => ml.includes(k)))
          reply = "📍 *Area Layanan AClean*\n\nKami melayani area:\nAlam Sutera • BSD • Gading Serpong • Graha Raya • Karawaci • Tangerang Selatan\n\nArea lain: ada biaya transport tambahan.\n\nKetik *ORDER* untuk pesan layanan! 😊";
        else if (ORDER_KW.some(k => ml.includes(k)) || ml === "order")
          reply = "📋 *Pesan Layanan AClean*\n\nSilakan kirim info berikut:\n1️⃣ Nama lengkap\n2️⃣ Alamat lengkap\n3️⃣ Jenis layanan (Cuci AC / Perbaikan / Pasang / dll)\n4️⃣ Jumlah unit AC\n5️⃣ Tanggal & jam yang diinginkan\n\nAdmin akan konfirmasi jadwal & harga segera! ⚡";
        else if (STATUS_KW.some(k => ml.includes(k)))
          reply = "🔍 Untuk cek status order, sebutkan *nama* dan *nomor order* atau nomor HP yang didaftarkan.\n\nAdmin akan segera membantu! 😊";
        else if (BAYAR_KW.some(k => ml.includes(k)))
          reply = "💳 *Info Pembayaran AClean*\n\nSetelah transfer, kirim bukti pembayaran beserta:\n📌 Nama & nomor order\n💰 Nominal transfer\n\nAdmin konfirmasi dalam 30 menit. Terima kasih! 🙏";

        if (reply && FT) {
          fetch("https://api.fonnte.com/send", {
            method: "POST",
            headers: { Authorization: FT, "Content-Type": "application/json" },
            body: JSON.stringify({ target: sender, message: reply, delay: "1", countryCode: "62" })
          }).catch(err => console.error("[WA_AUTO_REPLY_FAILED]", err.message));
          // Simpan auto-reply ke wa_messages
          if (SU && SK) fetch(SU + "/rest/v1/wa_messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
            body: JSON.stringify({ phone: sender, name: "ARA", content: reply, role: "ara", created_at: new Date().toISOString() })
          }).catch(() => {});
        }
      }

      // Forward ke Owner — hanya jika toggle ON, pesan tidak di-auto-reply,
      // dan pesan bukan dari Owner itu sendiri (cegah loop)
      if (!reply && fwdOn && FT && OP && sender !== OP.replace(/^0/, "62").replace(/[^0-9]/g, "")) {
        const fwdMsg = "📲 *WA Masuk*\nDari: " + senderName + " (" + sender + ")\nPesan: " + message + "\n\n_Balas langsung di app WA Monitor_";
        fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: { Authorization: FT, "Content-Type": "application/json" },
          body: JSON.stringify({ target: OP, message: fwdMsg, delay: "2", countryCode: "62" })
        }).catch(err => console.error("[WA_FORWARD_FAILED]", err.message));
      }

      return res.status(200).json({ status: "ok", sender, autoreply: autoOn, replied: !!reply, forwarded: !reply && fwdOn });
    }

    // ── ARA-CHAT ──
    if (route === "ara-chat") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const { messages, bizContext, brainMd, provider, model, ollamaUrl, imageData, imageType } = req.body || {};
      if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages array wajib" });

      console.log("[ROUTE.JS ara-chat] Received:", { provider, model, hasMessages: messages.length });
      const sysP = (brainMd || "Kamu adalah ARA, asisten AI untuk AClean Service AC.") +
        (bizContext ? "\n\n## DATA BISNIS LIVE\n" + JSON.stringify(bizContext) : "");
      const prov = provider || "claude";
      console.log("[ROUTE.JS ara-chat] Provider detection: requested=", provider, "=> using=", prov);

      if (prov === "claude" || prov === "anthropic") {
        const AK = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
        if (!AK) return res.status(500).json({ error: "LLM_API_KEY belum diset di Vercel Environment Variables" });
        const mdl = model || process.env.LLM_MODEL || "claude-sonnet-4-6";
        const cMsgs = messages.map((m, i) => {
          const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
          if (i === messages.length-1 && imageData && m.role === "user")
            return { role: "user", content: [{ type: "image", source: { type: "base64", media_type: imageType||"image/jpeg", data: imageData }},{ type: "text", text: c }]};
          return { role: m.role, content: c };
        });
        const cr = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": AK, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: mdl, max_tokens: 2048, system: sysP, messages: cMsgs })
        });
        const cd = await cr.json();
        if (!cr.ok) return res.status(502).json({ error: (cd.error && cd.error.message) || "Claude API error" });
        return res.status(200).json({ reply: (cd.content||[]).map(c => c.text||"").join(""), model: mdl, provider: "claude" });
      }

      if (prov === "minimax") {
        const MK = process.env.MINIMAX_API_KEY || process.env.LLM_API_KEY;
        if (!MK) return res.status(500).json({ error: "MINIMAX_API_KEY belum diset" });
        // Support Minimax 2.5, 2.7-highspeed
        const mm = model || process.env.MINIMAX_MODEL || "MiniMax-M2.5";
        const mg = process.env.MINIMAX_GROUP_ID || "";

        try {
          const mmPayload = {
            model: mm, max_tokens: 2048,
            messages: [{ role:"system", content: sysP }, ...messages.map(m=>({ role:m.role, content:typeof m.content==="string"?m.content:JSON.stringify(m.content) }))],
          };
          if (mg) mmPayload.group_id = mg;

          const mr = await fetch("https://api.minimaxi.chat/v1/text/chatcompletion_v2", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + MK },
            body: JSON.stringify(mmPayload)
          });
          const md = await mr.json();

          if (!mr.ok) {
            const errMsg = md.base_resp?.status_msg || md.error?.message || "Minimax API error";
            console.error(`Minimax error (${mm}):`, errMsg, "Status:", mr.status);
            return res.status(502).json({ error: errMsg, detail: md, model: mm });
          }

          const reply = md.choices?.[0]?.message?.content || "";
          if (!reply) {
            console.warn("Minimax returned empty reply:", md);
            return res.status(502).json({ error: "Minimax returned empty response", model: mm });
          }

          return res.status(200).json({ reply, model: mm, provider: "minimax" });
        } catch(e) {
          console.error("Minimax request error:", e.message);
          return res.status(502).json({ error: "Minimax request failed: " + e.message, model: mm });
        }
      }

      if (prov === "ollama") {
        const bu = ollamaUrl || "http://localhost:11434";
        const om = model || "llama3.1";
        const or = await fetch(bu + "/api/chat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: om, stream: false, messages: [{ role:"system", content:sysP }, ...messages.map(m=>({ role:m.role, content:m.content }))] })
        });
        const od = await or.json();
        return res.status(200).json({ reply: (od.message&&od.message.content)||"", model: om, provider: "ollama" });
      }

      return res.status(400).json({ error: "Provider tidak didukung: " + prov });
    }

    // ── TEST-CONNECTION (public) ──
    if (route === "test-connection") {
      const type = (req.query&&req.query.type) || (req.body&&req.body.type) || "";

      if (type === "wa" || type === "fonnte") {
        // Use token from request body (user testing) or env var
        const rb = req.body || {};
        const FT = rb.token || process.env.FONNTE_TOKEN;
        if (!FT) return res.status(200).json({ ok: false, success: false, error: "FONNTE_TOKEN belum diset" });
        try {
          const r = await fetch("https://api.fonnte.com/validate", { method:"POST", headers:{ Authorization:FT, "Content-Type":"application/json" }, body:JSON.stringify({}) });
          const d = await r.json().catch(()=>({}));
          const isOk = r.ok && d.status !== false;
          // Return both `ok` and `success` for compatibility
          return res.status(200).json({ ok: isOk, success: isOk, message: isOk ? "Fonnte terhubung" : (d.reason || "Gagal terkoneksi"), detail: d });
        } catch(e) { return res.status(200).json({ ok: false, success: false, error: e.message }); }
      }

      if (type === "storage" || type === "r2") {
        const CA=process.env.CLOUDFLARE_ACCOUNT_ID, CT=process.env.CLOUDFLARE_API_TOKEN, CB=process.env.R2_BUCKET_NAME||"aclean-fotos";
        if (!CA||!CT) return res.status(200).json({ ok:false, error:"Cloudflare env vars tidak diset" });
        try {
          const r = await fetch("https://api.cloudflare.com/client/v4/accounts/"+CA+"/r2/buckets/"+CB, { headers:{ Authorization:"Bearer "+CT } });
          const d = await r.json().catch(()=>({}));
          return res.status(200).json({ ok: r.ok && d.success, detail: d });
        } catch(e) { return res.status(200).json({ ok:false, error:e.message }); }
      }

      if (type === "llm" || type === "claude") {
        const AK = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
        if (!AK) return res.status(200).json({ ok: false, error: "LLM_API_KEY tidak diset" });
        try {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method:"POST", headers:{ "Content-Type":"application/json", "x-api-key":AK, "anthropic-version":"2023-06-01" },
            body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:10, messages:[{ role:"user", content:"ping" }] })
          });
          const d = await r.json().catch(()=>({}));
          return res.status(200).json({ ok: r.ok, provider: "claude", model: d.model||null, error: (d.error&&d.error.message)||null });
        } catch(e) { return res.status(200).json({ ok:false, provider: "claude", error:e.message }); }
      }

      if (type === "minimax") {
        const MK = process.env.MINIMAX_API_KEY;
        if (!MK) return res.status(200).json({ ok: false, error: "MINIMAX_API_KEY tidak diset di env" });
        try {
          const mm = process.env.MINIMAX_MODEL || "MiniMax-M2.5";
          const r = await fetch("https://api.minimaxi.chat/v1/text/chatcompletion_v2", {
            method:"POST",
            headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+MK },
            body: JSON.stringify({ model: mm, max_tokens: 10, messages: [{ role:"system", content:"Respond with 'OK'" }, { role:"user", content:"ping" }] })
          });
          const d = await r.json().catch(()=>({}));
          const hasReply = d.choices?.[0]?.message?.content || d.reply || null;
          return res.status(200).json({ ok: r.ok && !!hasReply, provider: "minimax", model: mm, error: (d.base_resp?.status_msg||d.error?.message)||null, raw: !r.ok?d:null });
        } catch(e) { return res.status(200).json({ ok:false, provider: "minimax", error:e.message }); }
      }

      if (type === "groq") {
        const GK = process.env.GROQ_API_KEY;
        if (!GK) return res.status(200).json({ ok: false, error: "GROQ_API_KEY tidak diset di env" });
        try {
          const gm = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
          const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method:"POST",
            headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+GK },
            body: JSON.stringify({ model: gm, max_tokens: 10, messages: [{ role:"system", content:"Respond with 'OK'" }, { role:"user", content:"ping" }] })
          });
          const d = await r.json().catch(()=>({}));
          const hasReply = d.choices?.[0]?.message?.content || null;
          return res.status(200).json({ ok: r.ok && !!hasReply, provider: "groq", model: gm, error: (d.error?.message)||null });
        } catch(e) { return res.status(200).json({ ok:false, provider: "groq", error:e.message }); }
      }

      return res.status(200).json({
        ok: true, success: true, service: "AClean API",
        env: { fonnte: !!process.env.FONNTE_TOKEN, llm_key: !!process.env.LLM_API_KEY, minimax: !!process.env.MINIMAX_API_KEY, groq: !!process.env.GROQ_API_KEY, cloudflare: !!process.env.CLOUDFLARE_API_TOKEN, owner_phone: !!process.env.OWNER_PHONE, supabase: !!process.env.SUPABASE_SERVICE_KEY }
      });
    }

    // ── UPLOAD-FOTO ──
    if (route === "upload-foto") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const body = req.body || {};

      // App.jsx mengirim: { base64, filename, reportId, mimeType }
      const rawData  = body.base64 || body.fileData || "";
      const fileName = body.filename || body.fileName || ("foto_" + Date.now() + ".jpg");
      const mimeType = body.mimeType || body.fileType || "image/jpeg";
      const folder   = body.reportId ? ("laporan/" + body.reportId) : (body.folder || "laporan");

      if (!rawData) {
        console.error("[upload-foto] body kosong. Fields:", Object.keys(body));
        return res.status(400).json({ error: "Tidak ada data foto", fields_received: Object.keys(body) });
      }

      // Strip "data:image/jpeg;base64," prefix jika ada
      let base64Data = rawData;
      if (rawData.startsWith("data:")) base64Data = rawData.split(",")[1] || "";
      if (!base64Data) return res.status(400).json({ error: "base64 kosong setelah strip prefix" });

      // ── Cloudflare R2 via S3-compatible API (AWS Sig V4) ──
      const accessKeyId     = process.env.R2_ACCESS_KEY;
      const secretAccessKey = process.env.R2_SECRET_KEY;
      const accountId       = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
      const bucket          = process.env.R2_BUCKET_NAME || "aclean-files";
      const publicUrl       = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

      if (!accessKeyId || !secretAccessKey || !accountId) {
        console.error("[upload-foto] Missing R2 env vars:", {
          has_access_key: !!accessKeyId,
          has_secret_key: !!secretAccessKey,
          has_account_id: !!accountId,
        });
        return res.status(500).json({
          error: "R2 credentials belum lengkap di Vercel. Butuh: R2_ACCESS_KEY, R2_SECRET_KEY, R2_ACCOUNT_ID",
          env_check: { has_access_key: !!accessKeyId, has_secret_key: !!secretAccessKey, has_account_id: !!accountId }
        });
      }

      const ts   = Date.now();
      const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      // Jika hash dikirim dari client, gunakan sebagai nama file → idempotent
      // Upload foto yang sama = overwrite file yang sama di R2, tidak bikin duplikat
      const clientHash = body.hash || "";
      const key = clientHash
        ? folder + "/" + clientHash + ".jpg"          // deterministic key dari hash
        : folder + "/" + ts + "_" + safe;             // fallback: timestamp_filename
      const host = accountId + ".r2.cloudflarestorage.com";
      const endpoint = "https://" + host + "/" + bucket + "/" + key;

      try {
        const imgBuffer = Buffer.from(base64Data, "base64");
        console.log("[upload-foto] Uploading to R2 S3:", key, imgBuffer.length, "bytes");

        // AWS Signature V4 signing (manual, no SDK needed)
        const crypto = await import("crypto");
        const now    = new Date();
        const dateStr  = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);   // YYYYMMDD
        const timeStr  = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15);  // YYYYMMDDTHHmmss + Z
        const amzDate  = timeStr + "Z";
        const region   = "auto";
        const service  = "s3";

        // Hash of payload
        const payloadHash = crypto.createHash("sha256").update(imgBuffer).digest("hex");

        // Canonical request
        const canonicalHeaders = "content-type:" + mimeType + "\n" +
          "host:" + host + "\n" +
          "x-amz-content-sha256:" + payloadHash + "\n" +
          "x-amz-date:" + amzDate + "\n";
        const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
        const canonicalUri  = "/" + bucket + "/" + encodeURIComponent(key).replace(/%2F/g, "/");
        const canonicalReq  = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

        // String to sign
        const credScope   = dateStr + "/" + region + "/" + service + "/aws4_request";
        const reqHash     = crypto.createHash("sha256").update(canonicalReq).digest("hex");
        const strToSign   = ["AWS4-HMAC-SHA256", amzDate, credScope, reqHash].join("\n");

        // Signing key
        const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
        const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, dateStr), region), service), "aws4_request");
        const signature  = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");

        // Authorization header
        const authorization = "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + credScope +
          ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;

        const r2res = await fetch(endpoint, {
          method: "PUT",
          headers: {
            "Authorization":        authorization,
            "Content-Type":         mimeType,
            "x-amz-date":           amzDate,
            "x-amz-content-sha256": payloadHash,
            "Content-Length":       String(imgBuffer.length),
          },
          body: imgBuffer,
        });

        if (!r2res.ok) {
          const errBody = await r2res.text();
          console.error("[upload-foto] R2 PUT failed:", r2res.status, errBody);
          return res.status(502).json({
            success: false,
            error: "R2 upload gagal (" + r2res.status + "): " + errBody.slice(0, 300),
          });
        }

        // Build public URL
        const finalUrl = publicUrl
          ? publicUrl + "/" + key
          : "https://" + host + "/" + bucket + "/" + key;

        console.log("[upload-foto] Success:", finalUrl);
        return res.status(200).json({
          success: true,
          url:     finalUrl,
          key:     key,
          bucket:  bucket,
          size:    imgBuffer.length,
        });

      } catch (err) {
        console.error("[upload-foto] Exception:", err.message, err.stack);
        return res.status(500).json({ success: false, error: "Server error: " + err.message });
      }
    }

        // ── FOTO PROXY: serve R2 images via server (bypass CORS & auth) ──
    if (route === "foto") {
      const key = req.query?.key || (req.body?.key) || "";
      if (!key) return res.status(400).json({ error: "key wajib" });

      const accessKeyId     = process.env.R2_ACCESS_KEY;
      const secretAccessKey = process.env.R2_SECRET_KEY;
      const accountId       = process.env.R2_ACCOUNT_ID;
      const bucket          = process.env.R2_BUCKET_NAME || "aclean-files";

      // Selalu serve via AWS Sig V4 (tidak redirect ke public URL)
      // karena R2 public access mungkin belum diaktifkan
      if (!accessKeyId || !secretAccessKey || !accountId) {
        return res.status(503).json({ error: "R2 credentials tidak tersedia" });
      }

      const crypto  = await import("crypto");
      const host    = accountId + ".r2.cloudflarestorage.com";
      const now     = new Date();
      const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
      const region  = "auto";
      const service = "s3";
      const payloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // empty body

      const canonicalUri  = "/" + bucket + "/" + key;
      const canonicalHeaders = "host:" + host + "\n" +
        "x-amz-content-sha256:" + payloadHash + "\n" +
        "x-amz-date:" + amzDate + "\n";
      const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
      const canonicalReq  = ["GET", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

      const credScope = dateStr + "/" + region + "/" + service + "/aws4_request";
      const reqHash   = crypto.createHash("sha256").update(canonicalReq).digest("hex");
      const strToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, reqHash].join("\n");

      const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
      const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, dateStr), region), service), "aws4_request");
      const signature  = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");
      const authorization = "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + credScope +
        ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;

      try {
        const r2res = await fetch("https://" + host + canonicalUri, {
          headers: {
            "Authorization": authorization,
            "x-amz-date": amzDate,
            "x-amz-content-sha256": payloadHash,
          },
        });
        if (!r2res.ok) return res.status(r2res.status).json({ error: "Foto tidak ditemukan" });
        const ct = r2res.headers.get("content-type") || "image/jpeg";
        res.setHeader("Content-Type", ct);
        res.setHeader("Cache-Control", "public, max-age=86400");
        const buf = await r2res.arrayBuffer();
        return res.status(200).send(Buffer.from(buf));
      } catch (err) {
        return res.status(500).json({ error: "Gagal fetch foto: " + err.message });
      }
    }

        // ── MONITORING: Get health metrics and recent errors ──
    if (route === "monitor") {
      if (req.method !== "GET") return res.status(405).json({error: "Method not allowed"});
      const SU=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, SK=process.env.SUPABASE_SERVICE_KEY;
      if (!SU||!SK) return res.status(200).json({ status: "limited", message: "Supabase not configured" });

      try {
        // Get recent errors and warnings from agent_logs (last 24 hours)
        const since24h = new Date(Date.now() - 24*60*60*1000).toISOString();
        // Status values: SUCCESS, WARNING, ERROR
        const response = await fetch(SU+"/rest/v1/agent_logs?select=action,status,detail,created_at&or=(status.eq.ERROR,status.eq.WARNING)&created_at=gte."+encodeURIComponent(since24h)+"&order=created_at.desc&limit=100", {
          headers: { apikey: SK, Authorization: "Bearer " + SK }
        });
        const logs = response.ok ? await response.json() : [];

        // Calculate metrics
        const logsArray = Array.isArray(logs) ? logs : [];
        const errorCount = logsArray.filter(l => l.status === "ERROR").length;
        const warningCount = logsArray.filter(l => l.status === "WARNING").length;
        const metrics = {
          totalErrors: errorCount,
          totalWarnings: warningCount,
          errorRate: logsArray.length > 0 ? errorCount / logsArray.length : 0,
          totalLogsChecked: logsArray.length,
          recentErrors: logsArray.slice(0, 10).map(l => ({
            action: l.action || "UNKNOWN",
            status: l.status || "UNKNOWN",
            detail: (l.detail || "").slice(0, 100),
            time: l.created_at || new Date().toISOString()
          }))
        };

        return res.status(200).json({
          status: "ok",
          timestamp: new Date().toISOString(),
          health: metrics.errorRate < 0.05 ? "healthy" : metrics.errorRate < 0.1 ? "degraded" : "unhealthy",
          metrics
        });
      } catch(err) {
        return res.status(200).json({
          status: "error",
          message: err.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    // ── GET-LLM-CONFIG (secure backend config endpoint) ──
    if (route === "get-llm-config") {
      if (req.method !== "GET") return res.status(405).json({error: "Method not allowed"});
      // ── Security: Only return safe config, never expose API keys ──
      // Determines which provider is available based on env vars
      const providers = [];
      if (process.env.ANTHROPIC_API_KEY) providers.push({name: "claude", label: "Claude (Anthropic)", disabled: false});
      if (process.env.OPENAI_API_KEY) providers.push({name: "openai", label: "OpenAI (GPT-4)", disabled: false});
      if (process.env.MINIMAX_API_KEY) providers.push({name: "minimax", label: "MiniMax 2.5", disabled: false});
      if (process.env.GROQ_API_KEY) providers.push({name: "groq", label: "Groq (Llama)", disabled: false});

      // Determine default provider based on what's actually available
      // Priority: claude > openai > minimax > groq > first available
      let defaultProvider = "minimax"; // fallback default
      if (process.env.ANTHROPIC_API_KEY) {
        defaultProvider = "claude";
      } else if (process.env.OPENAI_API_KEY) {
        defaultProvider = "openai";
      } else if (process.env.MINIMAX_API_KEY) {
        defaultProvider = "minimax";
      } else if (process.env.GROQ_API_KEY) {
        defaultProvider = "groq";
      }

      return res.status(200).json({
        providers,
        defaultProvider,
        message: "Use 'defaultProvider' to determine initial LLM choice"
      });
    }

    // ── CRON-REMINDER ──
    if (route === "cron-reminder") {
      const SU=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, SK=process.env.SUPABASE_SERVICE_KEY, FT=process.env.FONNTE_TOKEN;
      if (!SU||!SK||!FT) return res.status(200).json({ ok:false, error:"Env vars tidak lengkap" });
      const today = new Date().toISOString().slice(0,10);
      const invR = await fetch(SU+"/rest/v1/invoices?select=*&status=eq.UNPAID&due=lt."+today, { headers:{ apikey:SK, Authorization:"Bearer "+SK } });
      const invs = await invR.json().catch(err => {
        console.error("[CRON_INVOICE_FETCH_ERROR]", {error: err.message});
        return [];
      });
      let sent=0, updated=0;
      for (const inv of (invs||[])) {
        await fetch(SU+"/rest/v1/invoices?id=eq."+inv.id, { method:"PATCH", headers:{ "Content-Type":"application/json", apikey:SK, Authorization:"Bearer "+SK, Prefer:"return=minimal" }, body:JSON.stringify({ status:"OVERDUE" }) });
        updated++;
        if (inv.phone) {
          const np = String(inv.phone).replace(/^0/,"62").replace(/[^0-9]/g,"");
          await fetch("https://api.fonnte.com/send", { method:"POST", headers:{ Authorization:FT, "Content-Type":"application/json" }, body:JSON.stringify({ target:np, message:"Halo "+( inv.customer||"Bapak/Ibu")+", tagihan AClean Rp"+Number(inv.total||0).toLocaleString("id-ID")+" (Invoice "+inv.id+") sudah jatuh tempo. Mohon segera lakukan pembayaran.", delay:"3", countryCode:"62" }) }).catch(err => {
            console.error("[CRON_OVERDUE_REMINDER_FAILED]", {invoiceId: inv.id, customerPhone: np, error: err.message});
          });
          sent++;
        }
      }
      return res.status(200).json({ ok:true, overdue_found:(invs||[]).length, updated, reminders_sent:sent });
    }

    // ── SYNC-FOTOS: Auto-populate foto_urls from R2 files ──
    if (route === "sync-fotos") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

      const SU = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SU || !SK) return res.status(500).json({ error: "Supabase tidak configured" });

      const accessKeyId = process.env.R2_ACCESS_KEY;
      const secretAccessKey = process.env.R2_SECRET_KEY;
      const accountId = process.env.R2_ACCOUNT_ID;
      const bucket = process.env.R2_BUCKET_NAME || "aclean-files";
      if (!accessKeyId || !secretAccessKey || !accountId) {
        return res.status(500).json({ error: "R2 credentials tidak lengkap" });
      }

      try {
        // Step 1: Fetch laporan yang foto_urls kosong/null
        const lapRes = await fetch(SU + "/rest/v1/service_reports?select=id,job_id,foto_urls&foto_urls=is.null,eq.{}", {
          headers: { apikey: SK, Authorization: "Bearer " + SK }
        });
        const laporan = lapRes.ok ? await lapRes.json() : [];
        console.log(`[sync-fotos] Found ${laporan.length} laporan with empty foto_urls`);

        const crypto = await import("crypto");
        const synced = [];
        const errors = [];

        // Step 2: Untuk setiap laporan, list files di R2
        for (const lap of laporan) {
          try {
            const host = accountId + ".r2.cloudflarestorage.com";
            const now = new Date();
            const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
            const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
            const region = "auto";
            const service = "s3";
            const prefix = `laporan/${lap.job_id}/`;
            const payloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
            const canonicalUri = "/" + bucket + "/";
            const queryString = "list-type=2&prefix=" + encodeURIComponent(prefix);

            const canonicalHeaders = "host:" + host + "\n" + "x-amz-content-sha256:" + payloadHash + "\n" + "x-amz-date:" + amzDate + "\n";
            const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
            const canonicalReq = ["GET", canonicalUri, queryString, canonicalHeaders, signedHeaders, payloadHash].join("\n");

            const credScope = dateStr + "/" + region + "/" + service + "/aws4_request";
            const reqHash = crypto.createHash("sha256").update(canonicalReq).digest("hex");
            const strToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, reqHash].join("\n");

            const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
            const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, dateStr), region), service), "aws4_request");
            const signature = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");
            const authorization = "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + credScope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;

            // Query R2 list objects
            const r2Url = "https://" + host + "/" + bucket + "/?prefix=" + encodeURIComponent(prefix) + "&list-type=2";
            const r2res = await fetch(r2Url, {
              headers: { "Authorization": authorization, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash }
            });

            if (!r2res.ok) {
              errors.push({ job_id: lap.job_id, error: "R2 list failed: " + r2res.status });
              continue;
            }

            const xmlBody = await r2res.text();
            // Simple XML parsing: extract <Key> tags
            const keyRegex = /<Key>([^<]+)<\/Key>/g;
            const matches = [...xmlBody.matchAll(keyRegex)];
            const files = matches
              .map(m => m[1])
              .filter(k => k !== prefix) // Exclude folder itself
              .map(k => k.replace(prefix, "")); // Remove prefix, keep only filename

            console.log(`[sync-fotos] ${lap.job_id}: found ${files.length} files`);

            // Build foto_urls array with full paths
            const fotoUrls = files.map(f => prefix + f);

            // Update database
            const upRes = await fetch(SU + "/rest/v1/service_reports?id=eq." + lap.id, {
              method: "PATCH",
              headers: { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" },
              body: JSON.stringify({ foto_urls: fotoUrls })
            });

            if (upRes.ok) {
              synced.push({ job_id: lap.job_id, fotos: files.length });
            } else {
              const err = await upRes.text();
              errors.push({ job_id: lap.job_id, error: "Update failed: " + err.slice(0, 100) });
            }
          } catch (e) {
            errors.push({ job_id: lap.job_id, error: e.message });
          }
        }

        return res.status(200).json({
          ok: true,
          synced: synced.length,
          errors: errors.length,
          details: { synced, errors }
        });
      } catch (err) {
        console.error("[sync-fotos] Exception:", err.message);
        return res.status(500).json({ error: "Sync failed: " + err.message });
      }
    }

    return res.status(404).json({ error: "Route tidak ditemukan: /api/" + route });

  } catch(err) {
    console.error("[api/" + route + "] Error:", err.message);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
