// Smoke test — Expense Submit (teknisi bensin/parkir + AI verdict) terhadap DB asli.
// Memverifikasi logika BARU di api/expense-submit.js:
//   1. Verdict (tanggal match DAN nominal cocok, toleransi 5%)
//   2. Dedup hash foto (anti double-claim)
//   3. Insert ai_extractions + expenses + linkage 2-arah
//   4. Cleanup query (>30 hari) + ekstraksi key dari r2_url
// AI vision (classifyImage) sudah teruji di produksi (WA flow) — tidak di-recall di sini.
// Cleanup otomatis. Jalankan: node scripts/smoke-expense-vision.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SU = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SK = env.SUPABASE_SERVICE_KEY;
const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const REST = (p) => `${SU}/rest/v1/${p}`;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n); } };
const RUN = "SMOKEEXP_" + Date.now().toString(36).toUpperCase();
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

// ── Replikasi PERSIS verdict logic dari api/expense-submit.js ──
function computeVerdict({ aiDate, aiAmount, typedAmount, clsError }) {
  const dateMatch = aiDate && aiDate === today;
  const amountTol = Math.max(1000, Math.round(typedAmount * 0.05));
  const amountMatch = aiAmount > 0 && Math.abs(aiAmount - typedAmount) <= amountTol;
  if (clsError) return { validation: "PENDING_AI", reason: "AI gagal baca foto — perlu review manual" };
  if (dateMatch && amountMatch) return { validation: "APPROVED", reason: null };
  const probs = [];
  if (!aiDate) probs.push("tanggal struk tidak terbaca");
  else if (!dateMatch) probs.push(`tanggal struk ${aiDate} ≠ hari ini`);
  if (!aiAmount) probs.push("nominal tidak terbaca");
  else if (!amountMatch) probs.push("nominal beda");
  return { validation: "PENDING_AI", reason: probs.join(" · ") };
}

const createdExp = [], createdAi = [];

async function main() {
  console.log("\n=== SMOKE: Expense Vision Verdict (" + RUN + ") ===\n");

  // ───────── PHASE 1: Verdict logic (pure) ─────────
  console.log("1) Verdict logic — 6 skenario");
  const sc = [
    { n: "tanggal hari ini + nominal sama → APPROVED", in: { aiDate: today, aiAmount: 20000, typedAmount: 20000 }, want: "APPROVED" },
    { n: "tanggal hari ini + selisih 4% (toleransi) → APPROVED", in: { aiDate: today, aiAmount: 20800, typedAmount: 20000 }, want: "APPROVED" },
    { n: "tanggal hari ini + selisih 30% → PENDING_AI", in: { aiDate: today, aiAmount: 26000, typedAmount: 20000 }, want: "PENDING_AI" },
    { n: "tanggal kemarin + nominal sama → PENDING_AI", in: { aiDate: yesterday, aiAmount: 20000, typedAmount: 20000 }, want: "PENDING_AI" },
    { n: "tanggal null → PENDING_AI", in: { aiDate: null, aiAmount: 20000, typedAmount: 20000 }, want: "PENDING_AI" },
    { n: "AI error → PENDING_AI", in: { aiDate: today, aiAmount: 20000, typedAmount: 20000, clsError: true }, want: "PENDING_AI" },
  ];
  for (const s of sc) ok(s.n, computeVerdict(s.in).validation === s.want);
  // Toleransi tepat: 5% dari 20000 = 1000; selisih 1000 lolos, 1001 tidak
  ok("toleransi batas: selisih == 5% lolos", computeVerdict({ aiDate: today, aiAmount: 21000, typedAmount: 20000 }).validation === "APPROVED");
  ok("toleransi batas: selisih > 5% gagal", computeVerdict({ aiDate: today, aiAmount: 21001, typedAmount: 20000 }).validation === "PENDING_AI");

  // ───────── PHASE 2: Dedup hash ─────────
  console.log("\n2) Dedup hash foto");
  const fakeBuf = Buffer.from("FAKE_RECEIPT_IMAGE_" + RUN);
  const hash = createHash("sha256").update(fakeBuf).digest("hex");
  const dedupKey = "tekexp:" + hash;
  // Insert 1 ai_extraction dengan source_ref = dedupKey
  const ai1 = await fetch(REST("ai_extractions"), { method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ source: "teknisi_dashboard", source_ref: dedupKey, sender_name: RUN, intent: "expense", confidence: "HIGH", status: "approved", r2_url: "/api/foto?key=expenses/test/" + RUN + ".jpg", notes: "dedup test" }) });
  const ai1Row = ai1.ok ? (await ai1.json())[0] : null;
  if (ai1Row) createdAi.push(ai1Row.id);
  ok("insert ai_extraction sukses", !!ai1Row);
  // Query dedup window 30 hari
  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const dup = await (await fetch(REST(`ai_extractions?source_ref=eq.${encodeURIComponent(dedupKey)}&created_at=gte.${cutoff30}&select=id&limit=1`), { headers: H })).json();
  ok("dedup query menemukan foto duplikat", dup.length === 1);
  // Hash berbeda → tidak ketemu
  const otherKey = "tekexp:" + createHash("sha256").update(Buffer.from("DIFFERENT")).digest("hex");
  const noDup = await (await fetch(REST(`ai_extractions?source_ref=eq.${encodeURIComponent(otherKey)}&created_at=gte.${cutoff30}&select=id&limit=1`), { headers: H })).json();
  ok("hash berbeda tidak terdeteksi duplikat", noDup.length === 0);

  // ───────── PHASE 3: Insert flow + linkage ─────────
  console.log("\n3) Insert ai_extractions + expenses + linkage 2-arah");
  // Replikasi: insert ai_extraction → insert expense (ai_extraction_id) → patch ai linked_id
  const v = computeVerdict({ aiDate: today, aiAmount: 25000, typedAmount: 25000 });
  const aiX = await fetch(REST("ai_extractions"), { method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ source: "teknisi_dashboard", source_ref: "tekexp:" + RUN + "_link", sender_name: RUN, intent: "expense", confidence: "HIGH", extracted: { amount: 25000, date: today }, status: "approved", linked_table: "expenses", notes: v.reason }) });
  const aiXRow = (await aiX.json())[0]; createdAi.push(aiXRow.id);
  const expX = await fetch(REST("expenses"), { method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ category: "petty_cash", subcategory: "Bensin Motor", amount: 25000, date: today, description: "Bensin (input teknisi) [" + RUN + "]", teknisi_name: RUN, created_by: RUN, validation_status: v.validation, ai_extraction_id: aiXRow.id }) });
  const expXRow = (await expX.json())[0]; createdExp.push(expXRow.id);
  await fetch(REST("ai_extractions?id=eq." + aiXRow.id), { method: "PATCH", headers: H, body: JSON.stringify({ linked_id: expXRow.id }) });

  ok("expense ter-insert dgn validation APPROVED", expXRow.validation_status === "APPROVED");
  ok("expense.ai_extraction_id → ai_extraction", expXRow.ai_extraction_id === aiXRow.id);
  // verifikasi linked_id balik
  const aiCheck = await (await fetch(REST("ai_extractions?id=eq." + aiXRow.id + "&select=linked_id,linked_table"), { headers: H })).json();
  ok("ai_extraction.linked_id → expense (2-arah)", aiCheck[0]?.linked_id === expXRow.id && aiCheck[0]?.linked_table === "expenses");

  // PENDING_AI expense → muncul di query tab Pending AI
  const v2 = computeVerdict({ aiDate: yesterday, aiAmount: 30000, typedAmount: 30000 });
  const expP = await fetch(REST("expenses"), { method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ category: "petty_cash", subcategory: "Parkir", amount: 30000, date: today, description: "Parkir review [" + RUN + "]", teknisi_name: RUN, created_by: RUN, validation_status: v2.validation }) });
  const expPRow = (await expP.json())[0]; createdExp.push(expPRow.id);
  const pendingQ = await (await fetch(REST(`expenses?validation_status=eq.PENDING_AI&description=ilike.*${RUN}*&select=id`), { headers: H })).json();
  ok("expense PENDING_AI muncul di query tab Pending AI", pendingQ.length === 1);

  // ───────── PHASE 4: Daily summary per teknisi ─────────
  console.log("\n4) Ringkasan harian teknisi (grouping)");
  const todayExp = await (await fetch(REST(`expenses?teknisi_name=eq.${RUN}&date=eq.${today}&subcategory=in.(Bensin Motor,Parkir)&select=subcategory,amount`), { headers: H })).json();
  const bensin = todayExp.filter(e => e.subcategory === "Bensin Motor").reduce((s, e) => s + Number(e.amount), 0);
  const parkir = todayExp.filter(e => e.subcategory === "Parkir").reduce((s, e) => s + Number(e.amount), 0);
  ok("total bensin hari ini = Rp25.000", bensin === 25000);
  ok("total parkir hari ini = Rp30.000", parkir === 30000);
  ok("grand total = Rp55.000", bensin + parkir === 55000);

  // ───────── PHASE 5: Cleanup query (>30 hari) + key extraction ─────────
  console.log("\n5) Cleanup query >30 hari + ekstraksi key r2_url");
  // Insert ai_extraction dgn created_at 31 hari lalu + r2_url
  const old = new Date(Date.now() - 31 * 86400000).toISOString();
  const r2key = "expenses/2026-05/" + RUN + "/old.jpg";
  const aiOld = await fetch(REST("ai_extractions"), { method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ source: "teknisi_dashboard", source_ref: "tekexp:" + RUN + "_old", sender_name: RUN, intent: "expense", confidence: "LOW", status: "approved", created_at: old, r2_url: "/api/foto?key=" + encodeURIComponent(r2key) }) });
  const aiOldRow = (await aiOld.json())[0]; createdAi.push(aiOldRow.id);
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const sweep = await (await fetch(REST(`ai_extractions?source=eq.teknisi_dashboard&created_at=lt.${cutoff}&r2_url=not.is.null&sender_name=eq.${RUN}&select=id,r2_url`), { headers: H })).json();
  ok("cleanup query menangkap foto >30 hari", sweep.length === 1);
  // Ekstraksi key (logika cron)
  let extractedKey = null;
  try { extractedKey = new URL("http://x" + sweep[0].r2_url).searchParams.get("key"); } catch {}
  ok("ekstraksi key dari r2_url benar", extractedKey === r2key);
  // Foto baru (hari ini) TIDAK tersapu
  const notSwept = await (await fetch(REST(`ai_extractions?source=eq.teknisi_dashboard&created_at=lt.${cutoff}&sender_name=eq.${RUN}&source_ref=eq.${encodeURIComponent("tekexp:" + RUN + "_link")}&select=id`), { headers: H })).json();
  ok("foto hari ini tidak ikut tersapu", notSwept.length === 0);

  // ───────── CLEANUP ─────────
  console.log("\n6) Cleanup data test");
  await fetch(REST(`expenses?description=ilike.*${RUN}*`), { method: "DELETE", headers: H });
  await fetch(REST(`ai_extractions?sender_name=eq.${RUN}`), { method: "DELETE", headers: H });
  const leftExp = await (await fetch(REST(`expenses?description=ilike.*${RUN}*&select=id`), { headers: H })).json();
  const leftAi = await (await fetch(REST(`ai_extractions?sender_name=eq.${RUN}&select=id`), { headers: H })).json();
  ok("cleanup expenses bersih", leftExp.length === 0);
  ok("cleanup ai_extractions bersih", leftAi.length === 0);

  console.log(`\n=== HASIL: ${pass} PASS · ${fail} FAIL ===\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
