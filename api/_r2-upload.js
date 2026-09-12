// R2 upload helper — Phase 2
// Re-usable di webhook grup, personal, dan tool bag.
// Pattern AWS Sig V4 — sama dgn /api/upload-foto endpoint existing.

import { createHash, createHmac } from "node:crypto";

const R2_ENV = () => ({
  accessKeyId:    process.env.R2_ACCESS_KEY,
  secretAccessKey:process.env.R2_SECRET_KEY,
  accountId:      process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID,
  bucket:         process.env.R2_BUCKET_NAME || "aclean-files",
});

export function hasR2Config() {
  const c = R2_ENV();
  return !!(c.accessKeyId && c.secretAccessKey && c.accountId);
}

// Hitung pemakaian bucket dengan ListObjectsV2. Dipanggil maksimal sekali sehari
// oleh alarm infrastruktur; tidak dipakai pada setiap render Monitoring.
export async function getR2BucketUsage({ maxPages = 100 } = {}) {
  const { accessKeyId, secretAccessKey, accountId, bucket } = R2_ENV();
  if (!accessKeyId || !secretAccessKey || !accountId) {
    return { ok: false, err: "R2 env not configured" };
  }
  const enc = (v) => encodeURIComponent(String(v)).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const decodeXml = (v) => String(v || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  let continuationToken = "";
  let bytes = 0;
  let objects = 0;
  let requests = 0;

  try {
    for (let page = 0; page < maxPages; page++) {
      const host = accountId + ".r2.cloudflarestorage.com";
      const now = new Date();
      const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
      const payloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      const params = { "list-type": "2", "max-keys": "1000" };
      if (continuationToken) params["continuation-token"] = continuationToken;
      const canonicalQuery = Object.keys(params).sort().map(k => `${enc(k)}=${enc(params[k])}`).join("&");
      const canonicalUri = `/${bucket}/`;
      const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
      const canonicalReq = ["GET", canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
      const credScope = `${dateStr}/auto/s3/aws4_request`;
      const strToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, createHash("sha256").update(canonicalReq).digest("hex")].join("\n");
      const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
      const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, dateStr), "auto"), "s3"), "aws4_request");
      const signature = createHmac("sha256", signingKey).update(strToSign).digest("hex");
      const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
      const response = await fetch(`https://${host}${canonicalUri}?${canonicalQuery}`, {
        headers: { Authorization: authorization, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash },
      });
      requests++;
      if (!response.ok) return { ok: false, err: `R2 LIST ${response.status}`, bytes, objects, requests };
      const xml = await response.text();
      const sizes = [...xml.matchAll(/<Size>(\d+)<\/Size>/g)];
      objects += sizes.length;
      sizes.forEach(match => { bytes += Number(match[1]) || 0; });
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) {
        return { ok: true, bucket, bytes, objects, requests, measuredAt: new Date().toISOString() };
      }
      continuationToken = decodeXml(xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]);
      if (!continuationToken) return { ok: false, err: "R2 pagination token missing", bytes, objects, requests };
    }
    return { ok: false, err: `R2 listing melewati ${maxPages} halaman`, bytes, objects, requests };
  } catch (err) {
    return { ok: false, err: err.message, bytes, objects, requests };
  }
}

/**
 * Upload buffer ke R2.
 * @param {object} args
 * @param {Buffer} args.buffer  - image buffer
 * @param {string} args.key     - R2 object key (e.g. "wa-group/2026-06/123abc.jpg")
 * @param {string} args.mimeType - "image/jpeg" | "image/png" | ...
 * @returns {Promise<{ok: boolean, key?: string, url?: string, err?: string}>}
 */
export async function uploadBufferToR2({ buffer, key, mimeType }) {
  const { accessKeyId, secretAccessKey, accountId, bucket } = R2_ENV();
  if (!accessKeyId || !secretAccessKey || !accountId) {
    return { ok: false, err: "R2 env not configured" };
  }
  if (!buffer || !key || !mimeType) {
    return { ok: false, err: "missing buffer/key/mimeType" };
  }
  try {
    const host = accountId + ".r2.cloudflarestorage.com";
    const endpoint = "https://" + host + "/" + bucket + "/" + key;
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const payloadHash = createHash("sha256").update(buffer).digest("hex");

    const canonicalHeaders = `content-type:${mimeType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
    const canonicalUri = "/" + bucket + "/" + encodeURIComponent(key).replace(/%2F/g, "/");
    const canonicalReq = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const credScope = `${dateStr}/auto/s3/aws4_request`;
    const reqHash = createHash("sha256").update(canonicalReq).digest("hex");
    const strToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, reqHash].join("\n");
    const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
    const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, dateStr), "auto"), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(strToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const r2res = await fetch(endpoint, {
      method: "PUT",
      headers: {
        "Authorization": authorization,
        "Content-Type": mimeType,
        "x-amz-date": amzDate,
        "x-amz-content-sha256": payloadHash,
        "Content-Length": String(buffer.length),
      },
      body: buffer,
    });
    if (!r2res.ok) {
      const errTxt = await r2res.text().catch(() => "");
      return { ok: false, err: `R2 PUT ${r2res.status}: ${errTxt.slice(0, 200)}` };
    }
    // Frontend render via /api/foto?key=... (proxy untuk privacy, no public domain hardcode)
    return { ok: true, key, url: "/api/foto?key=" + encodeURIComponent(key) };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

/**
 * Download URL → buffer + mime type.
 * Untuk Fonnte URL biar bisa di-mirror ke R2 sebelum URL expired.
 */
export async function downloadToBuffer(url, { timeoutMs = 15000 } = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ok: false, err: `download ${r.status}` };
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length < 1024) return { ok: false, err: "too small (<1KB)" };
    const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    return { ok: true, buffer: buf, mimeType: ct, size: buf.length };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}
