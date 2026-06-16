// Simulasi + eksekusi nyata taskBackupData (api/cron-reminder.js) ke R2.
// Pakai: node --env-file=.env.local scripts/backup-r2-run.mjs
// Backup 4 tabel inti → R2 backup/YYYY-MM/<table>.json (timpa file lama = backup terbaru).
import { createClient } from "@supabase/supabase-js";
import { createHmac, createHash } from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const r2Key = process.env.R2_ACCESS_KEY;
const r2Secret = process.env.R2_SECRET_KEY;
const r2Account = process.env.R2_ACCOUNT_ID;
const r2Bucket = process.env.R2_BUCKET_NAME || "aclean-files";

if (!SUPABASE_URL || !SERVICE_KEY) { console.error("❌ Supabase creds tidak lengkap"); process.exit(1); }
if (!r2Key || !r2Secret || !r2Account) { console.error("❌ R2 creds tidak lengkap"); process.exit(1); }

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function hmac(key, data) { return createHmac("sha256", key).update(data).digest(); }
function sigV4Put(key, body, contentType) {
  const host = r2Account + ".r2.cloudflarestorage.com";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStr = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const canonicalUri = "/" + r2Bucket + "/" + key;
  const canonicalHeaders = "content-type:" + contentType + "\nhost:" + host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + amzDate + "\n";
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = "PUT\n" + canonicalUri + "\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash;
  const credScope = dateStr + "/auto/s3/aws4_request";
  const strToSign = "AWS4-HMAC-SHA256\n" + amzDate + "\n" + credScope + "\n" + createHash("sha256").update(canonicalRequest).digest("hex");
  const signingKey = hmac(hmac(hmac(hmac("AWS4" + r2Secret, dateStr), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(strToSign).digest("hex");
  const authorization = "AWS4-HMAC-SHA256 Credential=" + r2Key + "/" + credScope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
  return { url: "https://" + host + canonicalUri, headers: { Authorization: authorization, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, "content-type": contentType, host } };
}

// PostgREST cap 1000 baris/response → paginate via .range() agar backup LENGKAP (bukan terpotong).
async function fetchAll(table) {
  const PAGE = 1000;
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select("*").order("created_at", { ascending: false }).range(from, from + PAGE - 1);
    if (error) return { error };
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { data: all };
}

const now = new Date(Date.now() + 7 * 3600000); // WIB
const yearMonth = now.toISOString().slice(0, 7);
const tables = ["invoices", "orders", "customers", "service_reports"];
const results = {};

console.log(`\n📦 Backup → R2 bucket "${r2Bucket}" prefix backup/${yearMonth}/\n`);
for (const table of tables) {
  try {
    const { data, error } = await fetchAll(table);
    if (error) { results[table] = "ERROR: " + error.message; console.log(`  ❌ ${table}: ${results[table]}`); continue; }
    const body = JSON.stringify({ exported_at: new Date().toISOString(), table, count: data.length, data });
    const r2Path = "backup/" + yearMonth + "/" + table + ".json";
    const { url, headers } = sigV4Put(r2Path, body, "application/json");
    const putRes = await fetch(url, { method: "PUT", headers, body });
    if (putRes.ok) {
      results[table] = `${data.length} rows (${(body.length / 1024).toFixed(0)} KB)`;
      console.log(`  ✅ ${table}: ${results[table]} → ${r2Path}`);
    } else {
      const txt = await putRes.text();
      results[table] = `PUT_FAIL ${putRes.status}: ${txt.slice(0, 150)}`;
      console.log(`  ❌ ${table}: ${results[table]}`);
    }
  } catch (e) { results[table] = "EXCEPTION: " + e.message; console.log(`  ❌ ${table}: ${results[table]}`); }
}

const ok = tables.filter(t => /rows/.test(results[t] || "")).length;
console.log(`\n${ok === tables.length ? "✅ SEMUA SUKSES" : "⚠️ SEBAGIAN GAGAL"} — ${ok}/${tables.length} tabel ter-backup ke backup/${yearMonth}/\n`);
process.exit(ok === tables.length ? 0 : 1);
