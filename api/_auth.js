// ============================================================
// SEC-02: API Authentication Middleware
// Simpan file ini di: api/_auth.js
// Di-import oleh ara-chat.js, [route].js, send-wa.js
// ============================================================
// CARA KERJA (3 path auth, prioritas berurutan):
//   1. App Token: HMAC-signed JWT per-user (15 menit expiry, ada role claim)
//      → diissue oleh /api/get-api-token setelah verifikasi Supabase session
//      → header: X-Internal-Token (format: header.payload.signature)
//   2. Supabase Bearer JWT: dari session aktif user (header Authorization)
//   3. Legacy X-Internal-Token === INTERNAL_API_SECRET (cron, server-to-server)
// ============================================================
// SETUP (1x):
//   1. Buka Vercel Dashboard → Settings → Environment Variables
//   2. Tambah: INTERNAL_API_SECRET = [random string 32+ karakter]
//      contoh: openssl rand -hex 32
//   3. Redeploy Vercel
// ============================================================

import crypto from "crypto";

// ── fetchWithTimeout: Fetch with timeout support ──
export async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch(err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`Request timeout after ${timeoutMs}ms`);
      timeoutErr.code = "ETIMEDOUT";
      throw timeoutErr;
    }
    throw err;
  }
}

// ── App Token: HMAC-SHA256 signed JWT per-user (15 menit expiry) ──
// Bukan Supabase JWT. Diissue oleh /api/get-api-token setelah Supabase session valid.
// Payload: { userId, role, name, iat, exp } — signed pakai INTERNAL_API_SECRET sebagai HMAC key.

const APP_TOKEN_TTL_SEC = 15 * 60; // 15 menit

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

export function signAppToken({ userId, role, name }) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) throw new Error("INTERNAL_API_SECRET not configured");
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: "HS256", typ: "AT" });
  const payload = b64urlJson({ userId, role, name, iat: now, exp: now + APP_TOKEN_TTL_SEC });
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyAppToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload; // { userId, role, name, iat, exp }
  } catch { return null; }
}

// Helper untuk endpoint yang butuh role check
// Pakai setelah validateInternalToken pass. Return true kalau caller pakai App Token & role match.
// Kalau caller pakai Supabase Bearer / legacy secret (req.appClaims undefined), return true (caller harus cek role manual).
export function requireRole(req, res, allowedRoles) {
  const claims = req.appClaims;
  if (!claims) return true; // legacy/Supabase Bearer — caller bertanggung jawab cek role sendiri
  if (!allowedRoles.includes(claims.role)) {
    res.status(403).json({ error: `Forbidden: butuh role ${allowedRoles.join("/")}` });
    return false;
  }
  return true;
}

export async function validateInternalToken(req, res) {
  const secret = process.env.INTERNAL_API_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  // Path 1: App Token (HMAC-signed JWT per-user, format header.payload.sig)
  // Cek pertama — kalau format JWT, hanya boleh divalidasi sebagai App Token,
  // tidak fallback ke legacy compare untuk mencegah confusion attack.
  const tokenHeader = req.headers["x-internal-token"] || req.headers["x-api-key"];
  if (tokenHeader && typeof tokenHeader === "string" && tokenHeader.split(".").length === 3) {
    const claims = verifyAppToken(tokenHeader);
    if (claims) {
      req.appClaims = claims; // handler bisa pakai req.appClaims.role
      return true;
    }
    res.status(401).json({ error: "App token expired or invalid" });
    return false;
  }

  // Path 2: Supabase Bearer JWT (dari logged-in user — direct session)
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ") && supabaseUrl && supabaseAnonKey) {
    const jwt = authHeader.slice(7);
    try {
      const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { "Authorization": `Bearer ${jwt}`, "apikey": supabaseAnonKey }
      });
      if (r.ok) return true;
    } catch { /* fall through */ }
  }

  // Path 3: Legacy X-Internal-Token === INTERNAL_API_SECRET (cron, server-to-server)
  if (secret && tokenHeader) {
    let match = false;
    try {
      const tokenBuf  = Buffer.from(tokenHeader, "utf-8");
      const secretBuf = Buffer.from(secret,      "utf-8");
      match = tokenBuf.length === secretBuf.length && crypto.timingSafeEqual(tokenBuf, secretBuf);
    } catch {
      match = tokenHeader === secret;
    }
    if (match) return true;
  }

  // Kalau env belum diset sama sekali, izinkan di dev
  if (!secret && !supabaseUrl) {
    if (process.env.NODE_ENV === "production") {
      console.error("[SEC-02] CRITICAL: No auth method configured");
      res.status(500).json({ error: "Server misconfiguration" });
      return false;
    }
    console.warn("[SEC-02] No auth configured — dev mode only");
    return true;
  }

  res.status(401).json({ error: "Unauthorized" });
  return false;
}

// ── Rate Limiter: Try KV first, fallback to in-memory ──
// In production, use Vercel KV (Redis) for distributed rate limiting
// In development, use in-memory Map (note: not distributed across instances)
const rateLimitMap = new Map(); // ip → { count, resetAt }

export async function checkRateLimit(req, res, maxRequests = 60, windowMs = 60000) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
           || req.headers["x-real-ip"]
           || req.socket?.remoteAddress
           || "unknown";

  const now = Date.now();

  // ── TRY: Use Vercel KV for distributed rate limiting (production) ──
  try {
    // Check if KV is available
    if (process.env.KV_URL && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      const keyName = `ratelimit:${ip}`;
      const kvUrl = process.env.KV_REST_API_URL;
      const kvToken = process.env.KV_REST_API_TOKEN;

      // Get current count
      const getRes = await fetch(`${kvUrl}/get/${keyName}`, {
        headers: { "Authorization": `Bearer ${kvToken}` }
      });
      let count = 0;
      if (getRes.ok) {
        const data = await getRes.json();
        count = data.result ? parseInt(data.result) : 0;
      }

      // Increment count
      count++;

      // Set with expiry (window time)
      await fetch(`${kvUrl}/set/${keyName}/${count}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${kvToken}` },
        body: JSON.stringify({ ex: Math.ceil(windowMs / 1000) })
      }).catch(err => console.warn("[KV_SET_ERROR]", err.message));

      if (count > maxRequests) {
        const retryAfter = Math.ceil(windowMs / 1000);
        res.setHeader("Retry-After", retryAfter);
        res.status(429).json({
          error: "Too Many Requests",
          message: `Limit ${maxRequests} request per menit. Coba lagi dalam ${retryAfter} detik.`,
          retryAfter
        });
        console.warn(`[RATE_LIMIT_EXCEEDED] IP: ${ip}, count: ${count}, max: ${maxRequests}`);
        return false;
      }
      return true;
    }
  } catch(kvErr) {
    console.warn("[RATE_LIMIT_KV_ERROR]", kvErr.message, "— falling back to in-memory");
  }

  // ── FALLBACK: In-memory rate limiter (development or KV unavailable) ──
  const data = rateLimitMap.get(ip);

  if (!data || now > data.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  data.count++;
  if (data.count > maxRequests) {
    const retryAfter = Math.ceil((data.resetAt - now) / 1000);
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({
      error: "Too Many Requests",
      message: `Limit ${maxRequests} request per menit. Coba lagi dalam ${retryAfter} detik.`,
      retryAfter
    });
    console.warn(`[RATE_LIMIT_EXCEEDED_INMEM] IP: ${ip}, count: ${data.count}, max: ${maxRequests}`);
    return false;
  }
  return true;
}

// CORS helper — hanya izinkan domain AClean
export function setCorsHeaders(req, res) {
  const allowed = [
    "https://a-clean-webapp.vercel.app",
    "https://aclean.vercel.app",
    "https://status.aclean.id",
    process.env.ALLOWED_ORIGIN, // custom domain kalau ada
  ].filter(Boolean);

  const origin = req.headers.origin || "";
  const isProduction = process.env.NODE_ENV === "production";

  // ── SECURITY FIX: Proper origin validation ──
  let isDev = false;
  if (!isProduction) {
    // In development, allow localhost with exact pattern matching
    isDev = origin === "http://localhost:3000" ||
            origin === "http://127.0.0.1:3000" ||
            origin.match(/^http:\/\/localhost:\d+$/) ||
            origin.match(/^http:\/\/127\.0\.0\.1:\d+$/);
  }

  // In production, NEVER allow missing origin (blocks CSRF from tools like curl, postman, etc)
  if (isProduction && !origin) {
    res.setHeader("Access-Control-Allow-Origin", "null"); // explicitly reject
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Internal-Token,X-Api-Key");
    res.setHeader("Vary", "Origin");
    return;
  }

  const isAllowedOrigin = allowed.some(a => a && origin === a); // exact match only
  const isAllowed = isDev || isAllowedOrigin;

  // ── SECURITY FIX: Never use wildcard (*) in production ──
  const allowOrigin = isAllowed ? origin : "null"; // "null" explicitly denies browser from accessing response
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Internal-Token,X-Api-Key");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}
