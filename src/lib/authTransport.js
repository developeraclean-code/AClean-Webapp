// Protect Supabase Auth itself, which deliberately bypasses the REST read queue.
// No request replay, no password/token inspection, no persisted credentials.
export function createAuthTransport({ baseUrl, fetchImpl = (...args) => fetch(...args), now = Date.now,
  timeoutMs = 10_000, baseCooldownMs = 15_000, maxCooldownMs = 120_000 } = {}) {
  const origin = new URL(baseUrl).origin;
  let retryAt = 0, failures = 0;
  const unavailable = () => new Response(JSON.stringify({code:"APP_AUTH_PAUSED",msg:"Layanan login/koneksi sedang bermasalah; tunggu sebelum mencoba lagi."}),
    {status:503,headers:{"Content-Type":"application/json","Retry-After":String(Math.max(1,Math.ceil((retryAt-now())/1000)))}});
  return async function authFetch(input, options = {}) {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== origin || !url.pathname.startsWith("/auth/v1/")) return fetchImpl(input,options);
    if (now() < retryAt) return unavailable();
    const controller = new AbortController();
    const parentSignal = options.signal || (input instanceof Request ? input.signal : null);
    const onAbort = () => controller.abort(parentSignal.reason);
    if (parentSignal?.aborted) onAbort(); else parentSignal?.addEventListener("abort",onAbort,{once:true});
    let timer;
    try {
      const response = await Promise.race([
        Promise.resolve().then(async () => {
          const response = await fetchImpl(input,{...options,signal:controller.signal});
          // Bound the body too: Auth SDK parses it after fetch resolves.
          const body = await response.arrayBuffer();
          return new Response([204,205,304].includes(response.status) ? null : body,
            {status:response.status,statusText:response.statusText,headers:response.headers});
        }),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("Auth timeout"));},timeoutMs);}),
      ]);
      if (response.status === 429 || response.status >= 500) {
        const hint = Number(response.headers.get("retry-after"))*1000 || 0;
        retryAt = now()+Math.min(maxCooldownMs,Math.max(hint,baseCooldownMs*2**Math.min(failures++,3)));
      } else { failures=0; retryAt=0; }
      return response;
    } catch(error) {
      if (parentSignal?.aborted) throw error;
      retryAt = now()+Math.min(maxCooldownMs,baseCooldownMs*2**Math.min(failures++,3));
      return unavailable();
    } finally { clearTimeout(timer); parentSignal?.removeEventListener("abort",onAbort); }
  };
}
