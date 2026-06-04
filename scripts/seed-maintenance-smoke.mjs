// Seed 1 klien maintenance + unit + log untuk smoke-test UI. Print token+id.
import { readFileSync } from "node:fs";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SU = env.SUPABASE_URL || env.VITE_SUPABASE_URL, SK = env.SUPABASE_SERVICE_KEY;
const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const REST = (p) => `${SU}/rest/v1/${p}`;
const token = "mtk_" + Array.from({ length: 40 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

const c = (await (await fetch(REST("maintenance_clients"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ name: "SMOKE PT Menara Test", pic_name: "Budi Santoso", pic_phone: "6281200000000", address: "Jl. Test No. 1", portal_token: token, token_active: true, hide_costs: false }) })).json())[0];

const units = [
  { unit_code: "AC-001", location: "Lobby", brand: "Daikin", ac_type: "split", capacity_pk: 1, refrigerant: "R32", status: "active" },
  { unit_code: "AC-002", location: "Lantai 2 - Meeting", brand: "Gree", ac_type: "cassette", capacity_pk: 2, refrigerant: "R410A", status: "active" },
  { unit_code: "AC-003", location: "Genset", brand: "LG", ac_type: "standing", capacity_pk: 3, refrigerant: "R22", status: "rusak" },
];
const uIds = [];
for (const u of units) uIds.push((await (await fetch(REST("maintenance_units"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ ...u, client_id: c.id }) })).json())[0].id);

const logs = [
  { unit_id: uIds[0], service_date: "2026-02-20", service_type: "Cuci Rutin", technician: "Andi", cost: 150000, description: "Cuci indoor+outdoor, tekanan freon normal." },
  { unit_id: uIds[0], service_date: "2026-05-12", service_type: "Isi Freon", technician: "Andi", cost: 325000, description: "Top-up R32 0.4kg." },
  { unit_id: uIds[2], service_date: "2026-06-01", service_type: "Perbaikan", technician: "Rizal", cost: 0, description: "PCB indoor error E5, tunggu sparepart." },
];
for (const l of logs) await fetch(REST("maintenance_logs"), { method: "POST", headers: H, body: JSON.stringify({ ...l, client_id: c.id }) });

console.log(JSON.stringify({ token, client_id: c.id }));
