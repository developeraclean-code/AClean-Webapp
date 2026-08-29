// Replay AI vision untuk foto yang terlewat saat kunci Anthropic kena spend-limit.
//
// LATAR (insiden 28-29 Agu 2026): plafon spend bulanan Anthropic tercapai → setiap panggilan
// vision dijawab HTTP 400 "You have reached your specified API usage limits". Webhook tetap
// menerima foto, tapi `[AI_VISION] skip:` lalu lanjut tanpa jejak: 0 baris ai_extractions
// selama ~21 jam, 117 foto tak terbaca.
//
// KENAPA TIDAK REPLAY LEWAT WEBHOOK:
//   1. URL Fonnte cuma hidup ±15 menit — 107 dari 117 sudah 404 saat diperiksa.
//   2. Webhook mengirim balasan WA ke pengirim/grup & forward bukti TF. Replay = 100+ pesan
//      nyasar ke customer & grup kerja.
//   3. Guard `wa_webhook_dedup` (kunci grpImg_/grpAi_) sudah terisi dari percobaan pertama,
//      jadi replay lewat webhook akan di-skip sebagai duplikat.
// Karena itu script ini mengambil gambar dari CERMIN R2 (wa_group_logs.r2_image_url) dan
// memanggil classifyImage() + persistClassification() langsung — fungsi yang sama dipakai
// webhook, jadi tidak ada logika yang diduplikasi — tanpa satu pun panggilan Fonnte.
//
// Catatan cakupan: hanya foto GRUP yang bisa dipulihkan. Foto chat pribadi (jalur bukti bayar)
// baru disalin ke R2 SETELAH AI memastikan itu bukti transfer (wa.js:1963) — karena AI gagal,
// tidak ada cermin, dan sumber Fonnte-nya sudah hangus. Foto pribadi harus ditangani manual.
//
// Pakai:
//   node --env-file=.env.local scripts/replay-ai-vision.mjs --dry-run --limit 3
//   node --env-file=.env.local scripts/replay-ai-vision.mjs --since 2026-08-28T08:59:29Z
import { classifyImage, persistClassification } from "../api/_ai-vision.js";

const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.REPLAY_BASE_URL || "https://a-clean-webapp.vercel.app";
const H = { apikey: SK, Authorization: "Bearer " + SK };

const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1]?.startsWith("--") ? true : process.argv[i + 1]) : d;
};
const DRY = process.argv.includes("--dry-run");
const SINCE = arg("--since", "2026-08-28T08:59:29Z");
const LIMIT = Number(arg("--limit", 0)) || 0;

if (!SU || !SK) { console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY belum ada di env"); process.exit(1); }
if (!(process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY)) { console.error("ANTHROPIC_API_KEY belum ada"); process.exit(1); }

const wib = (t) => new Date(t).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

// PostgREST cap 1000 baris/response — paginate, jangan andalkan limit besar.
async function fetchAll(path) {
  let out = [], from = 0;
  for (;;) {
    const r = await fetch(`${SU}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    const b = await r.json();
    if (!Array.isArray(b) || b.length === 0) break;
    out = out.concat(b);
    if (b.length < 1000) break;
    from += 1000;
  }
  return out;
}

const groups = await fetchAll("wa_monitored_groups?select=*");
const cfgById = Object.fromEntries(groups.map(g => [g.group_id, g]));

const logs = await fetchAll(
  `wa_group_logs?select=id,created_at,group_id,group_name,sender_phone,sender_name,content,image_url,r2_image_url` +
  `&created_at=gt.${SINCE}&r2_image_url=not.is.null&r2_purged_at=is.null&order=created_at.asc`);

// Idempotensi: lewati yang sudah punya baris ai_extractions (script boleh dijalankan ulang).
const sudah = new Set((await fetchAll(
  `ai_extractions?select=r2_url&created_at=gt.${SINCE}&r2_url=not.is.null`)).map(x => x.r2_url));

const dilewati = logs.filter(l => sudah.has(l.r2_image_url)).length;
let antre = logs.filter(l => !sudah.has(l.r2_image_url));
if (LIMIT) antre = antre.slice(0, LIMIT);

console.log(`Foto grup ber-cermin R2 sejak ${wib(SINCE)} : ${logs.length}`);
console.log(`Sudah punya ai_extractions (dilewati)      : ${dilewati}`);
console.log(`Akan diproses                              : ${antre.length}${DRY ? "  (DRY-RUN, tidak menulis apa pun)" : ""}\n`);

const hasil = { ok: 0, gagal_ambil: 0, gagal_ai: 0, unknown: 0, per_intent: {} };

for (const [i, row] of antre.entries()) {
  const cfg = cfgById[row.group_id];
  const label = `[${i + 1}/${antre.length}] ${wib(row.created_at)} ${row.group_name || row.group_id} · ${row.sender_name || row.sender_phone}`;
  if (!cfg) { console.log(`${label} → SKIP (grup tidak terdaftar)`); continue; }
  if (!(cfg.ai_expense_enabled || cfg.ai_material_enabled || cfg.ai_payment_enabled)) {
    console.log(`${label} → SKIP (semua toggle AI grup ini OFF)`); continue;
  }

  // Ambil dari cermin R2 lewat proxy /api/foto (bucket R2 non-publik — wajib lewat proxy).
  const url = row.r2_image_url.startsWith("http") ? row.r2_image_url : BASE + row.r2_image_url;
  let b64, mime = "image/jpeg";
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    mime = r.headers.get("content-type")?.split(";")[0] || mime;
    b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
  } catch (e) {
    hasil.gagal_ambil++; console.log(`${label} → GAGAL ambil gambar: ${e.message}`); continue;
  }

  const messageText = row.content && row.content !== "(foto)" ? row.content : null;
  const sender = { phone: row.sender_phone, name: row.sender_name || row.sender_phone };

  const cls = await classifyImage({ imageBase64: b64, mimeType: mime, groupCfg: cfg, sender, messageText });
  if (cls?.error) { hasil.gagal_ai++; console.log(`${label} → AI ERROR: ${cls.error} ${(cls.detail || "").slice(0, 120)}`); continue; }
  if (!cls || cls.intent === "unknown") { hasil.unknown++; console.log(`${label} → unknown (bukan biaya/material/bayar)`); continue; }

  hasil.per_intent[cls.intent] = (hasil.per_intent[cls.intent] || 0) + 1;
  if (DRY) { console.log(`${label} → ${cls.intent} (${cls.confidence}) [dry-run]`); hasil.ok++; continue; }

  const p = await persistClassification({
    SU, SK, classification: cls, sender, groupCfg: cfg,
    imageUrl: row.image_url, r2Url: row.r2_image_url, messageText,
  });
  if (p?.error) { hasil.gagal_ai++; console.log(`${label} → ${cls.intent} tapi GAGAL simpan: ${p.error}`); continue; }
  hasil.ok++;
  console.log(`${label} → ${cls.intent} (${cls.confidence}) tersimpan`);
}

console.log("\n── Ringkasan ──");
console.log("berhasil        :", hasil.ok, JSON.stringify(hasil.per_intent));
console.log("gagal ambil foto:", hasil.gagal_ambil);
console.log("gagal AI/simpan :", hasil.gagal_ai);
console.log("unknown         :", hasil.unknown);
if (!DRY && hasil.ok) console.log("\nCek hasilnya di Stok Material → Pending AI, dan Biaya → Pending AI.");
