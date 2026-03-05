// api/upload-foto.js
// POST /api/upload-foto { base64, filename, reportId, mimeType? }
// Upload foto laporan ke Cloudflare R2

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({error:"Method not allowed"});

  const { base64, filename, reportId, mimeType="image/jpeg" } = req.body||{};
  if (!base64 || !filename) return res.status(400).json({error:"base64 dan filename wajib"});

  const acctId = process.env.R2_ACCOUNT_ID;
  const accKey = process.env.R2_ACCESS_KEY;
  const secKey = process.env.R2_SECRET_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "aclean-files";
  const pubUrl = process.env.R2_PUBLIC_URL;

  if (!acctId || !accKey || !secKey)
    return res.status(500).json({error:"R2 credentials belum diset (R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY)"});

  try {
    const raw    = base64.replace(/^data:image\/\w+;base64,/,"");
    const buf    = Buffer.from(raw,"base64");
    const safe   = filename.replace(/[^a-zA-Z0-9._-]/g,"_");
    const folder = reportId ? `reports/${reportId}` : "uploads";
    const key    = `${folder}/${Date.now()}_${safe}`;

    const { createHmac, createHash } = await import("crypto");
    const hmac = (k,d) => createHmac("sha256",k).update(d).digest();
    const hash = (d)   => createHash("sha256").update(d).digest("hex");

    const dts   = new Date().toISOString().replace(/[:\-]|\.\d{3}/g,"").slice(0,15)+"Z";
    const dshrt = dts.slice(0,8);
    const ph    = hash(buf);
    const clen  = buf.length.toString();

    const canonH = `content-length:${clen}\ncontent-type:${mimeType}\nhost:${acctId}.r2.cloudflarestorage.com\nx-amz-content-sha256:${ph}\nx-amz-date:${dts}\n`;
    const signH  = "content-length;content-type;host;x-amz-content-sha256;x-amz-date";
    const canon  = ["PUT",`/${bucket}/${key}`,"",canonH,signH,ph].join("\n");
    const scope  = `${dshrt}/auto/s3/aws4_request`;
    const sts    = ["AWS4-HMAC-SHA256",dts,scope,hash(canon)].join("\n");
    const sk     = hmac(hmac(hmac(hmac(`AWS4${secKey}`,dshrt),"auto"),"s3"),"aws4_request");
    const sig    = createHmac("sha256",sk).update(sts).digest("hex");
    const auth   = `AWS4-HMAC-SHA256 Credential=${accKey}/${scope}, SignedHeaders=${signH}, Signature=${sig}`;

    const r = await fetch(`https://${acctId}.r2.cloudflarestorage.com/${bucket}/${key}`, {
      method:"PUT",
      headers:{
        "Content-Type":mimeType,"Content-Length":clen,
        "x-amz-content-sha256":ph,"x-amz-date":dts,
        "Host":`${acctId}.r2.cloudflarestorage.com`,"Authorization":auth
      },
      body: buf
    });

    if (!r.ok) throw new Error(`R2 ${r.status}: ${await r.text()}`);

    const url = pubUrl ? `${pubUrl}/${key}` : `https://${acctId}.r2.cloudflarestorage.com/${bucket}/${key}`;
    return res.status(200).json({success:true, url, key});
  } catch(err) {
    return res.status(500).json({error: err.message});
  }
}
