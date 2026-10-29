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
