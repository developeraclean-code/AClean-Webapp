// Auth failures are not interchangeable with an unavailable Auth/database service.
// Never cache users/roles across requests or accept an unverified JWT as fallback.
export class SessionCheckError extends Error {
  constructor(status, code, message, retryAfter = 15) {
    super(message); this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}

export async function readSessionJson(url, headers, { fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        const response = await fetchImpl(url, { headers, signal: controller.signal });
        if ([401, 403].includes(response.status)) {
          await response.body?.cancel();
          throw new SessionCheckError(response.status, "SESSION_INVALID", "Sesi tidak valid atau akses ditolak. Silakan masuk kembali.");
        }
        if (!response.ok) {
          const retryAfter = Math.min(120, Math.max(15, Number(response.headers?.get("retry-after")) || 15));
          await response.body?.cancel();
          throw new SessionCheckError(503, "AUTH_SERVICE_UNAVAILABLE", "Layanan autentikasi/profil sedang bermasalah. Coba kembali setelah pulih.", retryAfter);
        }
        return await response.json();
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new SessionCheckError(503, "AUTH_SERVICE_UNAVAILABLE", "Pemeriksaan sesi melewati batas waktu. Coba kembali setelah layanan pulih.")); }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof SessionCheckError) throw error;
    throw new SessionCheckError(503, "AUTH_SERVICE_UNAVAILABLE", "Layanan autentikasi/profil belum dapat dihubungi. Coba kembali setelah pulih.");
  } finally { clearTimeout(timer); }
}

export async function readSupabaseUser({ supabaseUrl, anonKey, jwt, ...options }) {
  const user = await readSessionJson(`${supabaseUrl}/auth/v1/user`, { Authorization: `Bearer ${jwt}`, apikey: anonKey }, options);
  if (!user?.id) throw new SessionCheckError(503, "AUTH_SERVICE_UNAVAILABLE", "Respons pemeriksaan sesi belum valid. Coba kembali setelah layanan pulih.");
  return user;
}

export function sendSessionError(res, error) {
  const known = error instanceof SessionCheckError;
  const status = known ? error.status : 503;
  res.setHeader("Cache-Control", "no-store");
  if (status === 503) res.setHeader("Retry-After", String(known ? error.retryAfter : 15));
  return res.status(status).json({ code: known ? error.code : "AUTH_SERVICE_UNAVAILABLE",
    error: known ? error.message : "Layanan autentikasi sedang bermasalah. Coba kembali setelah pulih." });
}
