// Bound public monitoring work and coalesce simultaneous pings per warm instance.
// This cache is local to the function instance, never a global service SLA.
export function createHealthCheck({ fetchImpl = (...args) => fetch(...args), now = Date.now,
  timeoutMs = 3000, ttlMs = 15_000 } = {}) {
  let pending = null, cached = null, expiresAt = 0;
  async function probe(url, options) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(async () => {
          const response = await fetchImpl(url, { ...options, signal: controller.signal });
          // No response payload is needed. Release the connection without reading logs.
          await response.body?.cancel();
          return response.ok ? 'ok' : `fail:${response.status}`;
        }),
        new Promise(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve('fail:timeout'); }, timeoutMs);
        }),
      ]);
    } catch { return controller.signal.aborted ? 'fail:timeout' : 'fail:network'; }
    finally { clearTimeout(timer); }
  }
  return async (env = process.env) => {
    if (pending) return pending;
    if (cached && now() < expiresAt) return cached;
    pending = (async () => {
      const started = now();
      const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL, key = env.SUPABASE_SERVICE_KEY;
      const authKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || key;
      const [supabase, auth, fonnte] = await Promise.all([
        url && key ? probe(url + '/rest/v1/agent_logs?select=id&limit=1', {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        }) : 'not_configured',
        url && authKey ? probe(url + '/auth/v1/health', {
          headers: { apikey: authKey },
        }) : 'not_configured',
        env.FONNTE_TOKEN ? probe('https://api.fonnte.com/validate', {
          method: 'POST', headers: { Authorization: env.FONNTE_TOKEN },
        }) : 'not_configured',
      ]);
      const providers = [['ANTHROPIC_API_KEY','claude'],['OPENAI_API_KEY','openai'],['GROQ_API_KEY','groq'],['GEMINI_API_KEY','gemini']]
        .filter(([name]) => env[name]).map(([, name]) => name);
      const diagnosis = supabase === 'ok' && auth === 'ok' ? 'none'
        : supabase === 'not_configured' || auth === 'not_configured' ? 'configuration'
        : supabase !== 'ok' && auth !== 'ok' ? 'shared_gateway_or_network'
        : supabase !== 'ok' ? 'database_api_or_postgrest' : 'auth_service';
      cached = { status: diagnosis === 'none' ? 'healthy' : 'unhealthy', diagnosis,
        timestamp: new Date(now()).toISOString(), duration_ms: now() - started,
        checks: { supabase, database: supabase, auth, fonnte,
          ai: providers.length ? `ok:${providers.join(',')}` : 'not_configured' },
        version: (env.ACLEAN_BUILD_SHA || env.VERCEL_GIT_COMMIT_SHA)?.slice(0, 7) || 'dev' };
      expiresAt = now() + ttlMs;
      return cached;
    })().finally(() => { pending = null; });
    return pending;
  };
}

export const checkHealth = createHealthCheck();

export function selectHealthComponent(result, component) {
  if (component === 'database') return result.checks.database;
  if (component === 'auth') return result.checks.auth;
  return result.status === 'healthy' ? 'ok' : 'fail';
}
