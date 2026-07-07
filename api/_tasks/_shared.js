// api/_tasks/_shared.js — Helper & klien bersama semua task cron (dipindah APA
// ADANYA dari api/cron-reminder.js saat pemecahan ke _tasks/, Jul 2026).
import { createClient } from "@supabase/supabase-js";
import { createHmac, createHash } from "crypto";

export const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const OWNER_PHONE  = process.env.OWNER_PHONE;
if (!OWNER_PHONE) {
  throw new Error("[CRITICAL] OWNER_PHONE environment variable is required but not set");
}
export const FONNTE_TOKEN = process.env.FONNTE_TOKEN  || "";

export async function sendWA(phone, message) {
  if (!FONNTE_TOKEN || !phone) return false;
  try {
    const r = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { "Authorization": FONNTE_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ target: phone, message, countryCode: "62" }),
    });
    const d = await r.json();
    return d.status === true;
  } catch(e) { return false; }
}

// Cek toggle dari cron_jobs JSON (sumber utama) atau key lama (fallback)
// Mengembalikan true jika job aktif, default ON jika belum diset
export function isCronJobEnabled(settingsMap, backendKey) {
  if (settingsMap.cron_jobs) {
    try {
      const jobs = JSON.parse(settingsMap.cron_jobs);
      const job = jobs.find(j => j.backendKey === backendKey);
      if (job) return job.active !== false;
    } catch (_) {}
  }
  // Fallback ke key lama
  return settingsMap[backendKey] !== "false";
}

export function fmt(n) { return "Rp" + (Number(n)||0).toLocaleString("id-ID"); }

export function daysSince(d) { return d ? Math.floor((Date.now()-new Date(d).getTime())/86400000) : 0; }

export async function log(action, detail, status="SUCCESS") {
  try {
    const { error } = await sb.from("agent_logs").insert({
      action, detail, status,
      time: new Date().toISOString()
    });
    if (error) console.error("[CRON_LOG_ERROR]", {action, error: error.message});
  } catch(err) {
    console.error("[CRON_LOG_ERROR]", {action, error: err.message});
  }
}

// ──────────────────────────────────────────────────
// AWS Sig V4 Delete for R2 Objects
// ──────────────────────────────────────────────────
export async function deleteR2Object(key) {
  const { createHmac, createHash } = await import("crypto");
  const accessKeyId = process.env.R2_ACCESS_KEY;
  const secretAccessKey = process.env.R2_SECRET_KEY;
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME || "aclean-files";

  if (!accessKeyId || !secretAccessKey || !accountId) {
    console.warn("[CLEANUP_R2] R2 credentials not configured, skipping delete");
    return false;
  }

  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0,10).replace(/-/g,"");
    const timeStr = now.toISOString().replace(/[-:\.]/g,"").slice(0,15) + "Z";
    const host = accountId + ".r2.cloudflarestorage.com";
    const region = "auto", service = "s3";

    const canonicalUri = "/" + bucket + "/" + key;
    const payloadHash = createHash("sha256").update("").digest("hex");
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timeStr}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = ["DELETE", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

    const credScope = [dateStr, region, service, "aws4_request"].join("/");
    const strToSign = ["AWS4-HMAC-SHA256", timeStr, credScope,
      createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");

    const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
    const signingKey = hmac(hmac(hmac(hmac("AWS4"+secretAccessKey, dateStr), region), service), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(strToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const r = await fetch("https://" + host + canonicalUri, {
      method: "DELETE",
      headers: {
        "Host": host,
        "x-amz-date": timeStr,
        "x-amz-content-sha256": payloadHash,
        "Authorization": authorization
      }
    });
    return r.ok || r.status === 204 || r.status === 404;
  } catch(e) {
    console.error("[CLEANUP_R2_DELETE_ERROR]", {key, error: e.message});
    return false;
  }
}

