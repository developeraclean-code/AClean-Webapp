// Smoke — "Lampirkan Bukti Bayar manual" (InvoiceView AttachProofModal).
// Validasi query & kolom yang dipakai modal:
//   1. Fetch bukti belum ter-match (invoice_id null + image_url not null) — sumber tab WA Monitor.
//   2. Resolve suggestion (update invoice_id, status CONFIRMED, matched_at, match_source, resolved_*).
//   3. Patch invoice.payment_proof_url (kasus sudah PAID → lampirkan saja).
//   4. Bukti dari NOMOR BEDA tetap bisa dipilih (lintas-nomor).
// Cleanup otomatis. Jalankan: node scripts/smoke-attach-proof.mjs
import { readFileSync } from "node:fs";

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
const RUN = "SMOKE_AP_" + Date.now().toString(36).toUpperCase();

async function rq(method, path, body) {
  const r = await fetch(REST(path), { method, headers: { ...H, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { ok: r.ok, status: r.status, json: j };
}

const invId = "INV-" + RUN;
const suggIds = [];

async function cleanup() {
  console.log("\n🧹 Cleanup…");
  for (const id of suggIds) await rq("DELETE", `payment_suggestions?id=eq.${id}`);
  await rq("DELETE", `invoices?id=eq.${invId}`);
  console.log("   selesai.");
}

async function main() {
  console.log(`\n🔬 SMOKE LAMPIRKAN BUKTI  [${RUN}]\n`);

  // Invoice UNPAID dgn nomor A
  const invRes = await rq("POST", "invoices", {
    id: invId, customer: "SMOKE Cust " + RUN, phone: "628111000111",
    service: "Cleaning", total: 350000, status: "UNPAID", created_at: new Date().toISOString(),
  });
  ok("Buat invoice UNPAID", invRes.ok, JSON.stringify(invRes.json));

  // 2 suggestion belum ter-match: satu nomor SAMA, satu nomor BEDA
  for (const [tag, phone] of [["sama", "628111000111"], ["beda", "628999888777"]]) {
    const r = await rq("POST", "payment_suggestions", {
      phone, sender_name: "SMOKE " + tag + " " + RUN, amount: 350000, bank: "BCA",
      status: "PENDING", source: "image",
      image_url: `wa-images/${RUN}_${tag}.jpg`, raw_message: "(bukti)",
    });
    ok(`Buat suggestion (${tag}, ${phone})`, r.ok && r.json?.[0]?.id, JSON.stringify(r.json));
    if (r.json?.[0]?.id) suggIds.push(r.json[0].id);
  }

  // 1. Query modal: bukti belum ter-match + ada image — harus muncul kedua suggestion smoke
  const q = await rq("GET", `payment_suggestions?select=id,phone,sender_name,amount,image_url,invoice_id&invoice_id=is.null&image_url=not.is.null&sender_name=like.SMOKE*${RUN}&order=created_at.desc`);
  ok("Fetch bukti belum ter-match (filter sama spt modal)", q.ok && Array.isArray(q.json) && q.json.length === 2, `got ${q.json?.length}`);
  ok("Bukti dari NOMOR BEDA ikut muncul (lintas-nomor)", (q.json || []).some(s => s.phone === "628999888777"));

  // Pilih yang nomor BEDA (skenario customer bayar dari nomor lain)
  const picked = (q.json || []).find(s => s.phone === "628999888777");

  // 2. Resolve suggestion (persis update modal)
  const now = new Date().toISOString();
  const upS = await rq("PATCH", `payment_suggestions?id=eq.${picked.id}`, {
    invoice_id: invId, status: "CONFIRMED", matched_at: now, match_source: "manual",
    resolved_at: now, resolved_by: "Smoke Owner",
  });
  ok("Resolve suggestion (CONFIRMED + invoice_id + match_source)", upS.ok, JSON.stringify(upS.json));
  const checkS = await rq("GET", `payment_suggestions?id=eq.${picked.id}&select=status,invoice_id,match_source,resolved_by`);
  const sr = checkS.json?.[0];
  ok("Suggestion → status CONFIRMED", sr?.status === "CONFIRMED");
  ok("Suggestion → invoice_id ter-set", sr?.invoice_id === invId);
  ok("Suggestion → keluar dari daftar 'belum match'", sr?.invoice_id != null);

  // 3. Patch invoice payment_proof_url (kasus markPaid akan set ini juga)
  const upI = await rq("PATCH", `invoices?id=eq.${invId}`, { payment_proof_url: picked.image_url, status: "PAID", paid_at: now });
  ok("Patch invoice (proof_url + PAID)", upI.ok, JSON.stringify(upI.json));
  const checkI = await rq("GET", `invoices?id=eq.${invId}&select=payment_proof_url,status`);
  const ir = checkI.json?.[0];
  ok("Invoice → payment_proof_url ter-isi", ir?.payment_proof_url === picked.image_url);
  ok("Invoice → status PAID", ir?.status === "PAID");

  // 4. Kasus 'sudah PAID → lampirkan bukti saja' (proof diganti tanpa ubah status)
  const sama = (q.json || []).find(s => s.phone === "628111000111");
  const up2 = await rq("PATCH", `invoices?id=eq.${invId}`, { payment_proof_url: sama.image_url });
  ok("Lampirkan ulang bukti pada invoice PAID (proof-only)", up2.ok);
  const check2 = await rq("GET", `invoices?id=eq.${invId}&select=payment_proof_url,status`);
  ok("Invoice tetap PAID, proof terupdate", check2.json?.[0]?.status === "PAID" && check2.json?.[0]?.payment_proof_url === sama.image_url);

  console.log(`\n────────────────────────\n  PASS: ${pass}   FAIL: ${fail}\n────────────────────────`);
}

main().catch(e => { console.error("\n💥 ERROR:", e.message); fail++; }).finally(async () => {
  await cleanup();
  process.exit(fail > 0 ? 1 : 0);
});
