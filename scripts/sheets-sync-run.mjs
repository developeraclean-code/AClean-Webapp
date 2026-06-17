// Prototipe sync Google Sheets → orders (Planning Order / Order Masuk).
// Pakai: node --env-file=.env.local scripts/sheets-sync-run.mjs [--dry-run]
//
// Setup sekali di awal (lihat docs/SHEETS_SYNC_SETUP.md untuk langkah lengkap):
//   1. Buat Service Account di Google Cloud Console, enable Google Sheets API.
//   2. Share target Sheet ke email service account (cukup Viewer).
//   3. Isi GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GOOGLE_SHEET_ID di .env.local.
//
// Format Sheet (sheet bernama "Jadwal", baris 1 = header, data mulai baris 2):
//   A: Tanggal (YYYY-MM-DD atau DD/MM/YYYY)   F: Telepon
//   B: Jam (HH:mm)                            G: Alamat
//   C: Teknisi                                H: Jenis Servis (Cleaning/Install/Repair/Complain/Survey/Project)
//   D: Helper (boleh kosong)                  I: Detail Pekerjaan
//   E: Customer                                J: Catatan (boleh kosong)
//
// Setiap baris yang sudah diimport dicatat di tabel sheet_schedule_imports (hash
// per-baris) — aman di-run berkali-kali, baris yang sama tidak akan dobel-insert.
// Order dibuat dengan status PENDING + source="sheet_import" → muncul di Order
// Masuk / Planning Order untuk direview & dikonfirmasi seperti order manual biasa.

import { createClient } from "@supabase/supabase-js";
import { createSign, createHash } from "node:crypto";
import { normalizePhone } from "../src/lib/phone.js";
import { SERVICE_TYPES } from "../src/constants/services.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SA_EMAIL = process.env.GOOGLE_SA_EMAIL;
const SA_PRIVATE_KEY = (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_RANGE = process.env.GOOGLE_SHEET_RANGE || "Jadwal!A2:J1000";
const DRY_RUN = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SERVICE_KEY) { console.error("❌ Supabase creds tidak lengkap (SUPABASE_URL / SUPABASE_SERVICE_KEY)"); process.exit(1); }
if (!SA_EMAIL || !SA_PRIVATE_KEY || !SHEET_ID) { console.error("❌ Google Sheets creds tidak lengkap (GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY / GOOGLE_SHEET_ID)"); process.exit(1); }

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildServiceAccountJWT(email, privateKeyPem, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: email, scope, aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };
  const unsigned = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claim));
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return unsigned + "." + base64url(signature);
}

async function getAccessToken() {
  const jwt = buildServiceAccountJWT(SA_EMAIL, SA_PRIVATE_KEY, "https://www.googleapis.com/auth/spreadsheets.readonly");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error("Gagal ambil access token: " + JSON.stringify(json));
  return json.access_token;
}

async function fetchSheetRows(accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json();
  if (!res.ok) throw new Error("Gagal baca Sheet: " + JSON.stringify(json));
  return json.values || [];
}

function rowHash(row) {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}

function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function parseTime(raw) {
  if (!raw) return "09:00";
  const s = raw.trim();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return "09:00";
  return `${m[1].padStart(2, "0")}:${(m[2] || "00").padStart(2, "0")}`;
}

function parseService(raw) {
  const s = (raw || "").trim();
  const found = SERVICE_TYPES.find((t) => t.toLowerCase() === s.toLowerCase());
  return found || "Repair";
}

function newOrderId() {
  return "JOB-" + Date.now().toString(36).toUpperCase().slice(-6) + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function parseRow(cols) {
  const [tanggal, jam, teknisi, helper, customer, telepon, alamat, jenisServis, detail, catatan] = cols;
  const date = parseDate(tanggal);
  if (!date || !customer || !teknisi) return { ok: false, reason: "Tanggal/Customer/Teknisi wajib diisi" };
  return {
    ok: true,
    payload: {
      id: newOrderId(),
      customer: customer.trim(),
      customer_id: null,
      phone: telepon ? normalizePhone(telepon) : null,
      address: alamat ? alamat.trim() : null,
      service: parseService(jenisServis),
      type: detail ? detail.trim() : null,
      units: 1,
      teknisi: teknisi.trim(),
      helper: helper ? helper.trim() : null,
      date,
      time: parseTime(jam),
      status: "PENDING",
      notes: catatan ? catatan.trim() : null,
      dispatch: false,
      source: "sheet_import",
    },
  };
}

async function main() {
  console.log(DRY_RUN ? "🔍 DRY RUN — tidak ada data yang disimpan\n" : "🚀 LIVE RUN — order akan dibuat di database\n");

  const accessToken = await getAccessToken();
  const rows = await fetchSheetRows(accessToken);
  console.log(`📄 ${rows.length} baris ditemukan di Sheet (range ${SHEET_RANGE})\n`);

  let imported = 0, skipped = 0, errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i];
    if (!cols || cols.every((c) => !c)) continue; // baris kosong

    const hash = rowHash(cols);
    const { data: existing } = await sb
      .from("sheet_schedule_imports")
      .select("id")
      .eq("sheet_id", SHEET_ID)
      .eq("row_hash", hash)
      .maybeSingle();

    if (existing) {
      console.log(`⏭️  Baris ${i + 2}: sudah pernah diimport, skip`);
      skipped++;
      continue;
    }

    const parsed = parseRow(cols);
    if (!parsed.ok) {
      console.log(`⚠️  Baris ${i + 2}: ${parsed.reason} — dilewati`);
      if (!DRY_RUN) {
        await sb.from("sheet_schedule_imports").insert({ sheet_id: SHEET_ID, row_hash: hash, raw_row: cols, status: "error", error_message: parsed.reason });
      }
      errors++;
      continue;
    }

    console.log(`✅ Baris ${i + 2}: ${parsed.payload.customer} / ${parsed.payload.date} ${parsed.payload.time} / ${parsed.payload.teknisi}${parsed.payload.helper ? " + " + parsed.payload.helper : ""}`);

    if (!DRY_RUN) {
      const { error } = await sb.from("orders").insert(parsed.payload);
      if (error) {
        console.log(`   ❌ Gagal insert order: ${error.message}`);
        await sb.from("sheet_schedule_imports").insert({ sheet_id: SHEET_ID, row_hash: hash, raw_row: cols, status: "error", error_message: error.message });
        errors++;
        continue;
      }
      await sb.from("sheet_schedule_imports").insert({ sheet_id: SHEET_ID, row_hash: hash, raw_row: cols, order_id: parsed.payload.id, status: "imported" });
    }
    imported++;
  }

  console.log(`\n📊 Selesai — imported: ${imported}, skipped (sudah ada): ${skipped}, error: ${errors}`);
  if (DRY_RUN) console.log("ℹ️  Ini dry-run, jalankan ulang tanpa --dry-run untuk benar-benar membuat order.");
}

main().catch((e) => { console.error("❌ Fatal:", e.message); process.exit(1); });
