// Seed: PT. Jaya Kreasi Indonesia - Jalan Panjang (30 unit AC)
// Rekap cleaning 21–23 April 2025. Teknisi: Eri, Agung, Putra, Dendy.
import { readFileSync } from "node:fs";
const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const SU = env.SUPABASE_URL || env.VITE_SUPABASE_URL, SK = env.SUPABASE_SERVICE_KEY;
const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const REST = (p) => `${SU}/rest/v1/${p}`;
const token = "mtk_" + Array.from({ length: 40 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

await fetch(REST("maintenance_clients?name=eq." + encodeURIComponent("PT. Jaya Kreasi Indonesia - Jalan Panjang")), { method: "DELETE", headers: H });

const client = (await (await fetch(REST("maintenance_clients"), {
  method: "POST", headers: { ...H, Prefer: "return=representation" },
  body: JSON.stringify({
    name: "PT. Jaya Kreasi Indonesia - Jalan Panjang",
    address: "Jalan Panjang No. 41, Kebun Jeruk, Jakarta Barat",
    portal_token: token,
    token_active: true,
    hide_costs: true,
    contract_status: "active",
  }),
})).json())[0];

if (!client?.id) { console.error("Gagal insert client:", client); process.exit(1); }

const U = (code, location, brand, ac_type, capacity_pk, serial_no, status = "active", notes = null) => ({
  client_id: client.id, unit_code: code, location, brand, ac_type,
  capacity_pk, serial_no, status,
  last_service_date: "2025-04-21",
  service_interval_months: 3,
  notes,
});

// ── 30 Unit AC ──────────────────────────────────────────────────────────────
// Serial number = nomor indoor unit (dari kolom INDOOR di rekap)
const units = [
  // Lt. 1
  U("AC-01", "Lt.1 - R. Meeting Sunmaster JP",  "York",   "split",   1.5, "TL6C12E5JBM",  "active", "Kurang freon R22"),
  U("AC-02", "Lt.1 - Ruang Lobby",              "York",   "ducted",  8,   "MAL25T19",     "active"),
  U("AC-03", "Lt.1 - Ruang Lobby",              "York",   "ducted",  8,   "MAL25T15",     "active"),
  U("AC-04", "Lt.1 - Ruang PPF JP/Pemasangan",  "Daikin", "ducted",  4,   null,           "active", "Kurang freon R22"),

  // Lt. 2
  U("AC-05", "Lt.2 - Ruang Pantry",             "York",   "split",   1,   "XS9FXCO03",   "active"),
  U("AC-06", "Lt.2 - Ruang Meeting CPF 1",      "York",   "split",   1.5, null,           "rusak",  "Kendala bocor freon"),
  U("AC-07", "Lt.2 - Ruang Sales PPF 1",        "York",   "split",   1,   null,           "active"),
  U("AC-08", "Lt.2 - Ruang Sales PPF 1",        "York",   "split",   1,   null,           "active"),
  U("AC-09", "Lt.2 - Ruang Manager PPF",        "York",   "split",   1,   "FTKC35TVMA",  "active"),
  U("AC-10", "Lt.2 - Ruang Sales CPF 1",        "York",   "split",   1.5, null,           "active"),
  U("AC-11", "Lt.2 - Ruang Sales CPF 1",        "York",   "split",   1,   "TL6C12EJMRR", "active"),
  U("AC-12", "Lt.2 - Ruang Manager CPF 1",      "York",   "split",   1.5, null,           "active"),
  U("AC-13", "Lt.2 - Ruang Marketing",          "Daikin", "split",   1.5, "TL6612EMRR",  "active"),
  U("AC-14", "Lt.2 - Ruang Manager Marketing",  "York",   "split",   1,   null,           "active"),
  U("AC-15", "Lt.2 - Ruang Sales Llumar",       "York",   "split",   1.5, null,           "active"),
  U("AC-16", "Lt.2 - Ruang Sales Llumar",       "York",   "split",   1.5, "FTNC35TVMA",  "active"),
  U("AC-17", "Lt.2 - Ruang Manager Llumar",     "Daikin", "split",   1.5, null,           "active"),
  U("AC-18", "Lt.2 - Ruang Server",             "York",   "split",   0.75,"Y59FXCO9BM",  "active"),
  U("AC-19", "Lt.2 - Ruang Server",             "York",   "split",   0.75,"Y59FXCO9BM",  "active"),
  U("AC-20", "Lt.2 - Ruang Meeting Llumar",     "York",   "cassette",2,   null,           "active"),
  U("AC-21", "Lt.2 - Ruang Meeting Llumar",     "York",   "cassette",2,   null,           "active"),
  U("AC-22", "Lt.2 - Ruang Koridor",            "York",   "cassette",2.5, null,           "active"),

  // Lt. 1 Rumah Belakang
  U("AC-23", "Lt.1 RB - Ruang QC SPV GRB",     "York",   "split",   1,   null,           "active"),
  U("AC-24", "Lt.1 RB - Ruang CS GRB (Pantry)", "York",  "split",   1.5, "TL6C0085JMRR","active"),
  U("AC-25", "Lt.1 RB - Ruang CS GRB (Pantry)", "York",  "split",   1.5, null,           "active"),
  U("AC-26", "Lt.1 RB - Ruang CS GRB (Pantry)", "York",  "split",   1.5, null,           "active"),
  U("AC-27", "Lt.1 RB - Ruang Gudang",          "York",  "split",   1,   null,           "active"),

  // Lt. 2 Rumah Belakang
  U("AC-28", "Lt.2 RB - Ruang IT",              "York",   "split",   1.5, "TL6612E5JMRR","active"),
  U("AC-29", "Lt.2 RB - Ruang Admin GRB/Sales", "York",  "split",   1,   "Y55FXCO5BRM", "active"),
  U("AC-30", "Lt.2 RB - Ruang Manager GRB",     "York",  "split",   1.5, "TL6C12E5JMM", "active"),
];

const insUnits = await fetch(REST("maintenance_units"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(units) });
const savedUnits = await insUnits.json();
if (!Array.isArray(savedUnits)) { console.error("Gagal insert units:", savedUnits); process.exit(1); }

// ── Maintenance logs: cleaning 21 April 2025 (freon dalam PSI / pressure reading) ──
const freonPsi = [
  140, 65, 50, null,
  150, null, 145, 140, 150, 145, 140, 150, 130, 140, 150, 145, 140, 120, 140, null, null, null,
  140, 150, 145, 160, 145,
  145, 140, 160,
];
const outdoorOk = [
  true, true, true, true,
  true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false,
  true, true, true, true, true,
  true, true, true,
];

const logs = savedUnits.map((u, i) => {
  const psi = freonPsi[i];
  const outdoor = outdoorOk[i];
  let desc = `Cuci unit (indoor${outdoor ? " + outdoor" : ""})`;
  if (psi) desc += `. Tekanan freon: ${psi} PSI.`;
  else desc += " Data freon tidak tercatat.";
  if (u.status === "rusak") desc += " AC kendala bocor freon — perlu tindak lanjut.";
  if (u.notes?.includes("Kurang freon")) desc += " Tekanan rendah, perlu isi freon.";
  return {
    unit_id: u.id,
    client_id: client.id,
    service_date: "2025-04-21",
    service_type: "Cuci",
    technician: "Eri, Agung, Putra, Dendy",
    description: desc,
    materials: [],
    invoiced: false,
    created_by: "Dedy Rinaldi",
  };
});

const insLogs = await fetch(REST("maintenance_logs"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(logs) });
const savedLogs = await insLogs.json();

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
