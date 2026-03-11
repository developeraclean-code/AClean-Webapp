// api/upload-foto.js — v3 FIXED
// POST { base64, filename, reportId, mimeType? }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { base64, filename, reportId, mimeType = "image/jpeg" } = req.body || {};
  if (!base64 || !filename)
    return res.status(400).json({ error: "base64 dan filename wajib" });

  const acctId = (process.env.R2_ACCOUNT_ID || "").trim();
  const accKey = (process.env.R2_ACCESS_KEY  || "").trim();
  const secKey = (process.env.R2_SECRET_KEY  || "").trim();
  const bucket = (process.env.R2_BUCKET_NAME || "aclean-files").trim();
  const pubUrl = (process.env.R2_PUBLIC_URL  || "").trim();

  if (!acctId || !accKey || !secKey)
    return res.status(500).json({ error: "R2 credentials belum diset di Vercel env vars" });

  try {
    // Decode base64
    const raw = base64.replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 0)
      return res.status(400).json({ error: "File kosong setelah decode" });

    // Object key
    const safe   = (filename || "foto.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
    const folder = reportId ? `reports/${reportId}` : "uploads";
    const key    = `${folder}/${Date.now()}_${safe}`;

    // AWS4 Signature
    const { createHmac, createHash } = await import("crypto");
    const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
    const hash = (d)    => createHash("sha256").update(d).digest("hex");

    // Timestamp — format: 20260311T202600Z (16 chars)
    const dts   = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
    const dshrt = dts.slice(0, 8); // YYYYMMDD

    const payloadHash    = hash(buf);
    const signedHeaders  = "content-type;x-amz-content-sha256;x-amz-date";
    const canonHeaders   =
      `content-type:${mimeType}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${dts}\n`;

    const canonRequest = [
      "PUT",
      `/${key}`,
      "",
      canonHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const scope      = `${dshrt}/auto/s3/aws4_request`;
    const strToSign  = ["AWS4-HMAC-SHA256", dts, scope, hash(canonRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secKey}`, dshrt), "auto"), "s3"), "aws4_request");
    const signature  = createHmac("sha256", signingKey).update(strToSign).digest("hex");
    const auth       = `AWS4-HMAC-SHA256 Credential=${accKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // PUT ke R2
    const uploadUrl = `https://${acctId}.r2.cloudflarestorage.com/${bucket}/${key}`;
    const r2 = await fetch(uploadUrl, {
      method:  "PUT",
      headers: {
        "Content-Type":         mimeType,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date":           dts,
        "Authorization":        auth,
      },
      body: buf,
    });

    if (!r2.ok) {
      const xml      = await r2.text();
      const code     = (xml.match(/<Code>([^<]+)/)     || [])[1] || r2.status;
      const message  = (xml.match(/<Message>([^<]+)/)  || [])[1] || xml.slice(0, 200);
      return res.status(500).json({ success: false, error: `R2 ${code}: ${message}` });
    }

    const fileUrl = pubUrl
      ? `${pubUrl.replace(/\/$/, "")}/${key}`
      : `https://${acctId}.r2.cloudflarestorage.com/${bucket}/${key}`;

    return res.status(200).json({ success: true, url: fileUrl, key });

  } catch (err) {
    console.error("upload-foto:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
