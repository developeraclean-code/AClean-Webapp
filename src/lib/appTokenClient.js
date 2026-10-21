// Per-tab, memory-only API token. Concurrent callers share one exchange/refresh;
// failures back off instead of turning every widget/poll into another Auth request.
export class AppTokenError extends Error {
  constructor(message, status = 503, code = "AUTH_SERVICE_UNAVAILABLE", retryAfter = 15) {
    super(message); this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}

export function createAppTokenClient({ auth, fetchImpl = (...args) => fetch(...args), now = Date.now,
  timeoutMs = 10_000, baseCooldownMs = 15_000, maxCooldownMs = 120_000 } = {}) {
  let userId = null, generation = 0, token = null, refreshAt = 0, expiresAt = 0;
  let pending = null, retryAt = 0, failures = 0, lastError = null;
  const validToken = () => token && now() < expiresAt;
  function setUser(id) {
    if (userId === id) return;
    userId = id; generation++; token = null; refreshAt = expiresAt = retryAt = failures = 0; pending = null; lastError = null;
  }
  function invalidate(rejectedToken) {
    // A late 401 from an old request must not erase a newer cached token.
    if (!rejectedToken || rejectedToken !== token) return;
    token = null; refreshAt = expiresAt = 0;
  }
  async function exchange(signal, expectedUser) {
    const sessionResult = await auth.getSession();
    const session = sessionResult?.data?.session;
    if (sessionResult?.error) throw new AppTokenError("Sesi belum dapat diperiksa. Tunggu layanan pulih.");
    if (!session?.access_token || session.user?.id !== expectedUser) throw new AppTokenError("Sesi tidak tersedia. Silakan masuk kembali.", 401, "SESSION_INVALID");
    let jwt = session.access_token;
    const post = bearer => {
      if (signal.aborted) throw new AppTokenError("Pemeriksaan sesi melewati batas waktu.");
      return fetchImpl("/api/get-api-token", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` }, signal });
    };
    let response = await post(jwt);
    // Only a definite session rejection permits one refresh; 503/429 never do.
    if (response.status === 401) {
      await response.body?.cancel();
      if (signal.aborted) throw new AppTokenError("Pemeriksaan sesi melewati batas waktu.");
      const refreshed = await auth.refreshSession();
      const fresh = refreshed?.data?.session;
      if (refreshed?.error) {
        const status = Number(refreshed.error.status);
        const unavailable = !status || status >= 500 || status === 429;
        throw new AppTokenError(unavailable ? "Layanan sesi sedang bermasalah. Coba kembali setelah pulih." : "Sesi tidak valid. Silakan masuk kembali.", unavailable ? 503 : 401, unavailable ? "AUTH_SERVICE_UNAVAILABLE" : "SESSION_INVALID");
      }
      if (!fresh?.access_token || fresh.user?.id !== expectedUser || fresh.access_token === jwt) throw new AppTokenError("Sesi tidak valid. Silakan masuk kembali.", 401, "SESSION_INVALID");
      jwt = fresh.access_token; response = await post(jwt);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new AppTokenError(
      response.status === 401 ? "Sesi tidak valid. Silakan masuk kembali."
        : response.status === 403 ? "Akses akun ditolak. Hubungi Owner."
        : "Layanan autentikasi/profil sedang bermasalah. Tunggu sebelum mencoba lagi.",
      [401,403].includes(response.status) ? response.status : 503,
      [401,403].includes(response.status) ? "SESSION_INVALID" : "AUTH_SERVICE_UNAVAILABLE",
      Math.min(120, Math.max(15, Number(response.headers?.get("retry-after")) || 15)));
    if (typeof body.token !== "string" || !body.token) throw new AppTokenError("Respons token belum valid. Tunggu layanan pulih.");
    const ttl = Number(body.expiresIn);
    if (!Number.isFinite(ttl) || ttl <= 0) throw new AppTokenError("Masa berlaku token belum valid. Tunggu layanan pulih.");
    return { token: body.token, ttlMs: Math.min(ttl, 900) * 1000 };
  }
  async function getToken() {
    if (!userId) throw new AppTokenError("Silakan masuk terlebih dahulu.", 401, "SESSION_INVALID");
    if (validToken() && now() < refreshAt) return token;
    if (pending) return pending;
    if (now() < retryAt) {
      if (validToken()) return token;
      throw new AppTokenError(lastError?.message || "Pemeriksaan sesi dijeda sementara.", lastError?.status || 503, lastError?.code, Math.max(1, Math.ceil((retryAt-now())/1000)));
    }
    const expectedGeneration = generation, expectedUser = userId;
    const controller = new AbortController();
    let timer;
    const work = (async () => {
      try {
        const issued = await Promise.race([
          exchange(controller.signal, expectedUser),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AppTokenError("Pemeriksaan sesi melewati batas waktu. Coba kembali setelah pulih.")); }, timeoutMs); }),
        ]);
        if (generation !== expectedGeneration) throw new AppTokenError("Sesi berubah. Silakan coba kembali.", 401, "SESSION_CHANGED");
        token = issued.token; expiresAt = now()+issued.ttlMs; refreshAt = expiresAt-Math.min(60_000,issued.ttlMs/2);
        retryAt = failures = 0; lastError = null; return token;
      } catch (error) {
        if (generation !== expectedGeneration) throw new AppTokenError("Sesi berubah. Silakan coba kembali.", 401, "SESSION_CHANGED");
        lastError = error instanceof AppTokenError ? error : new AppTokenError("Layanan autentikasi belum dapat dihubungi. Coba kembali setelah pulih.");
        const cooldown = Math.min(maxCooldownMs, Math.max(baseCooldownMs * 2 ** Math.min(failures++,3), lastError.retryAfter * 1000));
        retryAt = now()+cooldown;
        if (lastError.status === 401 || lastError.status === 403) token = null;
        // An already-issued token remains usable only until its real expiry.
        if (validToken()) return token;
        throw lastError;
      } finally { clearTimeout(timer); }
    })();
    pending = work;
    try { return await work; } finally { if(pending === work)pending = null; }
  }
  async function headers() { return { "Content-Type": "application/json", "X-Internal-Token": await getToken() }; }
  async function request(url, options = {}) {
    let sentToken;
    const send = async () => { const h = await headers(); sentToken = h["X-Internal-Token"]; return fetchImpl(url,{...options,headers:{...options.headers,...h}}); };
    try {
      const response = await send();
      if (response.status !== 401) return response;
      invalidate(sentToken);
      // Never automatically replay payment, upload, send-WA or any other mutation.
      if (!["GET","HEAD"].includes((options.method || "GET").toUpperCase())) return response;
      await response.body?.cancel();
      return await send();
    } catch (error) {
      if (!(error instanceof AppTokenError)) throw error;
      return new Response(JSON.stringify({code:error.code,error:error.message}), {status:error.status,headers:{"Content-Type":"application/json","Retry-After":String(error.retryAfter)}});
    }
  }
  return { setUser, getToken, headers, request, invalidate, reset: () => { setUser(null); } };
}
