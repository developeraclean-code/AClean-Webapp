// Seed data ASLI: PT. Transmarco - Karawaci Office Park (22 unit AC).
// PK & freon dikosongkan (diisi saat survey). Token portal aktif.
import { readFileSync } from "node:fs";
const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const SU = env.SUPABASE_URL || env.VITE_SUPABASE_URL, SK = env.SUPABASE_SERVICE_KEY;
const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const REST = (p) => `${SU}/rest/v1/${p}`;
const token = "mtk_" + Array.from({ length: 40 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

// cegah duplikat: hapus klien lama dgn nama sama (kalau ada) sebelum seed ulang
await fetch(REST("maintenance_clients?name=eq." + encodeURIComponent("PT. Transmarco - Karawaci Office Park")), { method: "DELETE", headers: H });

const client = (await (await fetch(REST("maintenance_clients"), {
  method: "POST", headers: { ...H, Prefer: "return=representation" },
  body: JSON.stringify({
    name: "PT. Transmarco - Karawaci Office Park",
    address: "Ruko Pinangsia Blok B No. 30-31, Kel. Panunggangan Barat, Kec. Cibodas, Kota Tangerang 15138",
    pic_name: "Ibu Anis",
    pic_phone: "6281776314737",
    portal_token: token,
    token_active: true,
    hide_costs: true,
    contract_status: "active",
  }),
})).json())[0];

const U = (code, location, brand, ac_type, notes = null) => ({ client_id: client.id, unit_code: code, location, brand, ac_type, status: "active", notes });
const units = [
  U("AC-31", "Lt. 1 - Ruang Bu Tina", "Panasonic", "split"),
  U("AC-30", "Lt. 1 - Meeting Room 1", "Panasonic", "split"),
  U("AC-33", "Lt. 1 - Meeting Room 2", "Gree", "split"),
  U("AC-27", "Lt. 1 - Ruang Purchasing & IC", "Daikin", "cassette"),
  U("AC-28", "Lt. 1 - Lobby", "Daikin", "cassette"),
  U("AC-29", "Lt. 3 - Server", "Gree", "split"),
  U("AC-32", "Lt. 3 - Zoom Room / Musholla", "Gree", "split"),
  U("AC-22", "Lt. 3 - R. IT", "Daikin", "cassette"),
  U("AC-21", "Lt. 3 - R. PMO", "Daikin", "cassette"),
  U("AC-20", "Lt. 3 - R. HOD", "Daikin", "cassette"),
  U("AC-19", "Lt. 3 - R. HOD", "Daikin", "cassette"),
  U("AC-35", "Lt. 3 - R. Server (New)", "Gree", "split", "Unit baru"),
  U("AC-24", "Lt. 2 - Ruang FAT", "Daikin", "cassette"),
  U("AC-23", "Lt. 2 - Ruang FAT", "Daikin", "cassette"),
  U("AC-26", "Lt. 2 - Ruang FAT", "Daikin", "cassette"),
  U("AC-25", "Lt. 2 - Zoom Room / Musholla", "Gree", "split"),
  U("AC-13", "Lt. 4 - Pantry", "Gree", "split"),
  U("AC-17", "Lt. 4 - R. Live", "Gree", "split"),
  U("AC-16", "Lt. 4 - Ecomm", "Daikin", "cassette"),
  U("AC-15", "Lt. 4 - Ecomm", "Daikin", "cassette"),
  U("AC-14", "Lt. 4 - Ecomm", "Gree", "split"),
  U("AC-18", "Lt. 4 - R. Zoom", "Gree", "split"),
];
const ins = await fetch(REST("maintenance_units"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(units) });
const saved = await ins.json();

// portal base url dari app_settings (fallback status.aclean.id)
let base = "https://status.aclean.id";
try { const s = await (await fetch(REST("app_settings?key=eq.customer_portal_url&select=value"), { headers: H })).json(); if (s[0]?.value) base = s[0].value.replace(/\/$/, ""); } catch {}

console.log(JSON.stringify({
  client_id: client.id,
  client_name: client.name,
  units_inserted: Array.isArray(saved) ? saved.length : 0,
  token,
  portal_url: `${base}/m/${token}`,
}, null, 2));
