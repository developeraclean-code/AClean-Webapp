// Smoke-test route INTERNAL /api/maintenance lewat handler ASLI (via bridge :3300).
// Auth pakai X-Internal-Token = INTERNAL_API_SECRET. Test semua action + cleanup.
import { readFileSync } from "node:fs";
const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const SECRET = env.INTERNAL_API_SECRET;
const API = "http://localhost:3300/api/maintenance";

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n, extra || ""); } };
async function call(action, payload = {}) {
  const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "X-Internal-Token": SECRET }, body: JSON.stringify({ action, ...payload }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let clientId, unitIds = [], logIds = [], invId;
try {
  console.log("0) auth: tanpa token → ditolak");
  const noauth = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list-clients" }) });
  ok("tanpa X-Internal-Token → 401", noauth.status === 401);

  console.log("1) create-client");
  let r = await call("create-client", { name: "SMOKE-INT PT Test", pic_phone: "08129999888", hide_costs: true });
  clientId = r.body.client?.id;
  ok("klien dibuat", r.status === 200 && clientId);
  ok("pic_phone dinormalisasi ke 628xxx", r.body.client?.pic_phone === "628129999888", r.body.client?.pic_phone);
  ok("portal_token tergenerate (mtk_)", /^mtk_[a-z0-9]{40}$/.test(r.body.client?.portal_token || ""));

  console.log("2) create-client tanpa nama → ditolak");
  r = await call("create-client", { name: "" });
  ok("nama kosong → 400", r.status === 400);

  console.log("3) save-units (batch insert)");
  r = await call("save-units", { client_id: clientId, units: [
    { unit_code: "U-1", brand: "Daikin", capacity_pk: 1, status: "active" },
    { unit_code: "U-2", brand: "Gree", capacity_pk: 2, status: "rusak" },
  ] });
  unitIds = (r.body.units || []).map(u => u.id);
  ok("2 unit tersimpan", r.status === 200 && unitIds.length === 2);

  console.log("4) save-units (edit/rename via id — bukan konflik PK)");
  r = await call("save-units", { client_id: clientId, units: [{ id: unitIds[0], unit_code: "U-1X", brand: "Daikin", status: "retired" }] });
  ok("rename U-1→U-1X + status retired", r.status === 200 && r.body.units?.[0]?.unit_code === "U-1X" && r.body.units?.[0]?.status === "retired");

  console.log("5) save-units (duplikat kode → pesan ramah)");
  r = await call("save-units", { client_id: clientId, units: [{ unit_code: "U-2" }] });
  ok("duplikat U-2 ditolak dgn pesan jelas", r.status === 400 && /sudah ada/i.test(r.body.error || ""), r.body.error);

  console.log("6) list-units");
  r = await call("list-units", { client_id: clientId });
  ok("list-units kembalikan 2 unit", r.status === 200 && r.body.units?.length === 2);

  console.log("7) create-log ×2 + list-logs");
  r = await call("create-log", { client_id: clientId, unit_id: unitIds[1], service_date: "2026-05-01", service_type: "Cuci", technician: "Andi", cost: 150000 });
  if (r.body.log?.id) logIds.push(r.body.log.id);
  r = await call("create-log", { client_id: clientId, unit_id: unitIds[1], service_date: "2026-06-01", service_type: "Perbaikan", technician: "Rizal", cost: 500000 });
  if (r.body.log?.id) logIds.push(r.body.log.id);
  ok("2 log dibuat", logIds.length === 2);
  r = await call("list-logs", { client_id: clientId });
  ok("list-logs kembalikan 2", r.status === 200 && r.body.logs?.length === 2);

  console.log("8) create-log tanpa field wajib → ditolak");
  r = await call("create-log", { client_id: clientId });
  ok("log tanpa unit_id/date → 400", r.status === 400);

  console.log("9) update-client (toggle akses/hide/expiry/kontrak)");
  r = await call("update-client", { id: clientId, token_active: false, hide_costs: false, contract_status: "inactive" });
  ok("toggle tersimpan", r.status === 200 && r.body.client?.token_active === false && r.body.client?.hide_costs === false && r.body.client?.contract_status === "inactive");

  console.log("10) regen-token (token lama mati)");
  const oldTok = r.body.client?.portal_token;
  r = await call("regen-token", { id: clientId });
  ok("token baru beda dari lama", r.status === 200 && r.body.client?.portal_token && r.body.client.portal_token !== oldTok);

  console.log("11) create-invoice B2B (handler asli → tabel invoices)");
  r = await call("create-invoice", { client_id: clientId, log_ids: logIds });
  invId = r.body.invoice?.id;
  ok("invoice dibuat di tabel invoices", r.status === 200 && /^INV-/.test(invId || ""));
  ok("total invoice = 650000 (150k+500k)", r.body.invoice?.total === 650000, r.body.invoice?.total);
  ok("invoice.maintenance_client_id ter-link", r.body.invoice?.maintenance_client_id === clientId);

  console.log("12) create-invoice tanpa log_ids → ditolak");
  r = await call("create-invoice", { client_id: clientId, log_ids: [] });
  ok("log_ids kosong → 400", r.status === 400);

  console.log("13) action tak dikenal → 400");
  r = await call("does-not-exist");
  ok("action ngawur → 400", r.status === 400);

  console.log("\nCLEANUP");
  // hapus invoice via REST service key (route maintenance tak punya delete-invoice)
  const SU = env.SUPABASE_URL || env.VITE_SUPABASE_URL, SK = env.SUPABASE_SERVICE_KEY;
  const H = { apikey: SK, Authorization: "Bearer " + SK };
  if (invId) await fetch(`${SU}/rest/v1/invoices?id=eq.${invId}`, { method: "DELETE", headers: H });
  r = await call("delete-client", { id: clientId });
  ok("delete-client (cascade) sukses", r.status === 200);

  console.log(`\n=== HASIL SMOKE INTERNAL (handler asli): ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
} catch (e) { console.error("FATAL:", e.message); process.exit(1); }
