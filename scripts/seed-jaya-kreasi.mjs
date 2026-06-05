// Seed data: PT. Jaya Kreasi Indonesia - Alam Sutera (24 unit AC)
// Data dari rekap cleaning 17–21 April 2025. Teknisi: Ade, Dedy, Wout. Pengawas: Wawan AC.
import { readFileSync } from "node:fs";
const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const SU = env.SUPABASE_URL || env.VITE_SUPABASE_URL, SK = env.SUPABASE_SERVICE_KEY;
const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const REST = (p) => `${SU}/rest/v1/${p}`;
const token = "mtk_" + Array.from({ length: 40 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

// Hapus duplikat sebelum seed ulang
await fetch(REST("maintenance_clients?name=eq." + encodeURIComponent("PT. Jaya Kreasi Indonesia - Alam Sutera")), { method: "DELETE", headers: H });

const client = (await (await fetch(REST("maintenance_clients"), {
  method: "POST", headers: { ...H, Prefer: "return=representation" },
  body: JSON.stringify({
    name: "PT. Jaya Kreasi Indonesia - Alam Sutera",
    address: "Multiguna T8 Kav 50-52, Alam Sutera, Tangerang",
    pic_name: "Wawan",
    portal_token: token,
    token_active: true,
    hide_costs: true,
    contract_status: "active",
  }),
})).json())[0];

if (!client?.id) { console.error("Gagal insert client:", client); process.exit(1); }

// Helper: U(code, location, brand, ac_type, capacity_pk, refrigerant, serial_no, status, notes)
const U = (code, location, brand, ac_type, capacity_pk, refrigerant, serial_no, status = "active", notes = null) => ({
  client_id: client.id, unit_code: code, location, brand, ac_type,
  capacity_pk, refrigerant, serial_no, status,
  last_service_date: "2025-04-17",
  service_interval_months: 3,
  notes,
});

// ── 24 Unit AC dari rekap cleaning 17–21 April 2025 ──
// ac_type: cassette = FTKC/FHC, split = FT
const units = [
  U("AC-01", "Lobby 1",              "Daikin", "cassette",  2,    "R32", "E003763",  "active"),
  U("AC-02", "R. Printing",          "Daikin", "split",     2,    "R32", "E009680",  "active"),
  U("AC-03", "R. Operasional",       "York",   "split",     1,    "R32", "E002236",  "active"),
  U("AC-04", "R. Printing",          "Daikin", "cassette",  2,    "R32", "FTE50KV14","active"),
  U("AC-05", "R. Operasional",       "Daikin", "split",     2,    "R32", "E003762",  "active"),
  U("AC-06", "R. Operasional",       "Daikin", "cassette",  2,    "R22", "E009961",  "active"),
  U("AC-07", "R. Cutting Baru",      "Daikin", "cassette",  2,    "R32", "E0021670", "active"),
  U("AC-08", "R. Cutting",           "Daikin", "cassette",  2,    "R32", "E0023775", "active"),
  U("AC-09", "R. Cutting",           "Daikin", "split",     2,    "R32", "E002835",  "active"),
  U("AC-10", "R. Cutting",           "Daikin", "cassette",  2,    "R22", "E000422",  "retired", "Unit di ganti ke Gree/Baru"),
  U("AC-11", "R. FA",                "Daikin", "split",     0.75, "R22", "E008757",  "active"),
  U("AC-12", "R. FA Manager",        "Daikin", "cassette",  1.5,  "R22", "E001957",  "active"),
  U("AC-13", "R. FA",                "Daikin", "split",     0.75, "R22", "E002419",  "active"),
  U("AC-14", "R. FA",                "Daikin", "split",     1,    "R32", "E006813",  "active"),
  U("AC-15", "R. Server",            "Daikin", "split",     0.75, "R32", "E001766",  "active", "Unit pindah ke Peitu/Baru"),
  U("AC-16", "R. Sekretaris",        "Daikin", "split",     1,    "R22", "E002390",  "active"),
  U("AC-17", "R. Direktur",          "Daikin", "split",     1,    "R22", "E002579",  "active"),
  U("AC-18", "R. HRGA Manager",      "Daikin", "split",     0.5,  "R22", "E003741",  "active"),
  U("AC-19", "R. HRGA",              "Daikin", "split",     1,    "R22", "E002505",  "active"),
  U("AC-20", "Gudang HRGA",          "Daikin", "split",     1,    "R22", "E004030",  "active"),
  U("AC-21", "R. Meeting Kecil",     "Daikin", "split",     0.5,  "R22", "E002400",  "active"),
  U("AC-22", "R. Meeting Besar",     "Daikin", "split",     1,    "R22", "E000484",  "active"),
  U("AC-23", "R. Meeting Besar",     "Daikin", "cassette",  2,    "R22", "E000303",  "rusak",   "AC kendala rusak saat servis April 2025"),
  U("AC-24", "R. Meeting Besar",     "Daikin", "cassette",  2,    "R22", null,       "active"),
];

const insUnits = await fetch(REST("maintenance_units"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(units) });
const savedUnits = await insUnits.json();
if (!Array.isArray(savedUnits)) { console.error("Gagal insert units:", savedUnits); process.exit(1); }

// ── Maintenance logs: cleaning 17 April 2025 ──
// freon_gram: null = tidak ada topup freon
const freonData = [
  20, 160, 140, 150, 60, 190, 160, 145, 143, 20,
  115, 150, 156, 130, 150, 60, 70, null, null, null,
  40, 80, null, null,
];
const outdoorChecked = [true, true, true, false, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false];

const logs = savedUnits.map((u, i) => {
  const freon = freonData[i];
  const outdoor = outdoorChecked[i];
  let desc = `Cuci unit (indoor${outdoor ? " + outdoor" : ""})`;
  if (freon) desc += `. Tambah freon ${freon}g.`;
  if (u.status === "rusak") desc += " AC kendala — perlu tindak lanjut.";
  if (i === 9) desc += " Unit akan diganti Gree baru.";
  if (i === 14) desc += " Unit akan dipindah ke Peitu/Baru.";

  const materials = freon ? [{
    item: `Freon ${u.refrigerant || "R32"}`,
    qty: freon,
    unit: "gram",
  }] : [];

  return {
    unit_id: u.id,
    client_id: client.id,
    service_date: "2025-04-17",
    service_type: "Cuci",
    technician: "Ade, Dedy, Wout",
    description: desc,
    materials,
    invoiced: false,
    created_by: "Dedy Rinaldi",
  };
});

const insLogs = await fetch(REST("maintenance_logs"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(logs) });
const savedLogs = await insLogs.json();

// Portal URL
let base = "https://status.aclean.id";
try { const s = await (await fetch(REST("app_settings?key=eq.customer_portal_url&select=value"), { headers: H })).json(); if (s[0]?.value) base = s[0].value.replace(/\/$/, ""); } catch {}

console.log(JSON.stringify({
  client_id: client.id,
  client_name: client.name,
  units_inserted: savedUnits.length,
  logs_inserted: Array.isArray(savedLogs) ? savedLogs.length : 0,
  token,
  portal_url: `${base}/m/${token}`,
}, null, 2));
