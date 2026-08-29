// scripts/ai-caption-baseline.mjs
//
// Pengukuran caption + biaya AI vision, untuk membandingkan SEBELUM vs SESUDAH
// perubahan 29 Agu 2026 (prompt kondisional + toggle material OFF).
//
// Pakai:
//   node --env-file=.env.local scripts/ai-caption-baseline.mjs            # 30 hari
//   node --env-file=.env.local scripts/ai-caption-baseline.mjs --sejak 2026-08-29T14:30
//
// Yang dijawab:
//   1. Apakah biaya/panggilan turun setelah toggle + prompt kondisional?
//   2. Apakah grup "Report Pekerjaan" benar-benar berhenti memanggil AI?
//   3. Apakah rata-rata token input turun (bukti prompt mengecil)?
//   4. Apakah foto TANPA caption layak dilewati (pre-filter)? — butuh data
//      has_caption yang baru mulai terekam 29 Agu 2026.

const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
if (!SU || !SK) { console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY belum diset"); process.exit(1); }

const argSejak = process.argv.includes("--sejak")
  ? process.argv[process.argv.indexOf("--sejak") + 1]
  : null;
const sejak = argSejak
  ? new Date(argSejak).toISOString()
  : new Date(Date.now() - 30 * 864e5).toISOString();

const GRUP = {
  "6281289898937-1460340453@g.us": "AClean Grup",
  "120363146298673145@g.us":       "Report Pekerjaan",
  "120363042193082752@g.us":       "FINANCE AClean",
};

// PostgREST cap 1000 baris/response — wajib paginate (lihat Anti-Pattern Checklist).
async function ambilSemua(path) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SU}/rest/v1/${path}`, {
      headers: { apikey: SK, Authorization: "Bearer " + SK, Range: `${from}-${from + 999}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const usd = (n) => "$" + n.toFixed(4);
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "—");

const usage = await ambilSemua(
  `ai_usage?select=feature,model,input_tokens,output_tokens,cost_usd,metadata,created_at` +
  `&created_at=gte.${sejak}&order=created_at.asc`
);

console.log(`\n=== PENGUKURAN AI  (sejak ${sejak.slice(0, 16).replace("T", " ")} UTC) ===`);
console.log(`Total tercatat: ${usage.length} panggilan · ` +
  usd(usage.reduce((s, r) => s + Number(r.cost_usd || 0), 0)) + "\n");

// ── 1. Per feature — feature baru menandakan biaya yang dulu "gelap" ──
const perFeature = {};
for (const r of usage) {
  const f = perFeature[r.feature] ||= { n: 0, cost: 0, tin: 0 };
  f.n++; f.cost += Number(r.cost_usd || 0); f.tin += Number(r.input_tokens || 0);
}
console.log("── Per feature ──");
console.log("feature".padEnd(22) + "call".padStart(6) + "biaya".padStart(11) + "avg tok in".padStart(12));
for (const [f, v] of Object.entries(perFeature).sort((a, b) => b[1].cost - a[1].cost)) {
  console.log(f.padEnd(22) + String(v.n).padStart(6) + usd(v.cost).padStart(11) +
    String(Math.round(v.tin / v.n)).padStart(12));
}

// ── 2. wa-group-vision per grup — Report Pekerjaan harus 0 ──
const vis = usage.filter((r) => r.feature === "wa-group-vision");
console.log("\n── wa-group-vision per grup ──");
if (!vis.length) console.log("(belum ada panggilan vision pada rentang ini)");
else {
  const perGrup = {};
  for (const r of vis) {
    const g = r.metadata?.group_id || "(app/expense-submit)";
    const v = perGrup[g] ||= { n: 0, cost: 0, tin: 0, intents: {} };
    v.n++; v.cost += Number(r.cost_usd || 0); v.tin += Number(r.input_tokens || 0);
    const it = r.metadata?.intent || r.metadata?.status || "?";
    v.intents[it] = (v.intents[it] || 0) + 1;
  }
  console.log("grup".padEnd(20) + "call".padStart(6) + "biaya".padStart(11) +
    "avg tok in".padStart(12) + "  intent");
  for (const [g, v] of Object.entries(perGrup).sort((a, b) => b[1].cost - a[1].cost)) {
    const top = Object.entries(v.intents).sort((a, b) => b[1] - a[1])
      .map(([k, c]) => `${k}:${c}`).join(" ");
    console.log((GRUP[g] || g.slice(0, 18)).padEnd(20) + String(v.n).padStart(6) +
      usd(v.cost).padStart(11) + String(Math.round(v.tin / v.n)).padStart(12) + "  " + top);
  }
}

// ── 3. Caption vs hasil — hanya baris yang punya has_caption (mulai 29 Agu 2026) ──
const berCaption = vis.filter((r) => r.metadata && "has_caption" in r.metadata);
console.log(`\n── Caption vs intent  (${berCaption.length} baris punya data caption) ──`);
if (!berCaption.length) {
  console.log("Belum ada. Metadata has_caption baru terekam setelah deploy 29 Agu 2026 —");
  console.log("jalankan lagi besok/Kamis setelah trafik WA masuk.");
} else {
  const bucket = (r) => {
    const L = r.metadata.caption_len || 0;
    return !r.metadata.has_caption ? "TANPA caption"
      : L < 15 ? "caption pendek (<15)" : "caption panjang (>=15)";
  };
  const per = {};
  for (const r of berCaption) {
    const b = per[bucket(r)] ||= { n: 0, cost: 0, unknown: 0, berguna: 0 };
    b.n++; b.cost += Number(r.cost_usd || 0);
    const it = r.metadata.intent;
    if (it === "unknown") b.unknown++;
    if (it === "expense" || it === "payment") b.berguna++;
  }
  console.log("kelompok".padEnd(24) + "call".padStart(6) + "biaya".padStart(11) +
    "unknown".padStart(10) + "exp+pay".padStart(10));
  for (const [k, v] of Object.entries(per).sort((a, b) => b[1].n - a[1].n)) {
    console.log(k.padEnd(24) + String(v.n).padStart(6) + usd(v.cost).padStart(11) +
      `${v.unknown} (${pct(v.unknown, v.n)})`.padStart(10) +
      `${v.berguna} (${pct(v.berguna, v.n)})`.padStart(10));
  }
  const tanpa = per["TANPA caption"];
  if (tanpa) {
    console.log(`\nPutusan pre-filter "lewati foto tanpa caption":`);
    console.log(`  hemat  ${usd(tanpa.cost)}  ·  KORBAN ${tanpa.berguna} expense/payment`);
    console.log(tanpa.berguna === 0
      ? "  → AMAN diterapkan (tidak ada hasil berguna yang hilang)."
      : "  → JANGAN diterapkan mentah-mentah: ada hasil berguna yang akan hilang.");
  }
}
console.log();
