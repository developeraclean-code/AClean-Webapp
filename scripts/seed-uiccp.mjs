// Seed: PT UICCP - Ruko New Jasmine, Gading Serpong (23 unit AC)
// Data dari service reports Apr–Mei 2026. CUST240, phone: 6281287619907.
import { readFileSync } from "node:fs";
const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const SU = env.SUPABASE_URL || env.VITE_SUPABASE_URL, SK = env.SUPABASE_SERVICE_KEY;
const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const REST = (p) => `${SU}/rest/v1/${p}`;
const token = "mtk_" + Array.from({ length: 40 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

await fetch(REST("maintenance_clients?name=eq." + encodeURIComponent("PT UICCP")), { method: "DELETE", headers: H });

const client = (await (await fetch(REST("maintenance_clients"), {
  method: "POST", headers: { ...H, Prefer: "return=representation" },
  body: JSON.stringify({
    name: "PT UICCP",
    address: "Ruko New Jasmine Blok HA16 No. 7-8, Jalan Kelapa Gading Selatan 1, Gading Serpong",
    pic_phone: "6281287619907",
    customer_id: "CUST240",
    portal_token: token,
    token_active: true,
    hide_costs: true,
    contract_status: "active",
  }),
})).json())[0];

if (!client?.id) { console.error("Gagal insert client:", client); process.exit(1); }

const U = (code, location, brand, ac_type, capacity_pk, model, last_svc, status = "active", notes = null) => ({
  client_id: client.id, unit_code: code, location, brand, ac_type,
  capacity_pk, serial_no: model || null, status,
  last_service_date: last_svc,
  service_interval_months: 3,
  notes,
});

// ── 23 Unit AC ──────────────────────────────────────────────────────────────
// serial_no diisi dengan model number (identifier terbaik yang tersedia)
const units = [
  // ── Ruko No. 7 — Lt. 2 (dari laporan Apr 27) ──
  U("AC-01", "Ruko 7 - Lt.2 Ruang Kerja (unit 1)",  "Gree",  "split", 1.5,  "GWC-12MOO3/I",   "2026-04-27"),
  U("AC-02", "Ruko 7 - Lt.2 Ruang Kerja (unit 2)",  "Sharp", "split", 1,    "AH-A9SAY",        "2026-04-27"),
  U("AC-03", "Ruko 7 - Lt.2 Ruang Kerja (unit 3)",  "AUX",   "split", 1,    "ASW-09A4/SKR1",   "2026-04-27"),
  U("AC-04", "Ruko 7 - Lt.2 Ruang Kerja (unit 4)",  "Haier", "split", 0.75, "HSU-07GTO03",     "2026-04-27"),
  U("AC-05", "Ruko 7 - Lt.2 Ruang Server",          "Gree",  "split", 1.5,  "GWC-12NI/I",     "2026-04-27"),
  U("AC-06", "Ruko 7 - Lt.2 Ruang Owner",           "Haier", "split", 1.5,  "HSU-12GTR03",     "2026-04-27"),

  // ── Ruko No. 7 — Lt. 3 (dari laporan Apr 27) ──
  U("AC-07", "Ruko 7 - Lt.3 Ruang Kerja (unit 5)",  "Gree",  "split", 1.5,  "GWC-12N1/I",     "2026-04-27"),
  U("AC-08", "Ruko 7 - Lt.3 Ruang Kerja (unit 6)",  "Gree",  "split", 1,    "GWC-09M005S/I",  "2026-04-27"),
  U("AC-09", "Ruko 7 - Lt.3 Ruang Kerja (unit 7)",  "Gree",  "split", 2,    "GWC-18M005A/I",  "2026-04-27"),
  U("AC-10", "Ruko 7 - Lt.3 Ruang Server",          "Gree",  "split", 1.5,  "GWC-12N1/I",     "2026-04-27"),
  U("AC-11", "Ruko 7 - Lt.3 Ruang Kantor",          "AUX",   "split", 1,    "ASW-09A4/SUKR1", "2026-04-23"),

  // ── Ruko No. 7 — Lt. 1 (dari laporan Apr 30) ──
  U("AC-12", "Ruko 7 - Lt.1 Pintu Masuk",           "Haier", "split", 1,    "SU-09GT003",      "2026-04-30"),
  U("AC-13", "Ruko 7 - Lt.1 Ruang Meeting",         "Gree",  "split", 1,    "GWC-09N1/I",     "2026-04-30"),

  // ── Ruko No. 8–9 — Lt. 1 Ruang Paking (dari laporan Apr 30) ──
  U("AC-14", "Ruko 8-9 - Lt.1 Ruang Paking Tengah", "Haier", "split", 1,    "SU-09GT003",      "2026-04-30"),
  U("AC-15", "Ruko 8-9 - Lt.1 Ruang Paking Kiri",   "Haier", "split", 1,    "SU-09GT003",      "2026-04-30"),
  U("AC-16", "Ruko 8-9 - Lt.1 Ruang Paking Depan",  "Gree",  "split", 2,    "GWC-18N1/I",     "2026-04-30"),
  U("AC-17", "Ruko 8-9 - Lt.1 Paking Depan Pintu",  "Gree",  "split", 2,    "GWC-18N1/I",     "2026-04-30"),

  // ── Ruko No. 21 — Lt. 2 Live Streaming (dari laporan Apr 30) ──
  U("AC-18", "Ruko 21 - Lt.2 Ruang Live Streaming", "Gree",  "split", 1,    "GWC-09M005A/I",  "2026-04-30"),
  U("AC-19", "Ruko 21 - Lt.2 Ruang Live Streaming", "Gree",  "split", 0.75, "GWC-07M005A/I",  "2026-04-30"),

  // ── Install Mei 2026 (dari laporan May 26) ──
  U("AC-20", "Ruko New Jasmine - Install Mei 2026",  "Gree",  "split", 2,    null,              "2026-05-26", "active", "Unit baru install Mei 2026 - lokasi perlu konfirmasi"),
  U("AC-21", "Ruko New Jasmine - Install Mei 2026",  "Gree",  "split", 0.5,  null,              "2026-05-26", "active", "Unit baru install Mei 2026 - lokasi perlu konfirmasi"),

  // ── 2 unit install tambahan (order 4 unit, laporan hanya 2) ──
  U("AC-22", "Ruko New Jasmine - Perlu Konfirmasi",  null,    "split", null, null,              "2026-05-26", "active", "Unit install Mei 2026 - data tidak tersedia dari laporan"),
  U("AC-23", "Ruko New Jasmine - Perlu Konfirmasi",  null,    "split", null, null,              "2026-05-26", "active", "Unit install Mei 2026 - data tidak tersedia dari laporan"),
];

const insUnits = await fetch(REST("maintenance_units"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(units) });
const savedUnits = await insUnits.json();
if (!Array.isArray(savedUnits)) { console.error("Gagal insert units:", savedUnits); process.exit(1); }

// ── Maintenance logs: 1 log per unit (cleaning/install terakhir) ──
const jobMap = {
  "2026-04-23": "JOB-AWZPOO-2YS",
  "2026-04-27": "JOB-GL2U07-X58",
  "2026-04-30": "JOB-KU8M2V-2NJ",
  "2026-05-26": "WA-1779759599328",
};
const techMap = {
  "2026-04-23": "Ade",
  "2026-04-27": "Ade",
  "2026-04-30": "Ade",
  "2026-05-26": "Ade",
};

const logs = savedUnits.filter(u => u.last_service_date).map((u) => {
  const svc = u.last_service_date;
  const isInstall = svc === "2026-05-26";
  const noData = u.notes?.includes("tidak tersedia");
  return {
    unit_id: u.id,
    client_id: client.id,
    service_date: svc,
    service_type: isInstall ? "Pasang" : "Cuci",
    technician: techMap[svc] || "Ade",
    description: noData
      ? "Unit install Mei 2026. Data detail tidak tersedia dari laporan — perlu konfirmasi lokasi dan spesifikasi."
      : isInstall
        ? `Pasang unit baru ${u.brand || "Gree"} ${u.capacity_pk || ""}PK. Lokasi perlu dikonfirmasi.`
        : `Cuci indoor + outdoor. Order: ${jobMap[svc] || "-"}.`,
    materials: [],
    order_id: jobMap[svc] || null,
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
  address: client.address,
  pic_phone: client.pic_phone,
  units_inserted: savedUnits.length,
  logs_inserted: Array.isArray(savedLogs) ? savedLogs.length : 0,
  token,
  portal_url: `${base}/m/${token}`,
}, null, 2));
