// ============================================================
// SEC-02: API Authentication Middleware
// Simpan file ini di: api/_auth.js
// Di-import oleh ara-chat.js, [route].js, send-wa.js
// ============================================================
// CARA KERJA:
//   - Setiap request dari App harus bawa header: X-Internal-Token
//   - Value-nya = INTERNAL_API_SECRET yang diset di Vercel env
//   - Kalau tidak ada / salah → 401 Unauthorized
// ============================================================
// SETUP (1x):
//   1. Buka Vercel Dashboard → Settings → Environment Variables
//   2. Tambah: INTERNAL_API_SECRET = [random string 32+ karakter]
//      contoh: openssl rand -hex 32
//      contoh value: a7f3c9e2b4d81f0e5a2c7b3d9e4f1a6c8b2d5e7f3a1c4b9d2e8f0a5c3b7d1e4
//   3. Redeploy Vercel
// ============================================================

export function validateInternalToken(req, res) {
  const secret = process.env.INTERNAL_API_SECRET;

  // Kalau env belum diset, log warning tapi jangan block (agar tidak break saat development)
  if (!secret) {
    console.warn("[SEC-02] INTERNAL_API_SECRET belum diset di Vercel env — skip auth check");
    return true; // allow in dev mode
  }

  const token = req.headers["x-internal-token"] || req.headers["x-api-key"];
  if (!token || token !== secret) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid X-Internal-Token header"
    });
    return false;
  }
  return true;
}

// Rate limiter sederhana berbasis memory (per Vercel function instance)
// Untuk production sebenarnya pakai Redis/Upstash, tapi ini sudah cukup untuk AClean scale
const rateLimitMap = new Map(); // ip → { count, resetAt }

export function checkRateLimit(req, res, maxRequests = 60, windowMs = 60000) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
           || req.headers["x-real-ip"]
           || req.socket?.remoteAddress
           || "unknown";

  const now  = Date.now();
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
    return false;
  }
  return true;
}

// CORS helper — hanya izinkan domain AClean
export function setCorsHeaders(req, res) {
  const allowed = [
    "https://a-clean-webapp.vercel.app",
    "https://aclean.vercel.app",
    process.env.ALLOWED_ORIGIN, // custom domain kalau ada
  ].filter(Boolean);

  const origin = req.headers.origin || "";

  // Development: izinkan localhost
  const isDev = origin.includes("localhost") || origin.includes("127.0.0.1") || !origin;
  const isAllowed = isDev || allowed.some(a => origin.startsWith(a));

  res.setHeader("Access-Control-Allow-Origin", isAllowed ? (origin || "*") : "https://a-clean-webapp.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Internal-Token,X-Api-Key");
  res.setHeader("Vary", "Origin");
}
