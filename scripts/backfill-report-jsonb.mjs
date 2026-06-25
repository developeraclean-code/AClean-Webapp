// One-time backfill (idempotent): service_reports.units / materials_used (jsonb)
// ← units_json / materials_json (text). Report lama (≤ ~April) hanya menyimpan data di
// kolom TEXT; kolom jsonb kosong. Backfill ini menyalin ke jsonb supaya kolom TEXT bisa
// dibuang dari fetch startup (lihat src/data/reads.js fetchServiceReports) tanpa kehilangan data.
//
// Jalankan: node --env-file=.env.local scripts/backfill-report-jsonb.mjs
// Aman diulang — hanya menyentuh row yang jsonb-nya masih kosong tapi text-nya ada.
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const isEmpty = (v) => v == null || (Array.isArray(v) && v.length === 0);
const parseArr = (s) => { try { const p = JSON.parse(s); return Array.isArray(p) ? p : null; } catch { return null; } };

// Fetch semua row (paginate, lewati cap 1000 PostgREST)
let all = [], from = 0;
while (true) {
  const { data, error } = await sb.from("service_reports")
    .select("id,units,units_json,materials_used,materials_json")
    .order("submitted_at", { ascending: true }).range(from, from + 999);
  if (error) { console.error("FETCH ERR", error.message); process.exit(1); }
  all = all.concat(data);
  if (data.length < 1000) break;
  from += 1000;
}

let updated = 0, failed = 0;
for (const r of all) {
  const patch = {};
  if (isEmpty(r.units) && typeof r.units_json === "string") { const a = parseArr(r.units_json); if (a && a.length) patch.units = a; }
  if (isEmpty(r.materials_used) && typeof r.materials_json === "string") { const a = parseArr(r.materials_json); if (a && a.length) patch.materials_used = a; }
  if (Object.keys(patch).length) {
    const { error } = await sb.from("service_reports").update(patch).eq("id", r.id);
    if (error) { failed++; console.warn("  upd err", r.id, error.message); } else updated++;
  }
}
console.log(`scan ${all.length} rows → updated ${updated}, failed ${failed}`);
process.exit(failed ? 1 : 0);
