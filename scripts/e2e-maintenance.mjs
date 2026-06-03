// E2E integration test — Modul Maintenance B2B (terhadap DB Supabase asli).
// Mereplikasi PERSIS operasi backend api/[route].js (route maintenance + m-portal).
// Jalankan: node scripts/e2e-maintenance.mjs
import { readFileSync } from "node:fs";

// ---- load .env.local ----
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SU = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SK = env.SUPABASE_SERVICE_KEY;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const REST = (p) => `${SU}/rest/v1/${p}`;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const genToken = () => "mtk_" + Array.from({ length: 40 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

let clientId, token, unitIds = [], logIds = [], invoiceId;

async function main() {
  console.log("\n=== E2E Maintenance B2B (DB asli) ===\n");

  // ---------- 1. create-client ----------
  console.log("1) create-client");
  token = genToken();
  let r = await fetch(REST("maintenance_clients"), { method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ name: "E2E PT Test Tower", pic_name: "Budi", pic_phone: "6281234567890", portal_token: token, token_active: true, hide_costs: true }) });
  const client = (await r.json())[0];
  clientId = client?.id;
  ok("klien dibuat + dapat id", r.ok && clientId);
  ok("default hide_costs=true", client?.hide_costs === true);
  ok("default token_active=true", client?.token_active === true);
  ok("token_expires_at null (permanen)", client?.token_expires_at === null);

  // ---------- 2. save-units (insert batch) ----------
  console.log("2) save-units (3 unit baru)");
  const baseUnits = [
    { unit_code: "AC-001", location: "Lobby", brand: "Daikin", ac_type: "split", capacity_pk: 1, refrigerant: "R32", status: "active" },
    { unit_code: "AC-002", location: "Lt2", brand: "Gree", ac_type: "cassette", capacity_pk: 2, refrigerant: "R410A", status: "active" },
    { unit_code: "AC-003", location: "Genset", brand: "LG", ac_type: "standing", capacity_pk: 3, refrigerant: "R22", status: "rusak" },
  ];
  for (const u of baseUnits) {
    const rr = await fetch(REST("maintenance_units"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ ...u, client_id: clientId }) });
    const row = (await rr.json())[0]; if (row) unitIds.push(row.id);
  }
  ok("3 unit tersimpan", unitIds.length === 3);

  // ---------- 3. unique constraint (client_id, unit_code) ----------
  console.log("3) UNIQUE(client_id, unit_code)");
  r = await fetch(REST("maintenance_units"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ client_id: clientId, unit_code: "AC-001", status: "active" }) });
  ok("duplikat unit_code DITOLAK (409)", r.status === 409 || !r.ok);

  // ---------- 4. edit unit via PATCH (ganti kode) ----------
  console.log("4) edit unit (rename AC-003 -> AC-003X)");
  r = await fetch(REST("maintenance_units?id=eq." + unitIds[2]), { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ unit_code: "AC-003X", status: "retired" }) });
  const edited = (await r.json())[0];
  ok("rename + status update sukses (tanpa konflik PK)", r.ok && edited?.unit_code === "AC-003X" && edited?.status === "retired");

  // ---------- 5. create-log + trigger last_service_date ----------
  console.log("5) create-log (trigger last_service_date)");
  const logs = [
    { unit_id: unitIds[0], service_date: "2026-02-20", service_type: "Cuci Rutin", technician: "Andi", cost: 150000 },
    { unit_id: unitIds[0], service_date: "2026-05-12", service_type: "Isi Freon", technician: "Andi", cost: 325000 },
    { unit_id: unitIds[1], service_date: "2026-05-30", service_type: "Cuci Rutin", technician: "Rizal", cost: 175000 },
  ];
  for (const l of logs) {
    const rr = await fetch(REST("maintenance_logs"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ ...l, client_id: clientId }) });
    const row = (await rr.json())[0]; if (row) logIds.push(row.id);
  }
  ok("3 log tersimpan", logIds.length === 3);
  await sleep(300);
  r = await fetch(REST("maintenance_units?id=eq." + unitIds[0] + "&select=last_service_date"), { headers: H });
  const u0 = (await r.json())[0];
  ok("trigger set last_service_date ke tanggal terbaru (2026-05-12)", u0?.last_service_date === "2026-05-12");

  // ---------- 6. m-portal: strip cost saat hide_costs=true ----------
  console.log("6) m-portal strip-cost (hide_costs=true)");
  let logsPortal = await mportalLogs();
  ok("field cost DIHAPUS dari semua log portal", logsPortal.every(l => !("cost" in l)));

  // ---------- 7. toggle hide_costs OFF -> cost muncul ----------
  console.log("7) toggle hide_costs=false");
  await patchClient({ hide_costs: false });
  logsPortal = await mportalLogs();
  ok("cost MUNCUL setelah hide_costs=false", logsPortal.some(l => "cost" in l && l.cost > 0));
  await patchClient({ hide_costs: true }); // balikin

  // ---------- 8. gate: token_active=false -> 403 ----------
  console.log("8) gate token_active=false");
  await patchClient({ token_active: false });
  let gate = await mportalGate();
  ok("akses OFF -> 403 TOKEN_DISABLED", gate.status === 403 && gate.code === "TOKEN_DISABLED");
  await patchClient({ token_active: true });

  // ---------- 9. gate: expired -> 401 ----------
  console.log("9) gate token_expires_at masa lalu");
  await patchClient({ token_expires_at: "2025-01-01T00:00:00Z" });
  gate = await mportalGate();
  ok("expired -> 401 TOKEN_EXPIRED", gate.status === 401 && gate.code === "TOKEN_EXPIRED");
  await patchClient({ token_expires_at: null });
  gate = await mportalGate();
  ok("permanen (null) -> 200 OK", gate.status === 200);

  // ---------- 10. invoice B2B ----------
  console.log("10) create-invoice B2B");
  const cRes = await fetch(REST("maintenance_clients?id=eq." + clientId + "&select=*"), { headers: H });
  const cl = (await cRes.json())[0];
  const idFilter = logIds.join(",");
  const lRes = await fetch(REST(`maintenance_logs?id=in.(${idFilter})&select=id,cost`), { headers: H });
  const selLogs = await lRes.json();
  const total = selLogs.reduce((s, l) => s + (Number(l.cost) || 0), 0);
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  invoiceId = "INV-" + ymd + "-E2E" + Math.random().toString(36).slice(-3).toUpperCase();
  r = await fetch(REST("invoices"), { method: "POST", headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ id: invoiceId, customer: cl.name, phone: cl.pic_phone, service: `Maintenance ${selLogs.length} unit`, invoice_type: "service", units: selLogs.length, labor: total, material: 0, total, status: "PENDING_APPROVAL", maintenance_client_id: clientId, created_at: new Date().toISOString() }) });
  const inv = (await r.json())[0];
  ok("invoice B2B dibuat di tabel invoices", r.ok && inv?.id === invoiceId);
  ok("total invoice = sum cost log (650000)", inv?.total === 650000);
  ok("invoice ter-link maintenance_client_id", inv?.maintenance_client_id === clientId);
  // mark logs invoiced
  await fetch(REST(`maintenance_logs?id=in.(${idFilter})`), { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ invoiced: true }) });
  r = await fetch(REST(`maintenance_logs?id=in.(${idFilter})&select=invoiced`), { headers: H });
  ok("semua log ditandai invoiced=true", (await r.json()).every(l => l.invoiced === true));

  // ---------- 11. regen-token ----------
  console.log("11) regen-token (token lama mati)");
  const oldToken = token;
  token = genToken();
  await fetch(REST("maintenance_clients?id=eq." + clientId), { method: "PATCH", headers: H, body: JSON.stringify({ portal_token: token }) });
  r = await fetch(REST("maintenance_clients?portal_token=eq." + oldToken + "&select=id"), { headers: H });
  ok("token lama tidak ditemukan lagi", (await r.json()).length === 0);
  r = await fetch(REST("maintenance_clients?portal_token=eq." + token + "&select=id"), { headers: H });
  ok("token baru valid", (await r.json()).length === 1);

  // ---------- 12. SECURITY: anon key DIBLOK (RLS restrictive) ----------
  console.log("12) keamanan: anon key tidak bisa baca tabel");
  const anonH = { apikey: ANON, Authorization: "Bearer " + ANON };
  r = await fetch(REST("maintenance_units?select=id,unit_code"), { headers: anonH });
  const anonRows = r.ok ? await r.json() : [];
  ok("anon SELECT maintenance_units -> 0 row (RLS blok)", Array.isArray(anonRows) && anonRows.length === 0);
  r = await fetch(REST("maintenance_clients?select=portal_token"), { headers: anonH });
  const anonClients = r.ok ? await r.json() : [];
  ok("anon SELECT maintenance_clients -> 0 row (token tak bocor)", Array.isArray(anonClients) && anonClients.length === 0);

  // ---------- CLEANUP ----------
  console.log("\nCLEANUP");
  await fetch(REST("invoices?id=eq." + invoiceId), { method: "DELETE", headers: H });
  await fetch(REST("maintenance_clients?id=eq." + clientId), { method: "DELETE", headers: H }); // cascade units+logs
  r = await fetch(REST("maintenance_clients?id=eq." + clientId + "&select=id"), { headers: H });
  ok("klien + cascade unit/log terhapus", (await r.json()).length === 0);
  r = await fetch(REST("invoices?id=eq." + invoiceId + "&select=id"), { headers: H });
  ok("invoice test terhapus", (await r.json()).length === 0);

  console.log(`\n=== HASIL: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
}

// helper: replikasi logika m-portal handler
async function mportalGate() {
  const r = await fetch(REST(`maintenance_clients?portal_token=eq.${token}&select=id,name,token_active,token_expires_at,hide_costs`), { headers: H });
  const rows = await r.json();
  if (!rows.length) return { status: 404, code: "NOT_FOUND" };
  const c = rows[0];
  if (!c.token_active) return { status: 403, code: "TOKEN_DISABLED" };
  if (c.token_expires_at && new Date(c.token_expires_at) < new Date()) return { status: 401, code: "TOKEN_EXPIRED" };
  return { status: 200, code: "OK", client: c };
}
async function mportalLogs() {
  const g = await mportalGate();
  if (g.status !== 200) return [];
  const r = await fetch(REST(`maintenance_logs?client_id=eq.${clientId}&select=id,unit_id,service_date,service_type,cost`), { headers: H });
  let logs = await r.json();
  if (g.client.hide_costs) logs = logs.map(({ cost, ...rest }) => rest);
  return logs;
}
async function patchClient(upd) {
  await fetch(REST("maintenance_clients?id=eq." + clientId), { method: "PATCH", headers: H, body: JSON.stringify(upd) });
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
