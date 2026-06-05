// Smoke test — Kasbon Requests (50 multi-request) terhadap DB Supabase asli.
// Mereplikasi PERSIS logic approveKasbon/rejectKasbon di src/App.jsx + insert di MyReportView.
// Verifikasi: count per status, linkage expense_id, total per teknisi (payroll grouping),
// trim teknisi_name, tidak ada double-expense. Cleanup otomatis di akhir.
// Jalankan: node scripts/smoke-kasbon.mjs
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
const ok = (n, c) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n); } };
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

// Marker unik agar cleanup hanya hapus data test ini
const RUN = "SMOKE_" + Date.now().toString(36).toUpperCase();

// 5 teknisi — sengaja pakai trailing/leading space + variasi case untuk uji trim & payroll grouping
const TEKNISI = [
  { name: "Putra Smoke", phone: "6280000000001" },
  { name: "  Budi Smoke  ", phone: "6280000000002" },   // spasi depan-belakang
  { name: "Eka Smoke", phone: "6280000000003" },
  { name: "Dani Smoke ", phone: "6280000000004" },       // trailing space
  { name: "Fajar Smoke", phone: "6280000000005" },
];

const createdReqIds = [];
const createdExpIds = [];

// ── Replikasi insert kasbon (MyReportView submit) ──
async function insertKasbon(teknisi, amount, reason) {
  const id = "KSB-" + RUN + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const payload = {
    id,
    teknisi_name: (teknisi.name || "").trim(),  // MyReportView trims on submit
    teknisi_phone: teknisi.phone,
    amount, reason: reason + " [" + RUN + "]", status: "PENDING",
    requested_at: new Date().toISOString(),
  };
  const r = await fetch(REST("kasbon_requests"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(payload) });
  const row = (await r.json())[0];
  if (row) createdReqIds.push(row.id);
  return { ok: r.ok, row };
}

// ── Replikasi approveKasbon (App.jsx) — ATOMIC CLAIM via PATCH status=eq.PENDING ──
async function approveKasbon(req, reviewNotes = "") {
  // ATOMIC CLAIM: PATCH dengan filter status=eq.PENDING. Hanya 1 caller konkuren dapat baris.
  const claimR = await fetch(REST("kasbon_requests?id=eq." + encodeURIComponent(req.id) + "&status=eq.PENDING"), {
    method: "PATCH", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ status: "APPROVED", reviewed_at: new Date().toISOString(), reviewed_by: "smoke", review_notes: reviewNotes || null }),
  });
  if (!claimR.ok) return { ok: false, err: await claimR.text() };
  const claimed = await claimR.json();
  if (!claimed || claimed.length === 0) return { ok: true, skipped: true };  // kalah race

  const expPayload = {
    category: "petty_cash",
    subcategory: "Kasbon Karyawan",
    teknisi_name: (req.teknisi_name || "").trim(),
    amount: req.amount,
    date: today,
    description: "Kasbon: " + (req.reason || ""),
    validation_status: "APPROVED",
    last_changed_by: "smoke-test",
  };
  const er = await fetch(REST("expenses"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(expPayload) });
  if (!er.ok) {
    // rollback klaim
    await fetch(REST("kasbon_requests?id=eq." + encodeURIComponent(req.id)), { method: "PATCH", headers: H, body: JSON.stringify({ status: "PENDING", reviewed_at: null, reviewed_by: null, review_notes: null }) });
    return { ok: false, err: await er.text() };
  }
  const expId = (await er.json())[0]?.id;  // UUID hasil generate DB
  createdExpIds.push(expId);
  await fetch(REST("kasbon_requests?id=eq." + encodeURIComponent(req.id)), {
    method: "PATCH", headers: H, body: JSON.stringify({ expense_id: expId }),
  });
  return { ok: true, expId };
}

// ── Replikasi rejectKasbon (App.jsx) ──
async function rejectKasbon(req, reviewNotes = "") {
  const ur = await fetch(REST("kasbon_requests?id=eq." + encodeURIComponent(req.id)), {
    method: "PATCH", headers: H,
    body: JSON.stringify({ status: "REJECTED", reviewed_at: new Date().toISOString(), reviewed_by: "smoke", review_notes: reviewNotes || null }),
  });
  return { ok: ur.ok };
}

async function main() {
  console.log("\n=== SMOKE TEST: Kasbon 50 Multi-Request (" + RUN + ") ===\n");

  // ───────── PHASE 1: Insert 50 requests ─────────
  console.log("1) Insert 50 kasbon requests (random nominal, 5 teknisi)");
  const requests = [];
  // Expected per-teknisi total dari yang nanti di-APPROVE
  let insertFail = 0;
  for (let i = 0; i < 50; i++) {
    const tek = TEKNISI[i % 5];
    // Nominal bervariasi: 10rb - 500rb (kelipatan 5000), termasuk 1 nilai besar untuk uji BIGINT
    const amount = i === 49 ? 2_000_000 : (Math.floor(Math.random() * 99) + 2) * 5000;
    const { ok: insOk, row } = await insertKasbon(tek, amount, "Keperluan #" + i);
    if (!insOk || !row) { insertFail++; continue; }
    requests.push(row);
  }
  ok("50 request ter-insert (gagal: " + insertFail + ")", requests.length === 50);

  // ───────── PHASE 2: Bagi jadi approve / reject / pending ─────────
  // Index 0-29 → APPROVE (30), 30-39 → REJECT (10), 40-49 → biarkan PENDING (10)
  const toApprove = requests.slice(0, 30);
  const toReject = requests.slice(30, 40);
  const toPending = requests.slice(40, 50);

  console.log("\n2) Approve 30 request (replikasi approveKasbon → INSERT expenses)");
  let approveFail = 0;
  for (const req of toApprove) {
    const res = await approveKasbon(req, "ok smoke");
    if (!res.ok) { approveFail++; console.log("    approve fail:", res.err); }
  }
  ok("30 approve sukses (gagal: " + approveFail + ")", approveFail === 0);

  console.log("\n3) Reject 10 request");
  let rejectFail = 0;
  for (const req of toReject) {
    const res = await rejectKasbon(req, "tidak sesuai");
    if (!res.ok) rejectFail++;
  }
  ok("10 reject sukses (gagal: " + rejectFail + ")", rejectFail === 0);

  // ───────── PHASE 3: Verifikasi DB state ─────────
  console.log("\n4) Verifikasi state kasbon_requests di DB");
  const allReq = await (await fetch(REST(`kasbon_requests?reason=ilike.*${RUN}*&select=*`), { headers: H })).json();
  ok("total 50 request di DB", allReq.length === 50);
  ok("30 APPROVED", allReq.filter(r => r.status === "APPROVED").length === 30);
  ok("10 REJECTED", allReq.filter(r => r.status === "REJECTED").length === 10);
  ok("10 PENDING", allReq.filter(r => r.status === "PENDING").length === 10);

  // Setiap APPROVED wajib punya expense_id; PENDING/REJECTED tidak boleh punya
  const approvedRows = allReq.filter(r => r.status === "APPROVED");
  ok("semua APPROVED punya expense_id", approvedRows.every(r => r.expense_id));
  ok("tidak ada PENDING/REJECTED yang punya expense_id",
    allReq.filter(r => r.status !== "APPROVED").every(r => !r.expense_id));

  // ───────── PHASE 4: Verifikasi expenses ter-create ─────────
  console.log("\n5) Verifikasi expenses (Kasbon Karyawan) ter-create benar");
  const allExp = await (await fetch(REST(`expenses?description=ilike.*${RUN}*&select=*`), { headers: H })).json();
  ok("30 expense ter-create", allExp.length === 30);
  ok("semua expense subcategory=Kasbon Karyawan", allExp.every(e => e.subcategory === "Kasbon Karyawan"));
  ok("semua expense category=petty_cash", allExp.every(e => e.category === "petty_cash"));
  ok("semua expense validation_status=APPROVED", allExp.every(e => e.validation_status === "APPROVED"));
  ok("tidak ada expense untuk PENDING/REJECTED", allExp.length === 30);

  // expense_id di request match dengan id expense yang ada
  const expIdSet = new Set(allExp.map(e => e.id));
  ok("setiap expense_id di request match expense nyata",
    approvedRows.every(r => expIdSet.has(r.expense_id)));

  // ───────── PHASE 5: Verifikasi TOTAL per teknisi (payroll grouping) ─────────
  console.log("\n6) Verifikasi total kasbon per teknisi (payroll grouping)");
  // Hitung expected dari approvedRows (sumber kebenaran)
  const expectedPerTek = {};
  for (const r of approvedRows) {
    const key = r.teknisi_name; // sudah trimmed saat insert
    expectedPerTek[key] = (expectedPerTek[key] || 0) + Number(r.amount);
  }
  // Hitung actual dari expenses
  const actualPerTek = {};
  for (const e of allExp) {
    const key = e.teknisi_name;
    actualPerTek[key] = (actualPerTek[key] || 0) + Number(e.amount);
  }
  let perTekMatch = true;
  for (const key of Object.keys(expectedPerTek)) {
    const exp = expectedPerTek[key], act = actualPerTek[key] || 0;
    const match = exp === act;
    if (!match) perTekMatch = false;
    console.log(`    ${match ? "✓" : "✗"} ${key}: expected Rp${exp.toLocaleString("id-ID")} | actual Rp${act.toLocaleString("id-ID")}`);
  }
  ok("total per teknisi cocok (request vs expense)", perTekMatch);

  // Verifikasi tidak ada teknisi_name dengan trailing/leading space (trim benar untuk payroll)
  ok("tidak ada teknisi_name dengan spasi depan/belakang (trim OK)",
    allExp.every(e => e.teknisi_name === e.teknisi_name.trim()));
  // "Budi Smoke" & "Dani Smoke" yang aslinya ada spasi → harus ter-normalize
  ok("'Budi Smoke' ter-trim benar (ada di grouping)", actualPerTek["Budi Smoke"] !== undefined);
  ok("'Dani Smoke' ter-trim benar (ada di grouping)", actualPerTek["Dani Smoke"] !== undefined);

  // ───────── PHASE 6: Verifikasi GRAND TOTAL ─────────
  console.log("\n7) Verifikasi grand total");
  const expectedGrand = approvedRows.reduce((s, r) => s + Number(r.amount), 0);
  const actualGrand = allExp.reduce((s, e) => s + Number(e.amount), 0);
  console.log(`    Grand total approved: Rp${actualGrand.toLocaleString("id-ID")}`);
  ok("grand total expense = sum approved request", expectedGrand === actualGrand);
  // BIGINT: pastikan nilai 2jt tidak overflow/terpotong
  ok("nilai besar (Rp2.000.000) tersimpan utuh", allExp.some(e => Number(e.amount) === 2_000_000) || approvedRows.every(r => Number(r.amount) !== 2_000_000));

  // ───────── PHASE 7: Uji idempotency double-approve ─────────
  console.log("\n8) Uji double-approve 1 request PENDING (cek double-expense)");
  if (toPending.length > 0) {
    const target = toPending[0];
    // Re-fetch status terkini
    const cur = await (await fetch(REST("kasbon_requests?id=eq." + encodeURIComponent(target.id) + "&select=*"), { headers: H })).json();
    const curRow = cur[0];
    // Approve 2x berturut (race simulation)
    const [a1, a2] = await Promise.all([approveKasbon(curRow, "race1"), approveKasbon(curRow, "race2")]);
    // Hitung expense untuk teknisi target dengan reason target ini
    const dupExp = await (await fetch(REST(`expenses?description=ilike.*${encodeURIComponent(curRow.reason)}*&select=id,amount`), { headers: H })).json();
    console.log(`    Expense ter-create untuk request ini: ${dupExp.length} (idealnya 1)`);
    if (dupExp.length > 1) {
      console.log("    ⚠️  DOUBLE-EXPENSE terdeteksi — perlu guard idempotency di approveKasbon");
      // track utk cleanup
      dupExp.forEach(e => { if (!createdExpIds.includes(e.id)) createdExpIds.push(e.id); });
    }
    ok("double-approve TIDAK buat 2 expense (idempotent)", dupExp.length <= 1);
  }

  // ───────── CLEANUP ─────────
  console.log("\n9) Cleanup data test");
  // Hapus expenses
  const delExp = await fetch(REST(`expenses?description=ilike.*${RUN}*`), { method: "DELETE", headers: H });
  // Hapus kasbon_requests
  const delReq = await fetch(REST(`kasbon_requests?reason=ilike.*${RUN}*`), { method: "DELETE", headers: H });
  // Verifikasi bersih
  const leftExp = await (await fetch(REST(`expenses?description=ilike.*${RUN}*&select=id`), { headers: H })).json();
  const leftReq = await (await fetch(REST(`kasbon_requests?reason=ilike.*${RUN}*&select=id`), { headers: H })).json();
  ok("cleanup expenses bersih", leftExp.length === 0);
  ok("cleanup kasbon_requests bersih", leftReq.length === 0);

  // ───────── SUMMARY ─────────
  console.log(`\n=== HASIL: ${pass} PASS · ${fail} FAIL ===\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
