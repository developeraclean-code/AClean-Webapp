// API authorization for isolated staging and explicitly enabled self-hosting.
// This does not revoke existing public R2 URLs; those need a separate migration.
import { verifyAppToken } from "./_auth.js";
import { readSessionJson, SessionCheckError } from "./_session-check.js";

const COOKIE_NAME = "aclean_staging_media";
const ACTIVE_ROLES = new Set(["Owner", "Admin", "Finance", "Teknisi", "Helper"]);

export const isPrivateStagingMedia = () => process.env.R2_BUCKET_NAME === "aclean-staging-media";
export const isMediaAuthRequired = () => isPrivateStagingMedia()
  || process.env.ACLEAN_MEDIA_AUTH_REQUIRED === "true";

export function setStagingMediaCookie(res, token) {
  if (!isMediaAuthRequired()) return;
  res.setHeader("Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/api/foto; Max-Age=900; HttpOnly; Secure; SameSite=Strict`);
}

export function clearStagingMediaCookie(res) {
  if (!isMediaAuthRequired()) return;
  res.setHeader("Set-Cookie",
    `${COOKIE_NAME}=; Path=/api/foto; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

function claimsFromCookie(header) {
  if (typeof header !== "string" || header.length > 8192) return null;
  const pair = header.split(";").map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE_NAME}=`));
  return pair ? verifyAppToken(pair.slice(COOKIE_NAME.length + 1)) : null;
}

export async function stagingMediaActor(req, { cookie = false } = {}) {
  const claims = cookie ? claimsFromCookie(req.headers?.cookie) : req.appClaims;
  const id = claims?.userId || (!cookie && req.authUser?.id);
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(id || ""))) {
    throw new SessionCheckError(401, "MEDIA_SESSION_REQUIRED", "Masuk kembali untuk membuka media.");
  }
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !service) throw new SessionCheckError(503, "AUTH_SERVICE_UNAVAILABLE", "Konfigurasi profil belum tersedia.");
  const profiles = await readSessionJson(
    `${base}/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}&select=id,name,role,active&limit=1`,
    { apikey: service, Authorization: `Bearer ${service}` });
  if (!Array.isArray(profiles)) throw new SessionCheckError(503, "AUTH_SERVICE_UNAVAILABLE", "Respons profil belum valid.");
  const profile = profiles[0];
  if (!profile || profile.id !== id || profile.active !== true || !ACTIVE_ROLES.has(profile.role)) {
    throw new SessionCheckError(403, "MEDIA_FORBIDDEN", "Akses media tidak diizinkan.");
  }
  return profile;
}

const sameMember = (member, name) =>
  typeof member === "string" && member.trim().toLocaleLowerCase("id-ID") === name.trim().toLocaleLowerCase("id-ID");

export async function canAccessStagingMedia(actor, key) {
  if (actor.role === "Owner" || actor.role === "Admin") return true;
  if (actor.role === "Finance") {
    return /^(invoices?|payments)\//.test(key) || /^laporan\/bukti-[A-Za-z0-9_-]+\//.test(key);
  }
  if (actor.role !== "Teknisi" && actor.role !== "Helper") return false;
  const match = /^laporan\/([A-Za-z0-9_-]{1,100})\//.exec(key);
  if (!match || !actor.name) return false;
  const jobId = match[1];
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !service) throw new SessionCheckError(503, "AUTH_SERVICE_UNAVAILABLE", "Konfigurasi job belum tersedia.");
  const query = new URLSearchParams({
    or: `(id.eq.${jobId},parent_job_id.eq.${jobId})`,
    select: "teknisi,teknisi2,teknisi3,helper,helper2,helper3,assigned_members",
    limit: "20",
  });
  const orders = await readSessionJson(`${base}/rest/v1/orders?${query}`,
    { apikey: service, Authorization: `Bearer ${service}` });
  if (!Array.isArray(orders)) throw new SessionCheckError(503, "AUTH_SERVICE_UNAVAILABLE", "Respons job belum valid.");
  return orders.some(order => {
    const crew = [order.teknisi, order.teknisi2, order.teknisi3,
      order.helper, order.helper2, order.helper3, ...(Array.isArray(order.assigned_members) ? order.assigned_members : [])];
    return crew.some(member => sameMember(member, actor.name));
  });
}

export function stagingUploadProbe(body) {
  const folder = body.reportId ? `laporan/${body.reportId}` : (body.folder || "laporan");
  // Do not normalize an unauthorized folder into an authorized one.
  if (typeof folder !== "string" || !/^[a-zA-Z0-9_\-/.]{1,180}$/.test(folder)
    || folder.includes("..") || folder.includes("//")) return null;
  return `${folder.replace(/\/$/, "")}/__upload.jpg`;
}
