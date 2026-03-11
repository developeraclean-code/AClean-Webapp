// api/debug-r2.js — TEMPORARY DEBUG, hapus setelah selesai
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const acctId = process.env.R2_ACCOUNT_ID;
  const accKey = process.env.R2_ACCESS_KEY;
  const secKey = process.env.R2_SECRET_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const pubUrl = process.env.R2_PUBLIC_URL;

  // Tampilkan nilai parsial untuk debug (aman)
  const result = {
    "1_R2_ACCOUNT_ID": acctId
      ? { status: "✅ ADA", length: acctId.length, preview: acctId.slice(0,8)+"...", correct: acctId.trim() === "8acabba7440e6437f1759855a96193b1" ? "✅ BENAR" : "❌ SALAH — harus: 8acabba7440e6437f1759855a96193b1" }
      : { status: "❌ TIDAK ADA" },

    "2_R2_BUCKET_NAME": bucket
      ? { status: "✅ ADA", value: bucket, correct: bucket.trim() === "aclean-files" ? "✅ BENAR" : `❌ SALAH — harus: aclean-files, bukan: "${bucket}"` }
      : { status: "❌ TIDAK ADA — default ke 'aclean-files'" },

    "3_R2_ACCESS_KEY": accKey
      ? { status: "✅ ADA", length: accKey.length, preview: accKey.slice(0,6)+"..." }
      : { status: "❌ TIDAK ADA" },

    "4_R2_SECRET_KEY": secKey
      ? { status: "✅ ADA", length: secKey.length }
      : { status: "❌ TIDAK ADA" },

    "5_R2_PUBLIC_URL": pubUrl || "(kosong — opsional)",
  };

  // Coba koneksi langsung ke R2 untuk tahu error sebenarnya
  if (acctId && accKey && secKey) {
    const bkt = bucket || "aclean-files";
    try {
      const { createHmac, createHash } = await import("crypto");
      const hmac = (k,d) => createHmac("sha256",k).update(d).digest();
      const hash = (d)   => createHash("sha256").update(d).digest("hex");

      const dts   = new Date().toISOString().replace(/[:\-]|\.\d{3}/g,"").slice(0,15)+"Z";
      const dshrt = dts.slice(0,8);
      const ph    = hash("");

      // Test: HEAD request ke bucket (lebih ringan dari GET)
      const canonH = `host:${acctId.trim()}.r2.cloudflarestorage.com\nx-amz-content-sha256:${ph}\nx-amz-date:${dts}\n`;
      const signH  = "host;x-amz-content-sha256;x-amz-date";
      const canon  = ["HEAD",`/${bkt.trim()}`,  "",canonH,signH,ph].join("\n");
      const scope  = `${dshrt}/auto/s3/aws4_request`;
      const sts    = ["AWS4-HMAC-SHA256",dts,scope,hash(canon)].join("\n");
      const sk     = hmac(hmac(hmac(hmac(`AWS4${secKey.trim()}`,dshrt),"auto"),"s3"),"aws4_request");
      const sig    = createHmac("sha256",sk).update(sts).digest("hex");
      const auth   = `AWS4-HMAC-SHA256 Credential=${accKey.trim()}/${scope}, SignedHeaders=${signH}, Signature=${sig}`;

      const url = `https://${acctId.trim()}.r2.cloudflarestorage.com/${bkt.trim()}`;
      result["6_CONNECTION_TEST"] = { url_tested: url };

      const r = await fetch(url, {
        method: "HEAD",
        headers: {
          "x-amz-content-sha256": ph,
          "x-amz-date": dts,
          "Authorization": auth,
        }
      });

      const rawError = r.ok ? null : await r.text().catch(()=>"(no body)");
      result["6_CONNECTION_TEST"].http_status = r.status;
      result["6_CONNECTION_TEST"].verdict = 
        r.status === 200 ? "✅ BUCKET DITEMUKAN — siap upload!" :
        r.status === 403 ? "❌ 403 Forbidden — Access Key/Secret Key salah atau token tidak punya izin" :
        r.status === 404 ? "❌ 404 Bucket tidak ada — nama bucket salah" :
        r.status === 400 ? "❌ 400 Bad Request — Account ID salah" :
        `❌ HTTP ${r.status}`;
      if (rawError) result["6_CONNECTION_TEST"].raw_error = rawError.slice(0,400);

    } catch(e) {
      result["6_CONNECTION_TEST"] = { error: e.message };
    }
  } else {
    result["6_CONNECTION_TEST"] = "⏭️ Skip — credentials tidak lengkap";
  }

  return res.status(200).json(result);
}
