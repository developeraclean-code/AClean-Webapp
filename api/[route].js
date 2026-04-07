// api/[route].js - AClean Unified API Router
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };
const PUBLIC_ROUTES = ["receive-wa", "test-connection", "_auth", "foto"];

export default async function handler(req, res) {
  const route = String(req.query.route || "");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Internal-Token, X-Api-Key, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.VITE_INTERNAL_API_SECRET || process.env.INTERNAL_API_SECRET;
  if (token && !PUBLIC_ROUTES.includes(route) && req.headers["x-internal-token"] !== token) {
    return res.status(401).json({ error: "Unauthorized", message: "Missing or invalid X-Internal-Token header" });
  }

  try {

    // ── SEND-WA ──
    if (route === "send-wa") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const b = req.body || {};
      if (!b.phone || !b.message) return res.status(400).json({ error: "phone dan message wajib" });
      const FT = process.env.FONNTE_TOKEN;
      if (!FT) return res.status(500).json({ error: "FONNTE_TOKEN belum diset", detail: "FONNTE_TOKEN_NOT_SET" });
      const target = String(b.phone).replace(/^0/, "62").replace(/[^0-9]/g, "");
      const r = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: { "Authorization": FT, "Content-Type": "application/json" },
        body: JSON.stringify({ target, message: b.message, delay: "2", countryCode: "62" })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.status === false) return res.status(502).json({ success: false, error: d.reason || "Fonnte error" });
      return res.status(200).json({ success: true, target });
    }

    // ── RECEIVE-WA (public) ──
    if (route === "receive-wa") {
      if (req.method === "GET") return res.status(200).json({ status: "ok", service: "AClean WA Webhook" });
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const wb = req.body || {};
      const sender = String(wb.sender || "").replace(/[^0-9]/g, "");
      const message = String(wb.message || "");
      if (!sender || !message || wb.isGroup === true || wb.isGroup === "true") return res.status(200).json({ status: "skipped" });

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
        } catch(_) {}
      }

      // Save to DB
      if (SU && SK) fetch(SU + "/rest/v1/wa_messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
        body: JSON.stringify({ sender, sender_name: wb.name||null, message, direction: "inbound", received_at: new Date().toISOString() })
      }).catch(()=>{});

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
          // Fetch dynamic price list from Supabase
          try {
            const pR = await fetch(SU + "/rest/v1/harga_layanan?select=service,type,harga&order=service.asc,type.asc", {
              headers: { apikey: SK, Authorization: "Bearer " + SK }
            });
            if (pR.ok) {
              const prices = await pR.json();
              if (prices && prices.length > 0) {
                const priceText = prices.map(p => `  • ${p.service} ${p.type}: Rp${(p.harga||0).toLocaleString("id-ID")}`).join("\n");
                reply = `💰 *Harga AClean Service AC*\n\n${priceText}\n\nCatatan: Biaya tambahan mungkin berlaku untuk area jauh atau layanan khusus.\n\nKetik *ORDER* untuk pesan! 😊\n\n_Jam operasional: 08.00–17.00 WIB_`;
              } else {
                reply = "💰 *Harga AClean Service AC*\n\nUntuk info harga terbaru & promo, silakan hubungi admin kami.\n\nAdmin akan segera membalas! 😊\n\n_Jam operasional: 08.00–17.00 WIB_";
              }
            } else {
              reply = "💰 *Harga AClean Service AC*\n\nUntuk info harga terbaru & promo, silakan hubungi admin kami.\n\nAdmin akan segera membalas! 😊\n\n_Jam operasional: 08.00–17.00 WIB_";
            }
          } catch(_) {
            reply = "💰 *Harga AClean Service AC*\n\nUntuk info harga terbaru & promo, silakan hubungi admin kami.\n\nAdmin akan segera membalas! 😊\n\n_Jam operasional: 08.00–17.00 WIB_";
          }
        }
        else if (LOKASI_KW.some(k => ml.includes(k)))
          reply = "📍 *Area Layanan AClean*\n\nKami melayani area:\nAlam Sutera • BSD • Gading Serpong • Graha Raya • Karawaci • Tangerang Selatan\n\nArea lain (Jakarta Barat/Selatan): ada biaya transport tambahan.\n\nKetik *ORDER* untuk pesan layanan! 😊";
        else if (ORDER_KW.some(k => ml.includes(k)) || ml === "order")
          reply = "📋 *Pesan Layanan AClean*\n\nSilakan kirim info berikut:\n1️⃣ Nama lengkap\n2️⃣ Alamat lengkap\n3️⃣ Jenis layanan (Cuci AC / Perbaikan / Pasang / dll)\n4️⃣ Jumlah unit AC\n5️⃣ Tanggal & jam yang diinginkan\n\nAdmin akan konfirmasi jadwal & harga segera! ⚡";
        else if (STATUS_KW.some(k => ml.includes(k)))
          reply = "🔍 Untuk cek status order, sebutkan *nama* dan *nomor order* (contoh: ORD-240401-XXX) atau nomor HP yang didaftarkan.\n\nAdmin akan segera membantu! 😊";
        else if (BAYAR_KW.some(k => ml.includes(k)))
          reply = "💳 *Info Pembayaran AClean*\n\nSetelah transfer, kirim bukti pembayaran ke sini beserta:\n📌 Nama & nomor order\n💰 Nominal transfer\n\nAdmin konfirmasi dalam 30 menit. Terima kasih! 🙏";

        if (reply && FT) fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: { Authorization: FT, "Content-Type": "application/json" },
          body: JSON.stringify({ target: sender, message: reply, delay: "1", countryCode: "62" })
        }).catch(()=>{});
      }

      // Forward to owner — only forward messages that were NOT auto-replied (customer needs attention)
      if (!reply && fwdOn && FT && OP) {
        const fwdMsg = "📲 WA Masuk\nDari: " + (wb.name||("+" + sender)) + "\nPesan: " + message;
        fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: { Authorization: FT, "Content-Type": "application/json" },
          body: JSON.stringify({ target: OP, message: fwdMsg, delay: "2", countryCode: "62" })
        }).catch(()=>{});
      }

      return res.status(200).json({ status: "ok", sender, autoreply: autoOn, replied: !!reply, forwarded: fwdOn });
    }

    // ── ARA-CHAT ──
    if (route === "ara-chat") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const { messages, bizContext, brainMd, provider, model, ollamaUrl, imageData, imageType } = req.body || {};
      if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages array wajib" });

      const sysP = (brainMd || "Kamu adalah ARA, asisten AI untuk AClean Service AC.") +
        (bizContext ? "\n\n## DATA BISNIS LIVE\n" + JSON.stringify(bizContext) : "");
      const prov = provider || "claude";

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

        // ── CRON-REMINDER ──
    if (route === "cron-reminder") {
      const SU=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, SK=process.env.SUPABASE_SERVICE_KEY, FT=process.env.FONNTE_TOKEN;
      if (!SU||!SK||!FT) return res.status(200).json({ ok:false, error:"Env vars tidak lengkap" });
      const today = new Date().toISOString().slice(0,10);
      const invR = await fetch(SU+"/rest/v1/invoices?select=*&status=eq.UNPAID&due=lt."+today, { headers:{ apikey:SK, Authorization:"Bearer "+SK } });
      const invs = await invR.json().catch(()=>[]);
      let sent=0, updated=0;
      for (const inv of (invs||[])) {
        await fetch(SU+"/rest/v1/invoices?id=eq."+inv.id, { method:"PATCH", headers:{ "Content-Type":"application/json", apikey:SK, Authorization:"Bearer "+SK, Prefer:"return=minimal" }, body:JSON.stringify({ status:"OVERDUE" }) });
        updated++;
        if (inv.phone) {
          const np = String(inv.phone).replace(/^0/,"62").replace(/[^0-9]/g,"");
          await fetch("https://api.fonnte.com/send", { method:"POST", headers:{ Authorization:FT, "Content-Type":"application/json" }, body:JSON.stringify({ target:np, message:"Halo "+( inv.customer||"Bapak/Ibu")+", tagihan AClean Rp"+Number(inv.total||0).toLocaleString("id-ID")+" (Invoice "+inv.id+") sudah jatuh tempo. Mohon segera lakukan pembayaran.", delay:"3", countryCode:"62" }) }).catch(()=>{});
          sent++;
        }
      }
      return res.status(200).json({ ok:true, overdue_found:(invs||[]).length, updated, reminders_sent:sent });
    }

    return res.status(404).json({ error: "Route tidak ditemukan: /api/" + route });

  } catch(err) {
    console.error("[api/" + route + "] Error:", err.message);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
