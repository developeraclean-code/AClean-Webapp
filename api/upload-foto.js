// api/upload-foto.js
// POST /api/upload-foto { base64, filename, reportId, mimeType? }
// Upload foto laporan ke Cloudflare R2 via AWS4 Signature
// FIX: hapus Content-Length & Host dari headers (reserved di fetch API)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { base64, filename, reportId, mimeType = "image/jpeg" } = req.body || {};
  if (!base64 || !filename) return res.status(400).json({ error: "base64 dan filename wajib" });

  const acctId = (process.env.R2_ACCOUNT_ID || "").trim();
  const accKey = (process.env.R2_ACCESS_KEY  || "").trim();
  const secKey = (process.env.R2_SECRET_KEY  || "").trim();
  const bucket = (process.env.R2_BUCKET_NAME || "aclean-files").trim();
  const pubUrl = (process.env.R2_PUBLIC_URL  || "").trim();

  if (!acctId || !accKey || !secKey)
    return res.status(500).json({ error: "R2 credentials belum diset di Vercel env vars" });

  try {
    // Decode base64 → Buffer
    const raw  = base64.replace(/^data:[^;]+;base64,/, "");
    const buf  = Buffer.from(raw, "base64");

    if (buf.length === 0)
      return res.status(400).json({ error: "File kosong setelah decode base64" });

    // Build object key
    const safe   = (filename || "foto.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
    const folder = reportId ? `reports/${reportId}` : "uploads";
    const key    = `${folder}/${Date.now()}_${safe}`;

    // AWS4 Signature — TANPA Content-Length & Host di SignedHeaders
    // (kedua header itu reserved di fetch API, tidak bisa di-set manual)
    const { createHmac, createHash } = await import("crypto");
    const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
    const hash = (d)    => createHash("sha256").update(d).digest("hex");

    const now    = new Date();
    const dts    = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "") + "";
    // Format: 20260311T201700Z
    const dtsClean = now.toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z")
      .slice(0, 16) + "00Z"; // YYYYMMDDTHHmmssZ
    const dshrt  = dtsClean.slice(0, 8); // YYYYMMDD

    const payloadHash = hash(buf);

    // Signed headers: hanya x-amz-content-sha256 dan x-amz-date
    // (TIDAK include content-length dan host — reserved headers)
    const signedHeadersList = "x-amz-content-sha256;x-amz-date";
    const canonHeaders =
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${dtsClean}\n`;

    const canonRequest = [
      "PUT",
      `/${key}`,
      "", // no query string
      canonHeaders,
      signedHeadersList,
      payloadHash,
    ].join("\n");

    const credScope  = `${dshrt}/auto/s3/aws4_request`;
    const strToSign  = ["AWS4-HMAC-SHA256", dtsClean, credScope, hash(canonRequest)].join("\n");

    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${secKey}`, dshrt), "auto"), "s3"),
      "aws4_request"
    );
    const signature  = createHmac("sha256", signingKey).update(strToSign).digest("hex");
    const authHeader = `AWS4-HMAC-SHA256 Credential=${accKey}/${credScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;

    // Upload ke R2
    const uploadUrl = `https://${acctId}.r2.cloudflarestorage.com/${bucket}/${key}`;

    const r2Res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type":          mimeType,
        "x-amz-content-sha256":  payloadHash,
        "x-amz-date":            dtsClean,
        "Authorization":         authHeader,
      },
      body: buf,
    });

    if (!r2Res.ok) {
      const errBody = await r2Res.text();
      // Parse pesan error dari XML R2
      const msgMatch = errBody.match(/<Message>([^<]+)<\/Message>/);
      const codeMatch = errBody.match(/<Code>([^<]+)<\/Code>/);
      const errMsg = msgMatch ? msgMatch[1] : errBody.slice(0, 200);
      const errCode = codeMatch ? codeMatch[1] : r2Res.status;
      return res.status(500).json({
        success: false,
        error: `R2 ${errCode}: ${errMsg}`,
        http_status: r2Res.status,
      });
    }

    // Build public URL
    const fileUrl = pubUrl
      ? `${pubUrl.replace(/\/$/, "")}/${key}`
      : `https://${acctId}.r2.cloudflarestorage.com/${bucket}/${key}`;

    return res.status(200).json({ success: true, url: fileUrl, key });

  } catch (err) {
    console.error("upload-foto error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
