// Smoke test — Maintenance "Buat Order" (opsi A & B) clash detection, 50 job variatif.
// Mereplikasi PERSIS cekTeknisiAvailableDB + hitungDurasi + MAX_LOKASI_PER_HARI di src/App.jsx.
// Tujuan: pastikan order yang DITERIMA tidak pernah bentrok jam / lewat cap 6 per teknisi/hari,
// dan order yang DITOLAK memang benar bentrok. Plus probe race (TOCTOU) burst konkuren.
// Cleanup otomatis di akhir (hapus orders + units + client smoke).
// Jalankan: node scripts/smoke-maintenance-order-clash.mjs
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
const RUN = "SMOKE_" + Date.now().toString(36).toUpperCase();

// ── Replikasi PERSIS hitungDurasi (App.jsx:6308) ──
function hitungDurasi(service, units) {
  const u = parseInt(units) || 1;
  if (service === "Install") return Math.min(u * 2.5, 8);
  if (service === "Repair") return Math.ceil(u * 1.5);
  if (service === "Complain") return Math.max(0.5, u * 0.5);
  if (u === 1) return 1;
  if (u === 2) return 2;
  if (u === 3) return 3;
  if (u === 4) return 3;
  if (u <= 6) return 4;
  if (u <= 8) return 5;
  if (u <= 10) return 6;
  return 8;
}
const ACTIVE = ["PENDING", "CONFIRMED", "DISPATCHED", "IN_PROGRESS", "ON_SITE"];
const MAX_LOKASI_PER_HARI = 6;
const toMin = (t) => { const [h, m] = (t || "09:00").split(":").map(Number); return h * 60 + m; };
function addJam(timeStr, jamTambah) {
  const total = toMin(timeStr) + Math.round(jamTambah * 60);
  const nh = Math.floor(total / 60), nm = total % 60;
  if (nh >= 17) return "17:00";
  return String(nh).padStart(2, "0") + ":" + String(nm).padStart(2, "0");
}
const hitungJamSelesai = (t, s, u) => addJam(t, Math.min(hitungDurasi(s, u), 8));

// ── Replikasi PERSIS cekTeknisiAvailableDB (App.jsx:6383) — query DB live ──
async function cekTeknisiAvailableDB(teknisiName, date, timeStart, service, units) {
  const durMenit = Math.round(hitungDurasi(service, units) * 60);
  const startMin = toMin(timeStart);
  const endMin = startMin + durMenit;
  const q = REST(`orders?teknisi=eq.${encodeURIComponent(teknisiName)}&date=eq.${date}&status=in.(${ACTIVE.join(",")})&select=id,time,time_end,service,units,status`);
  const r = await fetch(q, { headers: H });
  const dbOrders = await r.json();
  if ((dbOrders || []).length >= MAX_LOKASI_PER_HARI)
    return { ok: false, reason: `cap 6 (${teknisiName} ${date})` };
  for (const o of dbOrders) {
    const oStartMin = toMin(o.time);
    const oDur = Math.round(hitungDurasi(o.service || "Cleaning", o.units || 1) * 60);
    const oEndMin = oStartMin + oDur;
    if (startMin < oEndMin && endMin > oStartMin)
      return { ok: false, reason: `bentrok ${o.id} ${o.time}-${o.time_end}` };
  }
  return { ok: true };
}

const createdOrderIds = [];
let clientId = null;
const unitIds = [];

async function insertOrder({ teknisi, helper, date, time, service, units, status }) {
  const id = "JOB-" + RUN + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const payload = {
    id, customer: "SMOKE PT Menara " + RUN, phone: "6281200000000",
    address: "Jl. Test No. 1", area: "Karawaci",
    service, type: service, units, teknisi, helper: helper || null,
    date, time, time_end: hitungJamSelesai(time, service, units),
    status: status || "CONFIRMED", dispatch: false, source: "maintenance",
    maintenance_client_id: clientId, maintenance_unit_ids: unitIds.slice(0, Math.min(units, unitIds.length)),
    notes: "Maintenance smoke [" + RUN + "]",
  };
  const r = await fetch(REST("orders"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(payload) });
  const row = (await r.json())[0];
  if (row) createdOrderIds.push(row.id);
  return { ok: r.ok, row, err: r.ok ? null : JSON.stringify(row) };
}

function rng(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }

(async () => {
  console.log(`\n🔧 Smoke Maintenance Order Clash — ${RUN}\n`);

  // ── Setup: client + 8 unit smoke ──
  const cr = await fetch(REST("maintenance_clients"), { method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ name: "SMOKE Clash " + RUN, pic_name: "PIC Smoke", pic_phone: "6281200000000", address: "Jl. Test No. 1", portal_token: "mtk_" + RUN.toLowerCase() + "0".repeat(40 - 4 - RUN.length), token_active: true, hide_costs: false }) });
  clientId = (await cr.json())[0]?.id;
  ok("setup client maintenance smoke", !!clientId);
  for (let i = 1; i <= 8; i++) {
    const ur = await fetch(REST("maintenance_units"), { method: "POST", headers: { ...H, Prefer: "return=representation" },
      body: JSON.stringify({ client_id: clientId, unit_code: `SMK-${i}`, location: `Lantai ${i}`, brand: "Daikin", ac_type: "split", capacity_pk: 1, refrigerant: "R32", status: "active" }) });
    const uid = (await ur.json())[0]?.id; if (uid) unitIds.push(uid);
  }
  ok("setup 8 unit", unitIds.length === 8);

  // ── Generate 50 job variatif (deterministik via seeded RNG) ──
  const TEKNISI = ["Tek Alpha " + RUN, "Tek Bravo " + RUN, "Tek Charlie " + RUN];  // 3 teknisi → paksa banyak collision
  const HELPERS = ["Hlp X " + RUN, "Hlp Y " + RUN, ""];
  const DATES = ["2026-07-01", "2026-07-02"];          // 2 tanggal → padat
  const STARTS = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00"];
  const SERVICES = ["Cleaning", "Install", "Repair", "Complain"];
  const rand = rng(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const decisions = [];  // {accepted, teknisi, date, time, service, units, startMin, endMin}
  let accepted = 0, rejected = 0;

  for (let i = 0; i < 50; i++) {
    const teknisi = pick(TEKNISI);
    const date = pick(DATES);
    const time = pick(STARTS);
    const service = pick(SERVICES);
    const units = service === "Install" ? 1 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 10);

    const chk = await cekTeknisiAvailableDB(teknisi, date, time, service, units);
    if (!chk.ok) { rejected++; decisions.push({ accepted: false, teknisi, date, reason: chk.reason }); continue; }

    const ins = await insertOrder({ teknisi, helper: pick(HELPERS), date, time, service, units });
    if (!ins.ok) { fail++; console.log("  ❌ insert gagal job " + i + ": " + ins.err); continue; }
    accepted++;
    const startMin = toMin(time);
    const endMin = startMin + Math.round(hitungDurasi(service, units) * 60);
    decisions.push({ accepted: true, teknisi, date, time, service, units, startMin, endMin });
  }
  console.log(`\n  📊 50 job → ${accepted} diterima, ${rejected} ditolak (bentrok/cap)\n`);
  ok("ada job diterima & ada yang ditolak (mix variatif)", accepted > 0 && rejected > 0);

  // ── INV1: tidak ada 2 order DITERIMA yang overlap per teknisi+tanggal ──
  // Re-query DB (sumber kebenaran), bukan state lokal.
  let overlapFound = 0, capViolation = 0;
  for (const tek of TEKNISI) {
    for (const d of DATES) {
      const r = await fetch(REST(`orders?teknisi=eq.${encodeURIComponent(tek)}&date=eq.${d}&status=in.(${ACTIVE.join(",")})&select=id,time,service,units`), { headers: H });
      const rows = await r.json();
      if (rows.length > MAX_LOKASI_PER_HARI) capViolation++;
      const ivs = rows.map(o => { const s = toMin(o.time); return { id: o.id, s, e: s + Math.round(hitungDurasi(o.service, o.units) * 60) }; }).sort((a, b) => a.s - b.s);
      for (let i = 1; i < ivs.length; i++) if (ivs[i].s < ivs[i - 1].e) { overlapFound++; console.log(`     ⚠️ overlap ${tek} ${d}: ${ivs[i - 1].id} vs ${ivs[i].id}`); }
    }
  }
  ok("INV1 — tidak ada order diterima yang overlap jam", overlapFound === 0);
  ok("INV2 — tidak ada teknisi lewat cap 6/hari", capViolation === 0);

  // ── INV3: probe race / TOCTOU — 6 submit konkuren ke slot KOSONG yang sama ──
  // SEKARANG lewat gerbang atomik RPC try_claim_teknisi_slot (migrasi 070).
  // Ekspektasi setelah fix: HANYA 1 yang menang → 1 order mendarat.
  const rt = "Tek Race " + RUN, rd = "2026-07-09", rtime = "09:00";
  const rEnd = hitungJamSelesai(rtime, "Cleaning", 3); // 3 jam → 12:00
  // Mereplikasi alur createOrder baru: insert order → klaim RPC → hapus order kalau kalah.
  const burst = await Promise.all(Array.from({ length: 6 }, async () => {
    const ins = await insertOrder({ teknisi: rt, date: rd, time: rtime, service: "Cleaning", units: 3 });
    if (!ins.ok) return "failerr";
    const cr = await fetch(REST("rpc/try_claim_teknisi_slot"), { method: "POST", headers: H,
      body: JSON.stringify({ p_teknisi: rt, p_date: rd, p_order_id: ins.row.id, p_start: rtime, p_end: rEnd }) });
    const won = await cr.json();
    if (won === true) return "inserted";
    // kalah race → rollback order (sama spt createOrder)
    await fetch(REST("orders?id=eq." + encodeURIComponent(ins.row.id)), { method: "DELETE", headers: H });
    return "rejected";
  }));
  const landedR = await fetch(REST(`orders?teknisi=eq.${encodeURIComponent(rt)}&date=eq.${rd}&status=in.(${ACTIVE.join(",")})&select=id`), { headers: H });
  const landed = (await landedR.json()).length;
  const claimR = await fetch(REST(`technician_schedule?teknisi=eq.${encodeURIComponent(rt)}&date=eq.${rd}&select=id`), { headers: H });
  const claims = (await claimR.json()).length;
  console.log(`\n  🏁 Burst 6 konkuren (via RPC) → ${JSON.stringify(burst.reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {}))}; klaim: ${claims}, order mendarat: ${landed}`);
  ok("INV3 — gerbang atomik: tepat 1 klaim slot menang (anti double-book)", claims === 1);
  ok("INV3 — tepat 1 order mendarat di slot race", landed === 1);

  // ── Cleanup ──
  console.log("\n  🧹 Cleanup...");
  await fetch(REST(`technician_schedule?teknisi=eq.${encodeURIComponent(rt)}&date=eq.${rd}`), { method: "DELETE", headers: H });
  for (const id of createdOrderIds) await fetch(REST("orders?id=eq." + encodeURIComponent(id)), { method: "DELETE", headers: H });
  for (const id of unitIds) await fetch(REST("maintenance_units?id=eq." + id), { method: "DELETE", headers: H });
  if (clientId) await fetch(REST("maintenance_clients?id=eq." + clientId), { method: "DELETE", headers: H });
  const leftR = await fetch(REST(`orders?notes=like.*${RUN}*&select=id`), { headers: H });
  const left = await leftR.json();
  ok("cleanup orders smoke bersih", Array.isArray(left) && left.length === 0);

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ ADA FAIL"} — ${pass} pass / ${fail} fail\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
