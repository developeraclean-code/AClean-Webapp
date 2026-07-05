// api/_handlers/foto.js — Handler grup foto/R2 (Batch 4 pemecahan router, Jul 2026).
// Isi blok dipindah APA ADANYA (ekstraksi programatik) dari api/[route].js.

    // ── UPLOAD-FOTO ──
export async function uploadFoto(req, res) {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const body = req.body || {};

      // App.jsx mengirim: { base64, filename, reportId, mimeType }
      const rawData  = body.base64 || body.fileData || "";
      const fileName = body.filename || body.fileName || ("foto_" + Date.now() + ".jpg");
      const mimeType = body.mimeType || body.fileType || "image/jpeg";
      // Sanitize folder — cegah path traversal kalau client kirim folder bebas
      const rawFolder = body.reportId ? ("laporan/" + body.reportId) : (body.folder || "laporan");
      const folder = String(rawFolder).replace(/\.\./g, "").replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9_\-/.]/g, "_");

      if (!rawData) {
        console.error("[upload-foto] body kosong. Fields:", Object.keys(body));
        return res.status(400).json({ error: "Tidak ada data foto", fields_received: Object.keys(body) });
      }

      // Strip "data:image/jpeg;base64," prefix jika ada
      let base64Data = rawData;
      if (rawData.startsWith("data:")) base64Data = rawData.split(",")[1] || "";
      if (!base64Data) return res.status(400).json({ error: "base64 kosong setelah strip prefix" });

      // ── Cloudflare R2 via S3-compatible API (AWS Sig V4) ──
      const accessKeyId     = process.env.R2_ACCESS_KEY;
      const secretAccessKey = process.env.R2_SECRET_KEY;
      const accountId       = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
      const bucket          = process.env.R2_BUCKET_NAME || "aclean-files";
      const publicUrl       = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

      if (!accessKeyId || !secretAccessKey || !accountId) {
        console.error("[upload-foto] Missing R2 env vars:", {
          has_access_key: !!accessKeyId,
          has_secret_key: !!secretAccessKey,
          has_account_id: !!accountId,
        });
        return res.status(500).json({
          error: "R2 credentials belum lengkap di Vercel. Butuh: R2_ACCESS_KEY, R2_SECRET_KEY, R2_ACCOUNT_ID",
          env_check: { has_access_key: !!accessKeyId, has_secret_key: !!secretAccessKey, has_account_id: !!accountId }
        });
      }

      const ts   = Date.now();
      const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      // Jika hash dikirim dari client, gunakan sebagai nama file → idempotent
      // Upload foto yang sama = overwrite file yang sama di R2, tidak bikin duplikat
      const clientHash = body.hash || "";
      const key = clientHash
        ? folder + "/" + clientHash + ".jpg"          // deterministic key dari hash
        : folder + "/" + ts + "_" + safe;             // fallback: timestamp_filename
      const host = accountId + ".r2.cloudflarestorage.com";
      const endpoint = "https://" + host + "/" + bucket + "/" + key;

      try {
        const imgBuffer = Buffer.from(base64Data, "base64");
        console.log("[upload-foto] Uploading to R2 S3:", key, imgBuffer.length, "bytes");

        // AWS Signature V4 signing (manual, no SDK needed)
        const crypto = await import("crypto");
        const now    = new Date();
        const dateStr  = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);   // YYYYMMDD
        const timeStr  = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15);  // YYYYMMDDTHHmmss + Z
        const amzDate  = timeStr + "Z";
        const region   = "auto";
        const service  = "s3";

        // Hash of payload
        const payloadHash = crypto.createHash("sha256").update(imgBuffer).digest("hex");

        // Canonical request
        const canonicalHeaders = "content-type:" + mimeType + "\n" +
          "host:" + host + "\n" +
          "x-amz-content-sha256:" + payloadHash + "\n" +
          "x-amz-date:" + amzDate + "\n";
        const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
        const canonicalUri  = "/" + bucket + "/" + encodeURIComponent(key).replace(/%2F/g, "/");
        const canonicalReq  = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

        // String to sign
        const credScope   = dateStr + "/" + region + "/" + service + "/aws4_request";
        const reqHash     = crypto.createHash("sha256").update(canonicalReq).digest("hex");
        const strToSign   = ["AWS4-HMAC-SHA256", amzDate, credScope, reqHash].join("\n");

        // Signing key
        const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
        const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, dateStr), region), service), "aws4_request");
        const signature  = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");

        // Authorization header
        const authorization = "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + credScope +
          ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;

        const r2res = await fetch(endpoint, {
          method: "PUT",
          headers: {
            "Authorization":        authorization,
            "Content-Type":         mimeType,
            "x-amz-date":           amzDate,
            "x-amz-content-sha256": payloadHash,
            "Content-Length":       String(imgBuffer.length),
          },
          body: imgBuffer,
        });

        if (!r2res.ok) {
          const errBody = await r2res.text();
          console.error("[upload-foto] R2 PUT failed:", r2res.status, errBody);
          return res.status(502).json({
            success: false,
            error: "R2 upload gagal (" + r2res.status + "): " + errBody.slice(0, 300),
          });
        }

        // Build public URL
        const finalUrl = publicUrl
          ? publicUrl + "/" + key
          : "https://" + host + "/" + bucket + "/" + key;

        console.log("[upload-foto] Success:", finalUrl);
        return res.status(200).json({
          success: true,
          url:     finalUrl,
          key:     key,
          bucket:  bucket,
          size:    imgBuffer.length,
        });

      } catch (err) {
        console.error("[upload-foto] Exception:", err.message, err.stack);
        return res.status(500).json({ success: false, error: "Server error: " + err.message });
      }
}

        // ── FOTO PROXY: serve R2 images via server (bypass CORS & auth) ──
export async function foto(req, res) {
      const key = req.query?.key || (req.body?.key) || "";
      if (!key) return res.status(400).json({ error: "key wajib" });

      // ── Quick Win 2: Whitelist regex untuk cegah path traversal ──
      // Hanya boleh akses prefix folder yang memang dipakai app + extension whitelist.
      // Tolak: "../...", path absolut, file backup, file env, dll.
      // Prefix yang diizinkan: foto/, tool-bag/, laporan/, invoice/, wa-group/, wa-snapshots/, wa-images/
      // Extension: jpg/jpeg/png/gif/webp/pdf/json
      const SAFE_KEY_RE = /^(foto|tool-bag|material-checkout|laporan|invoice|invoices|wa-group|wa-snapshots|wa-images|service-reports|orders|materials|payments|projects|maintenance|quotations|customer-photos|expense-photos|expenses|merged-pdfs)\/[a-zA-Z0-9_\-./]{1,200}\.(jpg|jpeg|png|gif|webp|pdf|json)$/i;
      // Cek path traversal sekaligus (defense in depth)
      if (!SAFE_KEY_RE.test(key) || key.includes("..") || key.includes("//") || key.startsWith("/")) {
        return res.status(400).json({ error: "key tidak valid" });
      }

      const accessKeyId     = process.env.R2_ACCESS_KEY;
      const secretAccessKey = process.env.R2_SECRET_KEY;
      const accountId       = process.env.R2_ACCOUNT_ID;
      const bucket          = process.env.R2_BUCKET_NAME || "aclean-files";

      // Selalu serve via AWS Sig V4 (tidak redirect ke public URL)
      // karena R2 public access mungkin belum diaktifkan
      if (!accessKeyId || !secretAccessKey || !accountId) {
        return res.status(503).json({ error: "R2 credentials tidak tersedia" });
      }

      const crypto  = await import("crypto");
      const host    = accountId + ".r2.cloudflarestorage.com";
      const now     = new Date();
      const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
      const region  = "auto";
      const service = "s3";
      const payloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // empty body

      const canonicalUri  = "/" + bucket + "/" + key;
      const canonicalHeaders = "host:" + host + "\n" +
        "x-amz-content-sha256:" + payloadHash + "\n" +
        "x-amz-date:" + amzDate + "\n";
      const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
      const canonicalReq  = ["GET", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

      const credScope = dateStr + "/" + region + "/" + service + "/aws4_request";
      const reqHash   = crypto.createHash("sha256").update(canonicalReq).digest("hex");
      const strToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, reqHash].join("\n");

      const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
      const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, dateStr), region), service), "aws4_request");
      const signature  = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");
      const authorization = "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + credScope +
        ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;

      try {
        const r2res = await fetch("https://" + host + canonicalUri, {
          headers: {
            "Authorization": authorization,
            "x-amz-date": amzDate,
            "x-amz-content-sha256": payloadHash,
          },
        });
        if (!r2res.ok) return res.status(r2res.status).json({ error: "Foto tidak ditemukan" });
        const ct = r2res.headers.get("content-type") || "image/jpeg";
        res.setHeader("Content-Type", ct);
        if (ct.includes("text/html") || ct.includes("application/pdf")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Content-Disposition", "inline");
        } else {
          res.setHeader("Cache-Control", "public, max-age=86400");
        }
        const buf = await r2res.arrayBuffer();
        const bufNode = Buffer.from(buf);
        res.setHeader("Content-Length", bufNode.length);
        return res.status(200).send(bufNode);
      } catch (err) {
        return res.status(500).json({ error: "Gagal fetch foto: " + err.message });
      }
}

    // ── SYNC-FOTOS: Auto-populate foto_urls from R2 files ──
export async function syncFotos(req, res) {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

      const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SK = process.env.SUPABASE_SERVICE_KEY;
      if (!SU || !SK) return res.status(500).json({ error: "Supabase tidak configured" });

      const accessKeyId = process.env.R2_ACCESS_KEY;
      const secretAccessKey = process.env.R2_SECRET_KEY;
      const accountId = process.env.R2_ACCOUNT_ID;
      const bucket = process.env.R2_BUCKET_NAME || "aclean-files";
      if (!accessKeyId || !secretAccessKey || !accountId) {
        return res.status(500).json({ error: "R2 credentials tidak lengkap" });
      }

      try {
        // Step 1: Fetch laporan yang foto_urls kosong/null
        const lapRes = await fetch(SU + "/rest/v1/service_reports?select=id,job_id,foto_urls&foto_urls=is.null,eq.{}", {
          headers: { apikey: SK, Authorization: "Bearer " + SK }
        });
        const laporan = lapRes.ok ? await lapRes.json() : [];
        console.log(`[sync-fotos] Found ${laporan.length} laporan with empty foto_urls`);

        const crypto = await import("crypto");
        const synced = [];
        const errors = [];

        // Step 2: Untuk setiap laporan, list files di R2
        for (const lap of laporan) {
          try {
            const host = accountId + ".r2.cloudflarestorage.com";
            const now = new Date();
            const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
            const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
            const region = "auto";
            const service = "s3";
            const prefix = `laporan/${lap.job_id}/`;
            const payloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
            const canonicalUri = "/" + bucket + "/";
            const queryString = "list-type=2&prefix=" + encodeURIComponent(prefix);

            const canonicalHeaders = "host:" + host + "\n" + "x-amz-content-sha256:" + payloadHash + "\n" + "x-amz-date:" + amzDate + "\n";
            const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
            const canonicalReq = ["GET", canonicalUri, queryString, canonicalHeaders, signedHeaders, payloadHash].join("\n");

            const credScope = dateStr + "/" + region + "/" + service + "/aws4_request";
            const reqHash = crypto.createHash("sha256").update(canonicalReq).digest("hex");
            const strToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, reqHash].join("\n");

            const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
            const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, dateStr), region), service), "aws4_request");
            const signature = crypto.createHmac("sha256", signingKey).update(strToSign).digest("hex");
            const authorization = "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + credScope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;

            // Query R2 list objects
            const r2Url = "https://" + host + "/" + bucket + "/?prefix=" + encodeURIComponent(prefix) + "&list-type=2";
            const r2res = await fetch(r2Url, {
              headers: { "Authorization": authorization, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash }
            });

            if (!r2res.ok) {
              errors.push({ job_id: lap.job_id, error: "R2 list failed: " + r2res.status });
              continue;
            }

            const xmlBody = await r2res.text();
            // Simple XML parsing: extract <Key> tags
            const keyRegex = /<Key>([^<]+)<\/Key>/g;
            const matches = [...xmlBody.matchAll(keyRegex)];
            const files = matches
              .map(m => m[1])
              .filter(k => k !== prefix) // Exclude folder itself
              .map(k => k.replace(prefix, "")); // Remove prefix, keep only filename

            console.log(`[sync-fotos] ${lap.job_id}: found ${files.length} files`);

            // Build foto_urls array with full paths
            const fotoUrls = files.map(f => prefix + f);

            // Update database
            const upRes = await fetch(SU + "/rest/v1/service_reports?id=eq." + lap.id, {
              method: "PATCH",
              headers: { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" },
              body: JSON.stringify({ foto_urls: fotoUrls })
            });

            if (upRes.ok) {
              synced.push({ job_id: lap.job_id, fotos: files.length });
            } else {
              const err = await upRes.text();
              errors.push({ job_id: lap.job_id, error: "Update failed: " + err.slice(0, 100) });
            }
          } catch (e) {
            errors.push({ job_id: lap.job_id, error: e.message });
          }
        }

        return res.status(200).json({
          ok: true,
          synced: synced.length,
          errors: errors.length,
          details: { synced, errors }
        });
      } catch (err) {
        console.error("[sync-fotos] Exception:", err.message);
        return res.status(500).json({ error: "Sync failed: " + err.message });
      }
}

