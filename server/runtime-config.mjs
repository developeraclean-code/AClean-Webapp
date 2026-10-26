// Fail closed before binding a public listener. Do not print secret values.
export function validateRuntimeConfig(env = process.env) {
  // cron-reminder imports _tasks/_shared.js at startup, which requires OWNER_PHONE.
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'INTERNAL_API_SECRET', 'FONNTE_WEBHOOK_SECRET', 'CRON_SECRET', 'OWNER_PHONE', 'APP_URL', 'ALLOWED_ORIGIN'];
  const missing = required.filter(name => !String(env[name] || '').trim());
  if (!env.SUPABASE_ANON_KEY && !env.VITE_SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY');
  if (missing.length) throw new Error(`Self-host konfigurasi belum lengkap: ${missing.join(', ')}`);
  if (String(env.INTERNAL_API_SECRET).length < 32) throw new Error('INTERNAL_API_SECRET minimal 32 karakter');
  if (String(env.FONNTE_WEBHOOK_SECRET).length < 32) throw new Error('FONNTE_WEBHOOK_SECRET minimal 32 karakter');
  if (String(env.CRON_SECRET).length < 32) throw new Error('CRON_SECRET minimal 32 karakter');
  let appUrl, allowedOrigin;
  try {
    appUrl = new URL(env.APP_URL);
    allowedOrigin = new URL(env.ALLOWED_ORIGIN);
  } catch { throw new Error('APP_URL dan ALLOWED_ORIGIN harus URL valid'); }
  if (appUrl.protocol !== 'https:' || allowedOrigin.protocol !== 'https:') {
    throw new Error('APP_URL dan ALLOWED_ORIGIN harus HTTPS');
  }
  if (appUrl.origin !== allowedOrigin.origin) {
    throw new Error('ALLOWED_ORIGIN harus sama dengan origin APP_URL');
  }
  if (appUrl.pathname !== '/' || appUrl.search || appUrl.hash) {
    throw new Error('APP_URL harus origin tanpa path/query/fragment');
  }
  return true;
}
