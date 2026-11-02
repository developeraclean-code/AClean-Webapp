// A portal token grants access only to image keys present in that portal's
// currently visible reports. It never acts as a general R2 read credential.
import { buildPhoneVariants } from "./_validate.js";
import { extractR2Key } from "./_r2-key.js";

const mediaKey = value => extractR2Key(value, process.env.R2_BUCKET_NAME || "aclean-files");
const containsKey = (values, key) => Array.isArray(values) && values.some(value => mediaKey(value) === key);
const photoMetadata = value => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
};
const expired = value => !value || !Number.isFinite(new Date(value).getTime()) || new Date(value) <= new Date();

export function portalTokenKind(token) {
  if (/^[a-f0-9]{48}$/.test(token)) return "customer";
  if (/^mtk_[a-z0-9]{40}$/.test(token)) return "maintenance";
  if (/^ptk_[a-z0-9]{40}$/.test(token)) return "project";
  return null;
}

export async function authorizePortalMedia(token, key, { fetchImpl = fetch, env = process.env } = {}) {
  const kind = portalTokenKind(token);
  if (!kind) return { status: 404, allowed: false };
  const base = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const secret = env.SUPABASE_SERVICE_KEY;
  if (!base || !secret) return { status: 503, allowed: false };
  const headers = { apikey: secret, Authorization: `Bearer ${secret}` };

  const rows = async (table, query) => {
    const url = new URL(`/rest/v1/${table}`, base);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const response = await fetchImpl(url.toString(), { headers, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Portal media database unavailable");
    const result = await response.json();
    if (!Array.isArray(result)) throw new Error("Invalid portal media database response");
    return result;
  };

  try {
    if (kind === "customer") {
      const [record] = await rows("customer_tokens", { token: `eq.${token}`, select: "phone,expires_at", limit: "1" });
      if (!record) return { status: 404, allowed: false };
      if (expired(record.expires_at)) return { status: 401, allowed: false };
      const phones = buildPhoneVariants(record.phone);
      if (!phones.length) return { status: 404, allowed: false };
      const orders = await rows("orders", {
        or: `(${phones.map(phone => `phone.eq.${phone}`).join(",")})`,
        select: "id", order: "date.desc,time.desc", limit: "20",
      });
      if (!orders.length) return { status: 404, allowed: false };
      const reports = await rows("service_reports", {
        or: `(${orders.map(order => `job_id.eq.${order.id}`).join(",")})`,
        status: "eq.VERIFIED", select: "foto_urls,fotos", order: "date.desc", limit: "20",
      });
      const allowed = reports.some(report => containsKey(report.foto_urls, key)
        || photoMetadata(report.fotos).some(foto => mediaKey(foto?.url) === key));
      return { status: allowed ? 200 : 404, allowed };
    }

    if (kind === "maintenance") {
      const [client] = await rows("maintenance_clients", {
        portal_token: `eq.${token}`, select: "id,token_active,token_expires_at", limit: "1",
      });
      if (!client) return { status: 404, allowed: false };
      if (!client.token_active) return { status: 403, allowed: false };
      if (client.token_expires_at && expired(client.token_expires_at)) return { status: 401, allowed: false };
      const logs = await rows("maintenance_logs", { client_id: `eq.${client.id}`, select: "photos" });
      const allowed = logs.some(log => containsKey(log.photos, key));
      return { status: allowed ? 200 : 404, allowed };
    }

    const [project] = await rows("project_projects", {
      portal_token: `eq.${token}`, select: "id,token_active", limit: "1",
    });
    if (!project) return { status: 404, allowed: false };
    if (!project.token_active) return { status: 403, allowed: false };
    const reports = await rows("project_daily_reports", {
      project_id: `eq.${project.id}`, status: "eq.VERIFIED", select: "foto_urls", order: "tanggal.desc", limit: "200",
    });
    const allowed = reports.some(report => containsKey(report.foto_urls, key));
    return { status: allowed ? 200 : 404, allowed };
  } catch {
    return { status: 503, allowed: false };
  }
}
