// api/[route].js - AClean Unified API Router
export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };
const PUBLIC_ROUTES = ["receive-wa", "test-connection", "_auth"];

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
        if (["halo","hi","hello","hai","pagi","siang","sore","malam"].some(k => ml.includes(k)))
          reply = "Halo! Selamat datang di AClean Service AC. Kami melayani Cuci AC, Perbaikan AC, Isi Freon, dan Pasang AC Baru. Ketik HARGA untuk info tarif atau ORDER untuk pesan layanan.";
        else if (ml.includes("harga") || ml.includes("tarif") || ml.includes("biaya"))
          reply = "Harga AClean: Cuci AC 0.5-1PK Rp85.000, Cuci 1.5-2.5PK Rp100.000, Perbaikan mulai Rp100.000, Freon R32 Rp450.000, Pasang AC mulai Rp350.000.";
        else if (ml === "order" || ml.includes("pesan") || ml.includes("booking"))
          reply = "Untuk pesan layanan: 1) Nama, 2) Alamat, 3) Jenis layanan, 4) Jumlah unit, 5) Tanggal & jam. Admin akan konfirmasi jadwal.";
        else if (ml.includes("status") || ml.includes("jadwal"))
          reply = "Sebutkan nama dan nomor order Anda. Admin akan segera membantu.";
        else if (ml.includes("bayar") || ml.includes("transfer"))
          reply = "Setelah transfer, kirim bukti bayar ke sini. Admin konfirmasi dalam 30 menit.";

        if (reply && FT) fetch("https://api.fonnte.com/send", {
          method: "POST",
          headers: { Authorization: FT, "Content-Type": "application/json" },
          body: JSON.stringify({ target: sender, message: reply, delay: "1", countryCode: "62" })
        }).catch(()=>{});
      }

      // Forward to owner
      if (fwdOn && !reply && FT && OP) fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: { Authorization: FT, "Content-Type": "application/json" },
        body: JSON.stringify({ target: OP, message: "Pesan WA Masuk\nDari: " + (wb.name||("+" + sender)) + "\nPesan: " + message, delay: "1", countryCode: "62" })
      }).catch(()=>{});

      return res.status(200).json({ status: "ok", sender, autoreply: autoOn, replied: !!reply, forwarded: fwdOn && !reply });
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

      if (prov === "gemini") {
        const GK = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
        if (!GK) return res.status(500).json({ error: "GEMINI_API_KEY belum diset" });
        const gm = model || "gemini-2.0-flash";
        const gr = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + gm + ":generateContent?key=" + GK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: messages.map(m => ({ role: m.role==="assistant"?"model":"user", parts:[{ text: typeof m.content==="string"?m.content:JSON.stringify(m.content) }]})),
            systemInstruction: { parts:[{ text: sysP }]}, generationConfig:{ maxOutputTokens:2048 }
          })
        });
        const gd = await gr.json();
        if (!gr.ok) return res.status(502).json({ error: (gd.error&&gd.error.message)||"Gemini error" });
        const gc = (gd.candidates||[])[0];
        return res.status(200).json({ reply: gc?(gc.content&&gc.content.parts||[]).map(p=>p.text||"").join(""):""  , model: gm, provider: "gemini" });
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
          return res.status(200).json({ ok: r.ok, model: d.model||null, error: (d.error&&d.error.message)||null });
        } catch(e) { return res.status(200).json({ ok:false, error:e.message }); }
      }

      return res.status(200).json({
        ok: true, success: true, service: "AClean API",
        env: { fonnte: !!process.env.FONNTE_TOKEN, llm_key: !!process.env.LLM_API_KEY, cloudflare: !!process.env.CLOUDFLARE_API_TOKEN, owner_phone: !!process.env.OWNER_PHONE, supabase: !!process.env.SUPABASE_SERVICE_KEY }
      });
    }

    // ── UPLOAD-FOTO ──
    if (route === "upload-foto") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const { fileName, fileData, fileType, folder } = req.body || {};
      if (!fileName || !fileData) return res.status(400).json({ error: "fileName dan fileData wajib" });
      const CA=process.env.CLOUDFLARE_ACCOUNT_ID, CT=process.env.CLOUDFLARE_API_TOKEN, CB=process.env.R2_BUCKET_NAME||"aclean-fotos";
      if (!CA||!CT) return res.status(500).json({ error: "Cloudflare env vars tidak diset" });
      const key = (folder||"fotos") + "/" + Date.now() + "_" + fileName;
      const r = await fetch("https://api.cloudflare.com/client/v4/accounts/"+CA+"/r2/buckets/"+CB+"/objects/"+key, {
        method:"PUT", headers:{ Authorization:"Bearer "+CT, "Content-Type":fileType||"image/jpeg" }, body: Buffer.from(fileData,"base64")
      });
      if (!r.ok) return res.status(502).json({ success:false, error: await r.text() });
      const pub = process.env.R2_PUBLIC_URL || ("https://pub-"+CA.slice(0,16)+".r2.dev");
      return res.status(200).json({ success:true, url: pub+"/"+key, key });
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
