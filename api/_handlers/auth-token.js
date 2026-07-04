// api/_handlers/auth-token.js — Handler grup auth/token/config/health (Batch 2 pemecahan
// router, Jul 2026). Isi dipindah APA ADANYA dari api/[route].js — di-dispatch oleh router.
import { checkRateLimit, signAppToken } from "../_auth.js";

// ── TEST-CONNECTION (public) ──
export async function testConnection(req, res) {
  const type = (req.query&&req.query.type) || (req.body&&req.body.type) || "";

  if (type === "wa" || type === "fonnte") {
    const FT = process.env.FONNTE_TOKEN;
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
    const AK = (process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim();
    if (!AK) return res.status(200).json({ ok: false, error: "LLM_API_KEY tidak diset" });
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{ "Content-Type":"application/json", "x-api-key":AK, "anthropic-version":"2023-06-01" },
        body: JSON.stringify({ model:"claude-haiku-4-5", max_tokens:10, messages:[{ role:"user", content:"ping" }] })
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

  // Jangan ekspos detail service yang aktif ke public endpoint
  return res.status(200).json({ ok: true, success: true, service: "AClean API" });
}

// ── HEALTH: Public lightweight health check (untuk uptime monitor eksternal) ──
// PUBLIC_ROUTES — tidak butuh auth. UptimeRobot dll bisa ping ini.
export async function health(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({error: "Method not allowed"});
  const checks = { supabase: "unknown", fonnte: "unknown", ai: "unknown" };
  const start = Date.now();

  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (SU && SK) {
    try {
      const r = await fetch(SU + "/rest/v1/agent_logs?select=id&limit=1", {
        headers: { apikey: SK, Authorization: "Bearer " + SK }
      });
      checks.supabase = r.ok ? "ok" : "fail:" + r.status;
    } catch (e) { checks.supabase = "fail:" + (e.message || "unknown").slice(0, 40); }
  } else { checks.supabase = "not_configured"; }

  if (process.env.FONNTE_TOKEN) {
    try {
      // Fonnte /validate butuh POST, tidak GET
      const r = await fetch("https://api.fonnte.com/validate", {
        method: "POST",
        headers: { Authorization: process.env.FONNTE_TOKEN }
      });
      checks.fonnte = r.ok ? "ok" : "fail:" + r.status;
    } catch (e) { checks.fonnte = "fail:" + (e.message || "unknown").slice(0, 40); }
  } else { checks.fonnte = "not_configured"; }

  const aiProviders = [];
  if (process.env.ANTHROPIC_API_KEY) aiProviders.push("claude");
  if (process.env.OPENAI_API_KEY) aiProviders.push("openai");
  if (process.env.GROQ_API_KEY) aiProviders.push("groq");
  if (process.env.GEMINI_API_KEY) aiProviders.push("gemini");
  checks.ai = aiProviders.length > 0 ? "ok:" + aiProviders.join(",") : "not_configured";

  const isHealthy = checks.supabase === "ok";
  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - start,
    checks,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
  });
}

// ── GET-LLM-CONFIG (secure backend config endpoint) ──
export async function getLlmConfig(req, res) {
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
  let defaultProvider = "claude"; // fallback default
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

// ── GET-API-TOKEN — issue App Token (HMAC-signed JWT, 15 menit, per-user) ──
// Replace pattern lama (echo master secret) dengan signed token per-user + role claim.
export async function getApiToken(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const authH = req.headers["authorization"] || "";
  const jwt = authH.startsWith("Bearer ") ? authH.slice(7) : "";
  if (!jwt) return res.status(401).json({ error: "Missing Bearer token" });
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return res.status(500).json({ error: "Supabase config missing" });
  if (!process.env.INTERNAL_API_SECRET) return res.status(500).json({ error: "Server misconfiguration" });
  try {
    // Verify Supabase session
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { "Authorization": `Bearer ${jwt}`, "apikey": supabaseAnonKey }
    });
    if (!r.ok) return res.status(401).json({ error: "Invalid session" });
    const userData = await r.json();
    const userId = userData?.id;
    if (!userId) return res.status(401).json({ error: "Invalid session" });

    // Resolve role dari user_profiles (single source of truth)
    const SK = process.env.SUPABASE_SERVICE_KEY;
    let role = "Helper";
    let name = userData.email || "";
    if (SK) {
      try {
        const profRes = await fetch(
          `${supabaseUrl}/rest/v1/user_profiles?id=eq.${encodeURIComponent(userId)}&select=role,name&limit=1`,
          { headers: { apikey: SK, Authorization: "Bearer " + SK } }
        );
        if (profRes.ok) {
          const arr = await profRes.json();
          if (arr[0]) {
            const rawRole = String(arr[0].role || "Helper");
            role = rawRole.charAt(0).toUpperCase() + rawRole.slice(1).toLowerCase();
            if (arr[0].name) name = arr[0].name;
          }
        }
      } catch { /* default Helper */ }
    }

    const token = signAppToken({ userId, role, name });
    return res.status(200).json({ token, expiresIn: 15 * 60, role });
  } catch (e) {
    return res.status(500).json({ error: "Auth check failed" });
  }
}

// ── MANAGE-USER (PRIVATE — Owner/Admin; create/update/toggle/reset/delete user) ──
export async function manageUser(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  // M-04: Rate limiting — max 20 req/menit per IP untuk endpoint sensitif ini
  if (!await checkRateLimit(req, res, 20, 60000)) return;
  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SU || !SK) return res.status(500).json({ error: "Supabase service key tidak dikonfigurasi" });

  // ── Role check: verifikasi caller dari App Token claims atau DB ──
  const { action, userId, name, email, password, role, phone, commission_pin, bank_name, bank_account_no, bank_holder, work_start_date } = req.body || {};

  let callerRole = "";

  // Path A: kalau pakai App Token, role sudah ada di req.appClaims (signed, tidak bisa dipalsukan)
  if (req.appClaims?.role) {
    callerRole = req.appClaims.role;
  } else {
    // Path B: fallback — pakai Supabase Bearer JWT, decode sub lalu query user_profiles
    const bearerToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (bearerToken) {
      try {
        const parts = bearerToken.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
          const callerId = payload.sub;
          if (callerId) {
            const profRes = await fetch(`${SU}/rest/v1/user_profiles?id=eq.${encodeURIComponent(callerId)}&select=role&limit=1`, {
              headers: { apikey: SK, Authorization: "Bearer " + SK }
            });
            const profData = profRes.ok ? await profRes.json() : [];
            callerRole = profData[0]?.role ? ((profData[0].role).charAt(0).toUpperCase() + (profData[0].role).slice(1).toLowerCase()) : "";
          }
        }
      } catch (jwtErr) {
        console.warn("[manage-user] JWT decode error:", jwtErr.message);
      }
    }
  }

  if (!["Owner", "Admin"].includes(callerRole)) {
    return res.status(403).json({ error: "Forbidden: hanya Owner/Admin yang bisa manage user" });
  }
  // Admin tidak boleh create/delete/toggle akun Owner
  const isOwnerAction = role === "Owner" || (action === "delete" && callerRole === "Admin");
  if (callerRole === "Admin" && isOwnerAction) {
    return res.status(403).json({ error: "Forbidden: Admin tidak bisa kelola akun Owner" });
  }
  const adminUrl = SU + "/auth/v1/admin/users";
  const headers = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };

  // ── CREATE USER ──
  if (action === "create") {
    if (!email || !password || !name || !role) return res.status(400).json({ error: "email, password, name, role wajib diisi" });
    const authRes = await fetch(adminUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name, role } })
    });
    const authData = await authRes.json();
    if (!authRes.ok) {
      // M-03: Log detail internal, expose pesan generic ke client
      console.warn("[manage-user] Auth create error:", authData.message || authData.error);
      const safeMsg = authData.message?.includes("already") ? "Email sudah terdaftar" : "Gagal buat user. Coba lagi atau hubungi admin.";
      return res.status(400).json({ error: safeMsg });
    }

    const uid = authData.id;
    const colorMap = { Owner: "#f59e0b", Admin: "#38bdf8", Teknisi: "#22c55e", Helper: "#a78bfa" };
    const profileRes = await fetch(SU + "/rest/v1/user_profiles", {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ id: uid, name, role, phone: phone || "", avatar: name.charAt(0).toUpperCase(), color: colorMap[role] || "#38bdf8", active: true })
    });
    const profileData = await profileRes.json();
    if (!profileRes.ok) return res.status(207).json({ ok: true, warning: "Auth OK, profile gagal: " + JSON.stringify(profileData), user: authData });
    return res.status(200).json({ ok: true, user: { ...authData, ...profileData[0] } });
  }

  // ── UPDATE PROFILE ──
  if (action === "update") {
    if (!userId) return res.status(400).json({ error: "userId wajib" });
    const upd = {};
    if (name) upd.name = name;
    if (role) upd.role = role;
    if (phone !== undefined) upd.phone = phone;
    // commission_pin: null = hapus PIN, string = set PIN (layer-2 akses Komisi Saya)
    if (commission_pin !== undefined) upd.commission_pin = commission_pin || null;
    // Data rekening payroll (sensitif) — Owner only
    const bankFieldsPresent = [bank_name, bank_account_no, bank_holder, work_start_date].some(v => v !== undefined);
    if (bankFieldsPresent) {
      if (callerRole !== "Owner") return res.status(403).json({ error: "Forbidden: hanya Owner yang bisa ubah data rekening" });
      if (bank_name        !== undefined) upd.bank_name       = bank_name || null;
      if (bank_account_no  !== undefined) upd.bank_account_no = bank_account_no || null;
      if (bank_holder      !== undefined) upd.bank_holder     = bank_holder || null;
      if (work_start_date  !== undefined) upd.work_start_date = work_start_date || null;
    }
    const profileRes = await fetch(SU + "/rest/v1/user_profiles?id=eq." + userId, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(upd)
    });
    if (!profileRes.ok) { console.warn("[manage-user] update failed:", await profileRes.text()); return res.status(400).json({ error: "Update gagal. Coba lagi." }); }
    return res.status(200).json({ ok: true });
  }

  // ── TOGGLE ACTIVE (nonaktifkan/aktifkan) ──
  if (action === "toggle-active") {
    if (!userId) return res.status(400).json({ error: "userId wajib" });
    const { active } = req.body;
    // Ban/unban di Supabase Auth
    const authUpd = active ? { ban_duration: "none" } : { ban_duration: "876600h" };
    await fetch(adminUrl + "/" + userId, { method: "PUT", headers, body: JSON.stringify(authUpd) });
    // Update flag di user_profiles
    await fetch(SU + "/rest/v1/user_profiles?id=eq." + userId, {
      method: "PATCH", headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ active })
    });
    return res.status(200).json({ ok: true });
  }

  // ── RESET PASSWORD ──
  if (action === "reset-password") {
    if (!userId || !password) return res.status(400).json({ error: "userId dan password wajib" });
    if (password.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter" });
    const authRes = await fetch(adminUrl + "/" + userId, {
      method: "PUT", headers,
      body: JSON.stringify({ password })
    });
    if (!authRes.ok) { const e = await authRes.json(); return res.status(400).json({ error: e.message || "Reset gagal" }); }
    return res.status(200).json({ ok: true });
  }

  // ── DELETE PERMANENT ──
  if (action === "delete") {
    if (!userId) return res.status(400).json({ error: "userId wajib" });
    await fetch(SU + "/rest/v1/user_profiles?id=eq." + userId, { method: "DELETE", headers });
    const authRes = await fetch(adminUrl + "/" + userId, { method: "DELETE", headers });
    if (!authRes.ok && authRes.status !== 404) { const e = await authRes.json(); return res.status(400).json({ error: e.message || "Delete Auth gagal" }); }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "Action tidak dikenal: " + action });
}
