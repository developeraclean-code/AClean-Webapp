// DRILL RESTORE BACKUP — buktikan backup R2 benar-benar bisa di-restore.
// Pakai: node --env-file=.env.local scripts/restore-verify-run.mjs [YYYY-MM-DD]
//
// Alur: download backup/{tanggal}/<table>.json dari R2 → validasi JSON & count →
// INSERT semua baris ke tabel scratch public.restore_test_<table> (dibuat terpisah,
// LIKE tabel asli INCLUDING ALL, RLS deny-all) → laporkan count masuk vs count backup.
// Tabel scratch di-drop manual setelah verifikasi (lihat catatan di akhir output).
// Tanpa argumen: pakai folder backup Senin terakhir.
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
function sigV4Get(key) {
  const host = r2Account + ".r2.cloudflarestorage.com";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStr = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update("").digest("hex"); // GET = body kosong
  const canonicalUri = "/" + r2Bucket + "/" + key;
  const canonicalHeaders = "host:" + host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + amzDate + "\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = "GET\n" + canonicalUri + "\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash;
  const credScope = dateStr + "/auto/s3/aws4_request";
  const strToSign = "AWS4-HMAC-SHA256\n" + amzDate + "\n" + credScope + "\n" + createHash("sha256").update(canonicalRequest).digest("hex");
  const signingKey = hmac(hmac(hmac(hmac("AWS4" + r2Secret, dateStr), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(strToSign).digest("hex");
  const authorization = "AWS4-HMAC-SHA256 Credential=" + r2Key + "/" + credScope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
  return { url: "https://" + host + canonicalUri, headers: { Authorization: authorization, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, host } };
}

// Default: Senin terakhir WIB (jadwal backup dow:1)
function lastMondayWIB() {
  const d = new Date(Date.now() + 7 * 3600000);
  const dow = d.getUTCDay();
  const back = dow >= 1 ? dow - 1 : 6;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

const dateStr = process.argv[2] || lastMondayWIB();
const tables = ["invoices", "orders", "customers", "service_reports"];
console.log(`\n🧪 DRILL RESTORE — backup/${dateStr}/ → restore_test_*\n`);

let allOk = true;
for (const table of tables) {
  const r2Path = `backup/${dateStr}/${table}.json`;
  const scratch = `restore_test_${table}`;
  try {
    // 1. Download
    const { url, headers } = sigV4Get(r2Path);
    const res = await fetch(url, { headers });
    if (!res.ok) { console.log(`  ❌ ${table}: GET ${res.status} — ${r2Path} tidak ada?`); allOk = false; continue; }
    const payload = JSON.parse(await res.text());
    const rows = payload.data || [];
    if (!Array.isArray(rows)) { console.log(`  ❌ ${table}: format tidak dikenal`); allOk = false; continue; }
    if (payload.count !== rows.length) {
      console.log(`  ⚠️ ${table}: metadata count=${payload.count} ≠ isi=${rows.length}`);
      allOk = false;
    }

    // 2. Kosongkan scratch (idempotent re-run)
    const del = await sb.from(scratch).delete().neq("id", "___never___");
    if (del.error && !/0 rows/.test(del.error.message || "")) {
      // delete semua via neq dummy; kalau id uuid, filter neq tetap valid utk semua baris
    }

    // 3. Insert per batch 500
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await sb.from(scratch).insert(batch);
      if (error) { console.log(`  ❌ ${table}: insert batch ${i}-${i + batch.length} gagal: ${error.message}`); allOk = false; break; }
      inserted += batch.length;
    }

    // 4. Hitung ulang dari DB (bukti baris benar-benar masuk)
    const { count, error: cntErr } = await sb.from(scratch).select("*", { count: "exact", head: true });
    const dbCount = cntErr ? -1 : count;
    const ok = dbCount === rows.length;
    if (!ok) allOk = false;
    console.log(`  ${ok ? "✅" : "❌"} ${table}: backup=${rows.length} → masuk DB=${dbCount} (exported_at=${payload.exported_at || "?"})`);
  } catch (e) {
    console.log(`  ❌ ${table}: EXCEPTION ${e.message}`); allOk = false;
  }
}

console.log(`\n${allOk ? "✅ DRILL RESTORE LOLOS — backup terbukti bisa di-restore utuh." : "❌ DRILL RESTORE GAGAL — cek pesan di atas."}`);
console.log("ℹ️  Tabel scratch restore_test_* bisa di-drop setelah verifikasi:\n    DROP TABLE restore_test_invoices, restore_test_orders, restore_test_customers, restore_test_service_reports;");
process.exit(allOk ? 0 : 1);
