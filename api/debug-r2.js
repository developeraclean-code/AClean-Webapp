// api/debug-r2.js
// Endpoint sementara untuk cek konfigurasi R2 — HAPUS setelah selesai debug
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  
  const acctId = process.env.R2_ACCOUNT_ID;
  const accKey = process.env.R2_ACCESS_KEY;
  const secKey = process.env.R2_SECRET_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "aclean-files";
  const pubUrl = process.env.R2_PUBLIC_URL;

  // Tampilkan sebagian saja (aman, tidak expose full credentials)
  const info = {
    R2_ACCOUNT_ID:  acctId  ? acctId.slice(0,8)+"..." : "❌ TIDAK ADA",
    R2_ACCESS_KEY:  accKey  ? accKey.slice(0,6)+"..."  : "❌ TIDAK ADA",
    R2_SECRET_KEY:  secKey  ? "✅ ada ("+secKey.length+" karakter)" : "❌ TIDAK ADA",
    R2_BUCKET_NAME: bucket  || "❌ TIDAK ADA",
    R2_PUBLIC_URL:  pubUrl  || "⚠️ kosong (opsional)",
    all_set: !!(acctId && accKey && secKey && bucket),
  };

  // Coba list buckets via S3 API untuk verifikasi account ID benar
  if (acctId && accKey && secKey) {
    try {
      const { createHmac, createHash } = await import("crypto");
      const hmac = (k,d) => createHmac("sha256",k).update(d).digest();
      const hash = (d)   => createHash("sha256").update(d).digest("hex");
      
      const dts   = new Date().toISOString().replace(/[:\-]|\.\d{3}/g,"").slice(0,15)+"Z";
      const dshrt = dts.slice(0,8);
      const ph    = hash("");
      
      // GET / untuk list buckets
      const canonH = `host:${acctId}.r2.cloudflarestorage.com\nx-amz-content-sha256:${ph}\nx-amz-date:${dts}\n`;
      const signH  = "host;x-amz-content-sha256;x-amz-date";
      const canon  = ["GET","/","",canonH,signH,ph].join("\n");
      const scope  = `${dshrt}/auto/s3/aws4_request`;
      const sts    = ["AWS4-HMAC-SHA256",dts,scope,hash(canon)].join("\n");
      const sk     = hmac(hmac(hmac(hmac(`AWS4${secKey}`,dshrt),"auto"),"s3"),"aws4_request");
      const sig    = createHmac("sha256",sk).update(sts).digest("hex");
      const auth   = `AWS4-HMAC-SHA256 Credential=${accKey}/${scope}, SignedHeaders=${signH}, Signature=${sig}`;

      const r = await fetch(`https://${acctId}.r2.cloudflarestorage.com/`, {
        headers: {
          "x-amz-content-sha256": ph,
          "x-amz-date": dts,
          "Authorization": auth,
        }
      });
      const text = await r.text();
      
      // Parse bucket names dari XML response
      const bucketMatches = [...text.matchAll(/<Name>([^<]+)<\/Name>/g)];
      const buckets = bucketMatches.map(m => m[1]);
      
      info.r2_connection = r.ok ? "✅ Terkoneksi" : `❌ HTTP ${r.status}`;
      info.buckets_found = buckets.length > 0 ? buckets : ["(kosong — belum ada bucket)"];
      info.target_bucket_exists = buckets.includes(bucket) ? "✅ ADA" : `❌ TIDAK ADA — buat bucket "${bucket}" dulu di Cloudflare R2`;
      if (!r.ok) info.raw_response = text.slice(0,300);
    } catch(e) {
      info.r2_connection = "❌ Error: " + e.message;
    }
  }

  return res.status(200).json(info);
}
