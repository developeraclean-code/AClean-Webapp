// Smoke — Multi-hari SKIP (anti dobel-invoice). Pakai fungsi lib ASLI
// resolveMultiDayInvoiceAction terhadap data DB nyata.
//
// Skenario:
//  1. Induk + invoice induk (UNPAID) + anak (is_multi_day, parent=induk).
//  2. Keputusan utk anak = SKIP, anchor = induk → simulasikan integrasi (tautkan anak ke
//     invoice induk, TIDAK buat invoice ke-2). Assert: tetap 1 invoice utk project.
//  3. Anak diverifikasi DULUAN (induk belum ada invoice) → CREATE anchor induk.
//  4. Invoice induk LUNAS (PAID) → hari berikutnya = CREATE_SEPARATE (job baru).
// Cleanup otomatis. Jalankan: node scripts/smoke-multiday-skip.mjs
import { readFileSync } from "node:fs";
import { resolveMultiDayInvoiceAction } from "../src/lib/invoiceMultiDay.js";

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
const ok = (n, c, x) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n + (x ? "  → " + x : "")); } };
const RUN = "SMOKE_MD_" + Date.now().toString(36).toUpperCase();

async function rq(method, path, body) {
  const r = await fetch(REST(path), { method, headers: { ...H, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { ok: r.ok, status: r.status, json: j };
}

const induk = "JOB-" + RUN + "-D1";
const anak2 = "JOB-" + RUN + "-D2";
const anak3 = "JOB-" + RUN + "-D3";
const invInduk = "INV-" + RUN + "-INDUK";
const orderIds = [induk, anak2, anak3];
const invIds = [invInduk];

async function cleanup() {
  console.log("\n🧹 Cleanup…");
  for (const id of invIds) await rq("DELETE", `invoices?id=eq.${id}`);
  await rq("DELETE", `invoices?job_id=in.(${orderIds.join(",")})`);
  for (const id of orderIds) await rq("DELETE", `orders?id=eq.${id}`);
}

async function main() {
  console.log(`\n🔬 SMOKE MULTI-HARI SKIP  [${RUN}]\n`);

  // Induk (hari-1) + anak (hari-2)
  await rq("POST", "orders", { id: induk, customer: "SMOKE MD " + RUN, phone: "62811000222", service: "Install", units: 2, status: "INVOICE_APPROVED", date: "2026-06-11", is_multi_day: false, day_number: 1 });
  await rq("POST", "orders", { id: anak2, customer: "SMOKE MD " + RUN, phone: "62811000222", service: "Install", units: 1, status: "REPORT_SUBMITTED", date: "2026-06-12", is_multi_day: true, day_number: 2, parent_job_id: induk });
  const invRes = await rq("POST", "invoices", { id: invInduk, job_id: induk, customer: "SMOKE MD " + RUN, service: "Install", total: 3440000, status: "UNPAID", created_at: "2026-06-11T10:00:00Z" });
  ok("Setup induk+anak+invoice induk (UNPAID)", invRes.ok, JSON.stringify(invRes.json));

  // Ambil invoices grup dari DB (seperti precheck di kode)
  const grp1 = await rq("GET", `invoices?job_id=eq.${induk}&status=neq.CANCELLED&select=id,job_id,status,total,created_at`);

  // (1) Keputusan utk anak hari-2 — pakai fungsi lib asli
  const act2 = resolveMultiDayInvoiceAction({
    report: { id: anak2, parent_job_id: induk, is_multi_day: true, day_number: 2 },
    invoices: grp1.json || [],
  });
  ok("Keputusan anak hari-2 = SKIP", act2.type === "SKIP", `got ${act2.type}`);
  ok("Anchor = induk", act2.anchorJobId === induk, `got ${act2.anchorJobId}`);
  ok("Existing = invoice induk", act2.existing?.id === invInduk);

  // Simulasikan integrasi SKIP: tautkan anak ke invoice induk, TIDAK buat invoice baru
  await rq("PATCH", `orders?id=eq.${anak2}`, { status: "COMPLETED", invoice_id: invInduk });
  // (sengaja TIDAK insert invoice baru)

  // Assert end-state: tetap 1 invoice utk project, anak tertaut
  const invCount = await rq("GET", `invoices?or=(job_id.eq.${induk},job_id.eq.${anak2})&status=neq.CANCELLED&select=id`);
  ok("Tetap 1 invoice untuk project (tidak dobel)", (invCount.json || []).length === 1, `got ${invCount.json?.length}`);
  const anakRow = await rq("GET", `orders?id=eq.${anak2}&select=invoice_id,status`);
  ok("Anak tertaut ke invoice induk + COMPLETED", anakRow.json?.[0]?.invoice_id === invInduk && anakRow.json?.[0]?.status === "COMPLETED");

  // (2) Anak diverifikasi DULUAN (belum ada invoice grup) → CREATE anchor induk
  const actFirst = resolveMultiDayInvoiceAction({
    report: { id: anak2, parent_job_id: induk, is_multi_day: true }, invoices: [],
  });
  ok("Anak duluan (belum ada invoice) → CREATE anchor induk", actFirst.type === "CREATE" && actFirst.anchorJobId === induk);

  // (3) Invoice induk LUNAS → hari-3 = CREATE_SEPARATE (job baru)
  await rq("PATCH", `invoices?id=eq.${invInduk}`, { status: "PAID", paid_at: new Date().toISOString() });
  const grp2 = await rq("GET", `invoices?job_id=eq.${induk}&status=neq.CANCELLED&select=id,job_id,status,total,created_at`);
  const act3 = resolveMultiDayInvoiceAction({
    report: { id: anak3, parent_job_id: induk, is_multi_day: true, day_number: 3 },
    invoices: grp2.json || [],
  });
  ok("Invoice induk LUNAS → hari-3 = CREATE_SEPARATE", act3.type === "CREATE_SEPARATE", `got ${act3.type}`);
  ok("CREATE_SEPARATE anchor = job hari-3 sendiri", act3.anchorJobId === anak3, `got ${act3.anchorJobId}`);

  console.log(`\n────────────────────────\n  PASS: ${pass}   FAIL: ${fail}\n────────────────────────`);
}

main().catch(e => { console.error("\n💥 ERROR:", e.message); fail++; }).finally(async () => {
  await cleanup();
  process.exit(fail > 0 ? 1 : 0);
});
