// api/foto.js
// GET /api/foto?key=reports/ORD001/123_foto.jpg
// Proxy foto dari R2 ke browser — SSL dari Vercel, tidak perlu domain sendiri

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).end();

  const { key } = req.query;
  if (!key) return res.status(400).json({ error: "key wajib" });

  const acctId = (process.env.R2_ACCOUNT_ID || "").trim();
  const accKey = (process.env.R2_ACCESS_KEY  || "").trim();
  const secKey = (process.env.R2_SECRET_KEY  || "").trim();
  const bucket = (process.env.R2_BUCKET_NAME || "aclean-files").trim();

  if (!acctId || !accKey || !secKey)
    return res.status(500).json({ error: "R2 credentials tidak ada" });

  try {
    const { createHmac, createHash } = await import("crypto");
    const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
    const hash = (d)    => createHash("sha256").update(d).digest("hex");

    const dts   = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
    const dshrt = dts.slice(0, 8);
    const ph    = hash(""); // GET = empty body

    const signedHeaders = "x-amz-content-sha256;x-amz-date";
    const canonHeaders  =
      `x-amz-content-sha256:${ph}\n` +
      `x-amz-date:${dts}\n`;

    const canonUri     = `/${bucket}/${key}`;
    const canonRequest = ["GET", canonUri, "", canonHeaders, signedHeaders, ph].join("\n");

    const scope      = `${dshrt}/auto/s3/aws4_request`;
    const strToSign  = ["AWS4-HMAC-SHA256", dts, scope, hash(canonRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secKey}`, dshrt), "auto"), "s3"), "aws4_request");
    const signature  = createHmac("sha256", signingKey).update(strToSign).digest("hex");
    const auth       = `AWS4-HMAC-SHA256 Credential=${accKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const r2Url = `https://${acctId}.r2.cloudflarestorage.com/${bucket}/${key}`;
    const r2 = await fetch(r2Url, {
      headers: {
        "x-amz-content-sha256": ph,
        "x-amz-date":           dts,
        "Authorization":        auth,
      },
    });

    if (!r2.ok) {
      if (r2.status === 404) return res.status(404).json({ error: "Foto tidak ditemukan" });
      return res.status(r2.status).json({ error: `R2 error ${r2.status}` });
    }

    // Stream foto ke browser dengan cache 1 tahun
    const contentType = r2.headers.get("content-type") || "image/jpeg";
    const buf = await r2.arrayBuffer();

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(Buffer.from(buf));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
