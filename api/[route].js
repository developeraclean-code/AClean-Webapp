// api/[route].js — Unified API router (Vercel Serverless)
// Semua /api/* route ditangani di sini untuk hemat kuota 20 function
// Route: /api/send-wa | /api/receive-wa | /api/ara-chat | /api/test-connection | /api/upload-foto | /api/auth/*

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

// ── Routes yang EXEMPT dari internal token check ──
// (external webhooks, browser direct access)
const PUBLIC_ROUTES = ["receive-wa", "test-connection", "_auth"];

export default async function handler(req, res) {
  const route = req.query.route || "";
  const method = req.method || "GET";

  // ── CORS ──
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Internal-Token, X-Api-Key, Authorization");
  if (method === "OPTIONS") return res.status(200).end();

  // ── Auth check (skip untuk public routes) ──
  const internalToken = process.env.VITE_INTERNAL_API_SECRET || process.env.INTERNAL_API_SECRET;
  const reqToken = req.headers["x-internal-token"];
  const isPublic = PUBLIC_ROUTES.includes(route);

  if (internalToken && !isPublic && reqToken !== internalToken) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid X-Internal-Token header"
    });
  }

  // ── Route dispatch ──
  try {
    switch (route) {

      // ════════════════════════════════════════
      // WA OUTBOUND — kirim pesan via Fonnte
      // ════════════════════════════════════════
      case "send-wa": {
        if (method !== "POST") return res.status(405).json({ error: "Method not allowed" });
        const { phone, message } = req.body || {};
        if (!phone || !message) return res.status(400).json({ error: "phone dan message wajib" });

        const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
        if (!FONNTE_TOKEN) return res.status(500).json({
          error: "FONNTE_TOKEN belum diset di Vercel Environment Variables",
          detail: "FONNTE_TOKEN_NOT_SET"
        });

        const normPhone = String(phone).replace(/^0/, "62").replace(/[^0-9]/g, "");
        const fonnteRes = await fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: { "Authorization": FONNTE_TOKEN, "Content-Type": "application/json" },
          body: JSON.stringify({ target: normPhone, message, delay: "2", countryCode: "62" })
        });
        const fonnteData = await fonnteRes.json().catch(() => ({}));
        if (!fonnteRes.ok || fonnteData.status === false) {
          return res.status(502).json({ success: false, error: fonnteData.reason || "Fonnte error", detail: fonnteData });
        }
        return res.status(200).json({ success: true, target: normPhone });
      }

      // ════════════════════════════════════════
      // WA INBOUND — terima webhook dari Fonnte
      // PUBLIC: tidak butuh internal token
      // ════════════════════════════════════════
      case "receive-wa": {
        // Fonnte verify: GET request
        if (method === "GET") return res.status(200).json({ status: "ok", service: "AClean WA Webhook" });
        if (method !== "POST") return res.status(405).json({ error: "Method not allowed" });

        const { sender, message, name, isGroup, id: msgId, device, timestamp } = req.body || {};
        if (!sender || !message || isGroup === "true" || isGroup === true) {
          return res.status(200).json({ status: "skipped" });
        }

        const senderNorm = String(sender).replace(/[^0-9]/g, "");
        const FONNTE_TOKEN  = process.env.FONNTE_TOKEN;
        const OWNER_PHONE   = process.env.OWNER_PHONE;
        const SUPA_URL      = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        const SUPA_KEY      = process.env.SUPABASE_SERVICE_KEY;

        // ── Feature toggles: baca dari Supabase app_settings (Owner bisa ubah dari UI) ──
        // Fallback ke env var jika Supabase tidak tersedia
        let AUTOREPLY_ON = process.env.AUTOREPLY_ENABLED === "true"; // default: false
        let FORWARD_ON   = process.env.FORWARD_TO_OWNER  !== "false"; // default: true

        if (SUPA_URL && SUPA_KEY) {
          try {
            const settRes = await fetch(
              `${SUPA_URL}/rest/v1/app_settings?select=key,value&key=in.(wa_autoreply_enabled,wa_forward_to_owner)`,
              { headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` } }
            );
            if (settRes.ok) {
              const settings = await settRes.json();
              const settMap  = Object.fromEntries((settings||[]).map(s=>[s.key, s.value]));
              if (settMap.wa_autoreply_enabled !== undefined) AUTOREPLY_ON = settMap.wa_autoreply_enabled === "true";
              if (settMap.wa_forward_to_owner  !== undefined) FORWARD_ON   = settMap.wa_forward_to_owner  !== "false";
            }
          } catch(_) { /* fallback ke env var */ }
        }

        // ── 1. Simpan ke Supabase wa_messages (selalu) ──
        if (SUPA_URL && SUPA_KEY) {
          await fetch(\`\${SUPA_URL}/rest/v1/wa_messages\`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": SUPA_KEY, "Authorization": \`Bearer \${SUPA_KEY}\`,
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({
              sender: senderNorm, sender_name: name || null, message,
              direction: "inbound", fonnte_msg_id: msgId || null, device_id: device || null,
              raw_payload: JSON.stringify(req.body),
              received_at: timestamp ? new Date(parseInt(timestamp)*1000).toISOString() : new Date().toISOString()
            })
          }).catch(() => {});
        }

        // ── 2. Auto-reply (hanya jika AUTOREPLY_ENABLED=true) ──
        const msgLower = (message || "").toLowerCase().trim();
        let autoReply = null;

        if (AUTOREPLY_ON) {
          if (["halo","hi","hello","hai","pagi","siang","sore","malam"].some(k => msgLower.includes(k))) {
            autoReply = \`Halo! 👋 Selamat datang di *AClean Service AC*.

Kami melayani:
🧹 Cuci AC | 🔧 Perbaikan AC | ❄️ Isi Freon | 🏠 Pasang AC Baru

Ketik *HARGA* untuk info tarif
Ketik *ORDER* untuk pesan layanan
Atau hubungi admin kami langsung.\`;
          } else if (msgLower.includes("harga") || msgLower.includes("tarif") || msgLower.includes("biaya")) {
            autoReply = \`📋 *Daftar Harga AClean Service AC*

🧹 Cuci AC:
  • AC Split 0,5-1PK: Rp 85.000/unit
  • AC Split 1,5-2,5PK: Rp 100.000/unit

🔧 Perbaikan AC: mulai Rp 100.000
❄️ Isi Freon R32: Rp 450.000
🏠 Pasang AC Baru: mulai Rp 350.000

_Hubungi admin untuk penawaran terbaik!_\`;
          } else if (msgLower === "order" || msgLower.includes("pesan") || msgLower.includes("booking")) {
            autoReply = \`✅ Untuk pemesanan, mohon informasikan:
1️⃣ Nama lengkap
2️⃣ Alamat lengkap
3️⃣ Jenis layanan
4️⃣ Jumlah unit AC
5️⃣ Tanggal & jam yang diinginkan

Admin kami akan segera konfirmasi. 👷\`;
          } else if (msgLower.includes("status") || msgLower.includes("jadwal")) {
            autoReply = \`🔍 Untuk cek status pesanan, sebutkan nama & nomor order Anda. Admin akan segera membantu. ⏱️\`;
          } else if (msgLower.includes("bayar") || msgLower.includes("transfer")) {
            autoReply = \`💳 Setelah transfer, kirimkan bukti bayar ke sini. Admin konfirmasi dalam 30 menit. ✅\`;
          }

          if (autoReply && FONNTE_TOKEN) {
            await fetch("https://api.fonnte.com/send", {
              method: "POST",
              headers: { "Authorization": FONNTE_TOKEN, "Content-Type": "application/json" },
              body: JSON.stringify({ target: senderNorm, message: autoReply, delay: "1", countryCode: "62" })
            }).catch(() => {});
          }
        }

        // ── 3. Forward ke Owner (jika FORWARD_TO_OWNER != false) ──
        // Selalu forward jika auto-reply mati, atau jika pesan tidak ter-reply
        if (FORWARD_ON && FONNTE_TOKEN && OWNER_PHONE) {
          const shouldForward = !autoReply; // jika sudah auto-reply, tidak perlu forward
          if (shouldForward) {
            const waktu = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour:"2-digit", minute:"2-digit", day:"2-digit", month:"short" });
            const fwd = \`📥 *Pesan WA Masuk*
Dari: \${name || ("+" + senderNorm)} 
Pesan: \${message}
_\${waktu}_

_Balas langsung di WA atau via menu ARA_\`;
            await fetch("https://api.fonnte.com/send", {
              method: "POST",
              headers: { "Authorization": FONNTE_TOKEN, "Content-Type": "application/json" },
              body: JSON.stringify({ target: OWNER_PHONE, message: fwd, delay: "1", countryCode: "62" })
            }).catch(() => {});
          }
        }

        return res.status(200).json({
          status: "ok",
          sender: senderNorm,
          autoreply_active: AUTOREPLY_ON,
          replied: !!autoReply,
          forwarded: FORWARD_ON && !autoReply
        });
      }

      // ════════════════════════════════════════
      // ARA CHAT — secure LLM proxy
      // ════════════════════════════════════════
      case "ara-chat": {
        if (method !== "POST") return res.status(405).json({ error: "Method not allowed" });
        const { messages, bizContext, brainMd, provider, model, ollamaUrl, imageData, imageType } = req.body || {};
        if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages array wajib" });

        const systemPrompt = [
          brainMd || "Kamu adalah ARA, asisten AI untuk AClean Service AC.",
          bizContext ? `\n\n## DATA BISNIS LIVE\n${JSON.stringify(bizContext)}` : ""
        ].join("");

        const effectiveProvider = provider || "claude";

        // Claude
        if (effectiveProvider === "claude" || effectiveProvider === "anthropic") {
          const API_KEY = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
          if (!API_KEY) return res.status(500).json({ error: "LLM_API_KEY belum diset di Vercel Environment Variables" });

          const effectiveModel = model || process.env.LLM_MODEL || "claude-sonnet-4-6";
          const claudeMessages = messages.map((m, idx) => {
            const isLast = idx === messages.length - 1;
            if (isLast && imageData && m.role === "user") {
              return { role: "user", content: [
                { type: "image", source: { type: "base64", media_type: imageType || "image/jpeg", data: imageData } },
                { type: "text", text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }
              ]};
            }
            return { role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) };
          });

          const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: effectiveModel, max_tokens: 2048, system: systemPrompt, messages: claudeMessages })
          });
          const claudeData = await claudeRes.json();
          if (!claudeRes.ok) return res.status(502).json({ error: claudeData.error?.message || "Claude API error" });
          const reply = claudeData.content?.map(c => c.text || "").join("") || "";
          return res.status(200).json({ reply, model: effectiveModel, provider: "claude" });
        }

        // Gemini
        if (effectiveProvider === "gemini") {
          const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
          if (!GEMINI_KEY) return res.status(500).json({ error: "GEMINI_API_KEY belum diset" });
          const geminiModel = model || "gemini-2.0-flash";
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${GEMINI_KEY}`;
          const contents = messages.map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }]
          }));
          const geminiRes = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { maxOutputTokens: 2048 } })
          });
          const geminiData = await geminiRes.json();
          if (!geminiRes.ok) return res.status(502).json({ error: geminiData.error?.message || "Gemini error" });
          const reply = geminiData.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
          return res.status(200).json({ reply, model: geminiModel, provider: "gemini" });
        }

        // Ollama
        if (effectiveProvider === "ollama") {
          const baseUrl = ollamaUrl || "http://localhost:11434";
          const ollamaModel = model || "llama3.1";
          const ollamaRes = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: ollamaModel, stream: false, messages: [{ role: "system", content: systemPrompt }, ...messages] })
          });
          const ollamaData = await ollamaRes.json();
          const reply = ollamaData.message?.content || "";
          return res.status(200).json({ reply, model: ollamaModel, provider: "ollama" });
        }

        return res.status(400).json({ error: `Provider '${effectiveProvider}' tidak didukung` });
      }

      // ════════════════════════════════════════
      // TEST CONNECTION — PUBLIC (no auth needed)
      // ════════════════════════════════════════
      case "test-connection": {
        const type = req.query.type || req.body?.type;

        // Test Fonnte WA
        if (type === "wa" || type === "fonnte") {
          const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
          if (!FONNTE_TOKEN) return res.status(200).json({ ok: false, error: "FONNTE_TOKEN belum diset" });
          try {
            const r = await fetch("https://api.fonnte.com/validate", {
              method: "POST",
              headers: { "Authorization": FONNTE_TOKEN, "Content-Type": "application/json" },
              body: JSON.stringify({})
            });
            const d = await r.json().catch(() => ({}));
            return res.status(200).json({ ok: r.ok && d.status !== false, detail: d });
          } catch (err) { return res.status(200).json({ ok: false, error: err.message }); }
        }

        // Test Cloudflare R2
        if (type === "storage" || type === "r2") {
          const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
          const CF_TOKEN   = process.env.CLOUDFLARE_API_TOKEN;
          const CF_BUCKET  = process.env.R2_BUCKET_NAME || "aclean-fotos";
          if (!CF_ACCOUNT || !CF_TOKEN) return res.status(200).json({ ok: false, error: "Cloudflare env vars tidak diset" });
          try {
            const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/r2/buckets/${CF_BUCKET}`,
              { headers: { "Authorization": `Bearer ${CF_TOKEN}` } });
            const d = await r.json().catch(() => ({}));
            return res.status(200).json({ ok: r.ok && d.success, detail: d });
          } catch (err) { return res.status(200).json({ ok: false, error: err.message }); }
        }

        // Test LLM
        if (type === "llm" || type === "claude") {
          const API_KEY = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
          if (!API_KEY) return res.status(200).json({ ok: false, error: "LLM_API_KEY tidak diset" });
          try {
            const r = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: "ping" }] })
            });
            const d = await r.json().catch(() => ({}));
            return res.status(200).json({ ok: r.ok, model: d.model || null, error: d.error?.message || null });
          } catch (err) { return res.status(200).json({ ok: false, error: err.message }); }
        }

        // Status overview
        return res.status(200).json({
          ok: true,
          service: "AClean API",
          env: {
            fonnte:     !!process.env.FONNTE_TOKEN,
            llm_key:    !!process.env.LLM_API_KEY,
            cloudflare: !!process.env.CLOUDFLARE_API_TOKEN,
            owner_phone:!!process.env.OWNER_PHONE,
            supabase:   !!process.env.SUPABASE_SERVICE_KEY,
          },
          endpoints: ["/api/send-wa", "/api/receive-wa", "/api/ara-chat", "/api/test-connection", "/api/upload-foto"]
        });
      }

      // ════════════════════════════════════════
      // UPLOAD FOTO — Cloudflare R2
      // ════════════════════════════════════════
      case "upload-foto": {
        if (method !== "POST") return res.status(405).json({ error: "Method not allowed" });
        const { fileName, fileData, fileType, folder } = req.body || {};
        if (!fileName || !fileData) return res.status(400).json({ error: "fileName dan fileData wajib" });

        const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
        const CF_TOKEN   = process.env.CLOUDFLARE_API_TOKEN;
        const CF_BUCKET  = process.env.R2_BUCKET_NAME || "aclean-fotos";
        if (!CF_ACCOUNT || !CF_TOKEN) return res.status(500).json({ error: "Cloudflare env vars tidak diset" });

        const key = `${folder || "fotos"}/${Date.now()}_${fileName}`;
        const fileBuffer = Buffer.from(fileData, "base64");

        const r2Res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/r2/buckets/${CF_BUCKET}/objects/${key}`,
          {
            method: "PUT",
            headers: {
              "Authorization": `Bearer ${CF_TOKEN}`,
              "Content-Type": fileType || "image/jpeg"
            },
            body: fileBuffer
          }
        );

        if (!r2Res.ok) {
          const errText = await r2Res.text();
          return res.status(502).json({ success: false, error: errText });
        }

        const CF_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://pub-${CF_ACCOUNT.slice(0,16)}.r2.dev`;
        const url = `${CF_PUBLIC_URL}/${key}`;
        return res.status(200).json({ success: true, url, key });
      }

      // ════════════════════════════════════════
      // CRON REMINDER — invoice overdue alerts
      // ════════════════════════════════════════
      case "cron-reminder": {
        // Vercel cron akan call ini setiap hari
        const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
        const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

        if (!SUPA_URL || !SUPA_KEY || !FONNTE_TOKEN) {
          return res.status(200).json({ ok: false, error: "Env vars tidak lengkap" });
        }

        const today = new Date().toISOString().slice(0, 10);

        // Ambil invoice UNPAID yang sudah lewat due date
        const { data: overdueInvs } = await fetch(
          `${SUPA_URL}/rest/v1/invoices?select=*&status=eq.UNPAID&due=lt.${today}`,
          { headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` } }
        ).then(r => r.json()).then(d => ({ data: d })).catch(() => ({ data: [] }));

        let sent = 0, updated = 0;
        for (const inv of (overdueInvs || [])) {
          // Update status ke OVERDUE
          await fetch(`${SUPA_URL}/rest/v1/invoices?id=eq.${inv.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Prefer": "return=minimal" },
            body: JSON.stringify({ status: "OVERDUE" })
          });
          updated++;

          // Kirim reminder WA ke customer
          if (inv.phone) {
            const normPhone = String(inv.phone).replace(/^0/, "62").replace(/[^0-9]/g, "");
            const msg = `Halo ${inv.customer || "Bapak/Ibu"}, mengingatkan tagihan *AClean Service* senilai *Rp${Number(inv.total||0).toLocaleString("id-ID")}* (Invoice ${inv.id}) sudah jatuh tempo. Mohon segera melakukan pembayaran. Terima kasih. 🙏`;
            await fetch("https://api.fonnte.com/send", {
              method: "POST",
              headers: { "Authorization": FONNTE_TOKEN, "Content-Type": "application/json" },
              body: JSON.stringify({ target: normPhone, message: msg, delay: "3", countryCode: "62" })
            }).catch(() => {});
            sent++;
          }
        }

        return res.status(200).json({ ok: true, overdue_found: (overdueInvs||[]).length, updated, reminders_sent: sent });
      }

      // ════════════════════════════════════════
      // DEFAULT — route tidak dikenal
      // ════════════════════════════════════════
      default:
        return res.status(404).json({ error: `Route /api/${route} tidak ditemukan`, available: ["send-wa","receive-wa","ara-chat","test-connection","upload-foto","cron-reminder"] });
    }
  } catch (err) {
    console.error(`[api/${route}] Error:`, err.message);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
