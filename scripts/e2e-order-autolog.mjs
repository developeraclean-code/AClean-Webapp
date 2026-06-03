// E2E: integrasi Order→Maintenance autolog (Opsi B). Handler ASLI via bridge :3300 + DB asli.
import { readFileSync } from "node:fs";
const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const SU = env.SUPABASE_URL || env.VITE_SUPABASE_URL, SK = env.SUPABASE_SERVICE_KEY, SECRET = env.INTERNAL_API_SECRET;
const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const REST = (p) => `${SU}/rest/v1/${p}`;
const API = "http://localhost:3300/api/maintenance";
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n, x || ""); } };
const call = async (action, p = {}) => { const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "X-Internal-Token": SECRET }, body: JSON.stringify({ action, ...p }) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

let clientId, unitIds = [], orderId = "TEST-ORD-" + Date.now();
try {
  // setup: klien + 2 unit (existing registry)
  const c = (await (await fetch(REST("maintenance_clients"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ name: "E2E-AUTOLOG Co", portal_token: "mtk_" + Array.from({length:40},()=>"abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random()*36)]).join("") }) })).json())[0];
  clientId = c.id;
  for (const code of ["AC-A", "AC-B"]) {
    const u = (await (await fetch(REST("maintenance_units"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ client_id: clientId, unit_code: code, status: "active" }) })).json())[0];
    unitIds.push(u.id);
  }
  // buat order maintenance (2 unit dipilih)
  await fetch(REST("orders"), { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ id: orderId, customer: "E2E-AUTOLOG Co", service: "Cleaning", date: "2026-06-10", teknisi: "Andi", status: "CONFIRMED", maintenance_client_id: clientId, maintenance_unit_ids: unitIds }) });
  ok("setup: klien + 2 unit + order maintenance", clientId && unitIds.length === 2);

  console.log("1) autolog-from-order (verify pertama)");
  let r = await call("autolog-from-order", { order_id: orderId });
  ok("created = 2 log", r.status === 200 && r.body.created === 2, JSON.stringify(r.body));
  let logs = await (await fetch(REST("maintenance_logs?order_id=eq." + orderId + "&select=unit_id,client_id,order_id,service_date,technician,service_type"), { headers: H })).json();
  if (!Array.isArray(logs)) logs = [];
  ok("2 log tersimpan & tertaut order", logs.length === 2 && logs.every(l => l.order_id === orderId));
  ok("log pakai data order (teknisi Andi, tgl 2026-06-10)", logs.every(l => l.technician === "Andi" && l.service_date === "2026-06-10"));
  ok("client_id benar di log", logs.every(l => l.client_id === clientId));

  console.log("2) trigger last_service_date unit ter-update");
  await new Promise(s => setTimeout(s, 300));
  const u0 = await (await fetch(REST("maintenance_units?id=eq." + unitIds[0] + "&select=last_service_date"), { headers: H })).json();
  ok("last_service_date = 2026-06-10", u0[0]?.last_service_date === "2026-06-10");

  console.log("3) IDEMPOTENT: verify ulang tidak bikin dobel");
  r = await call("autolog-from-order", { order_id: orderId });
  ok("verify ulang → skipped", r.status === 200 && r.body.skipped === true, JSON.stringify(r.body));
  logs = await (await fetch(REST("maintenance_logs?order_id=eq." + orderId + "&select=id"), { headers: H })).json();
  ok("tetap 2 log (tidak dobel)", logs.length === 2);

  console.log("4) order NON-maintenance → skip");
  const plainOrder = "TEST-PLAIN-" + Date.now();
  await fetch(REST("orders"), { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ id: plainOrder, customer: "Biasa", service: "Cleaning", date: "2026-06-10", status: "CONFIRMED" }) });
  r = await call("autolog-from-order", { order_id: plainOrder });
  ok("order biasa → skipped (bukan maintenance)", r.status === 200 && r.body.skipped === true);
  await fetch(REST("orders?id=eq." + plainOrder), { method: "DELETE", headers: H });

  console.log("5) order tidak ada → 404");
  r = await call("autolog-from-order", { order_id: "NGADA-123" });
  ok("order tak ada → 404", r.status === 404);

  // cleanup
  console.log("\nCLEANUP");
  await fetch(REST("orders?id=eq." + orderId), { method: "DELETE", headers: H });
  await fetch(REST("maintenance_clients?id=eq." + clientId), { method: "DELETE", headers: H }); // cascade unit+log
  const left = await (await fetch(REST("maintenance_logs?order_id=eq." + orderId + "&select=id"), { headers: H })).json();
  ok("cleanup: log + unit + klien + order terhapus", left.length === 0);

  console.log(`\n=== HASIL: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
} catch (e) { console.error("FATAL:", e.message); process.exit(1); }
