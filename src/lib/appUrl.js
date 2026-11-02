export const APP_BASE_URL = "https://app.aclean.id";

const LEGACY_APP_HOSTS = new Set([
  "a-clean-webapp.vercel.app",
  "aclean.vercel.app",
  "status.aclean.id",
]);

export function normalizeAppBaseUrl(value) {
  const candidate = String(value || APP_BASE_URL).trim();
  try {
    const url = new URL(candidate);
    if (LEGACY_APP_HOSTS.has(url.hostname)) return APP_BASE_URL;
    return (url.origin + url.pathname).replace(/\/+$/, "");
  } catch {
    return APP_BASE_URL;
  }
}

// The database may already contain the dedicated customer hostname while its
// old Vercel deployment is paused. Use it for links only after Coolify serves
// that hostname and the redirect-ready runtime flag has been enabled.
export function normalizePortalBaseUrl(value, { ready = false } = {}) {
  try {
    const url = new URL(String(value || APP_BASE_URL).trim());
    if (url.hostname === "status.aclean.id") return ready ? "https://status.aclean.id" : APP_BASE_URL;
  } catch { /* Keep the existing safe fallback. */ }
  return normalizeAppBaseUrl(value);
}
