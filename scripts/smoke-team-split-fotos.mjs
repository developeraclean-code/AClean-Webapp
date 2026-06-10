// Smoke test — Team-split order (maintenance PT ramai) + foto per-unit di laporan.
// Simulasi: 1 project PT 30 unit dipecah jadi N tim → tiap tim 1 sub-order + 1 laporan,
// tiap laporan punya foto yang di-tag per unit (unit_no). Lalu verifikasi:
//   1. Team-split: N sub-order, job_group_id konsisten, parent id===job_group_id, Σunits=30.
//   2. fotos jsonb round-trip di service_reports (unit_no, label, url) — anti silent drop.
//   3. foto_urls tetap paralel (backward-compat).
//   4. Invoice grouping: replikasi groupKey logic App.jsx → tepat 1 invoice per project.
//   5. PDF grouping (buildServiceReportHTML) → semua foto tergrup, tak ada yang hilang.
//   6. Portal grouping (CustomerPortalView.fotoGroups) → konsisten dgn PDF.
//   7. Edge: foto unit_no=null (umum), unit_no di luar range, laporan tanpa foto.
// Cleanup otomatis. Jalankan: node scripts/smoke-team-split-fotos.mjs
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SU = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SK = env.SUPABASE_SERVICE_KEY;
if (!SU || !SK) { console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY tidak ada di .env.local"); process.exit(1); }
const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const REST = (p) => `${SU}/rest/v1/${p}`;

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n + (extra ? "  → " + extra : "")); } };
const RUN = "SMOKE_TS_" + Date.now().toString(36).toUpperCase();

// ───────── Replikasi PERSIS hitungDurasi/jamSelesai (App.jsx) ─────────
function hitungDurasi(service, units) {
  const u = parseInt(units) || 1;
  if (service === "Install") return Math.min(u * 2.5, 8);
  if (service === "Repair") return Math.ceil(u * 1.5);
  if (service === "Complain") return Math.max(0.5, u * 0.5);
  if (u === 1) return 1; if (u === 2) return 2; if (u === 3) return 3; if (u === 4) return 3;
  if (u <= 6) return 4; if (u <= 8) return 5; if (u <= 10) return 6; return 8;
}
const toMin = (t) => { const [h, m] = (t || "09:00").split(":").map(Number); return h * 60 + m; };
function addJam(timeStr, jamTambah) {
  const total = toMin(timeStr) + Math.round(jamTambah * 60);
  const nh = Math.floor(total / 60), nm = total % 60;
  if (nh >= 17) return "17:00";
  return String(nh).padStart(2, "0") + ":" + String(nm).padStart(2, "0");
}
const hitungJamSelesai = (t, s, u) => addJam(t, Math.min(hitungDurasi(s, u), 8));

// ───────── Replikasi PERSIS PDF grouping (App.jsx buildServiceReportHTML) ─────────
function pdfGroups(laporan) {
  const fotos = (laporan.foto_urls || []).filter(Boolean);
  const fotoMeta = Array.isArray(laporan.fotos) ? laporan.fotos.filter(m => m && m.url) : [];
  const hasUnitTags = fotoMeta.some(m => m.unit_no);
  if (!hasUnitTags) return [{ key: "_flat", urls: fotos }];
  const byUnit = {};
  fotoMeta.forEach(m => { const k = m.unit_no ? String(m.unit_no) : "_umum"; (byUnit[k] = byUnit[k] || []).push(m.url); });
  const tagged = new Set(fotoMeta.map(m => m.url));
  fotos.forEach(url => { if (!tagged.has(url)) (byUnit["_umum"] = byUnit["_umum"] || []).push(url); });
  const unitKeys = Object.keys(byUnit).filter(k => k !== "_umum").sort((a, b) => Number(a) - Number(b));
  return [...unitKeys.map(k => ({ key: k, urls: byUnit[k] })), ...(byUnit["_umum"] ? [{ key: "_umum", urls: byUnit["_umum"] }] : [])];
}

// ───────── Replikasi PERSIS portal grouping (CustomerPortalView.fotoGroups) ─────────
function portalGroups(report) {
  const fotoList = Array.isArray(report?.foto_urls) ? report.foto_urls.filter(Boolean) : [];
  let fotoMeta = []; try { const m = typeof report?.fotos === "string" ? JSON.parse(report.fotos) : report?.fotos; fotoMeta = Array.isArray(m) ? m.filter(x => x && x.url) : []; } catch { fotoMeta = []; }
  const fotoHasUnitTags = fotoMeta.some(m => m.unit_no);
  if (!fotoHasUnitTags) return null;
  const by = {};
  fotoMeta.forEach(m => { const k = m.unit_no ? String(m.unit_no) : "_umum"; (by[k] = by[k] || []).push(m.url); });
  const tagged = new Set(fotoMeta.map(m => m.url));
  fotoList.forEach(url => { if (!tagged.has(url)) (by["_umum"] = by["_umum"] || []).push(url); });
  const keys = Object.keys(by).filter(k => k !== "_umum").sort((a, b) => Number(a) - Number(b));
  return [...keys.map(k => ({ key: k, urls: by[k] })), ...(by["_umum"] ? [{ key: "_umum", urls: by["_umum"] }] : [])];
}

// ───────── Replikasi PERSIS invoice groupKey logic (App.jsx verifikasi laporan) ─────────
function decideInvoice(laporan, existingInvoices) {
  const isMultiDayChild = !!laporan.parent_job_id && laporan.is_multi_day === true;
  const isTeamSplit = !!laporan.is_team_split && !!laporan.job_group_id;
  const groupKey = isMultiDayChild ? laporan.parent_job_id : isTeamSplit ? laporan.job_group_id : null;
  const parentInvoice = groupKey ? existingInvoices.find(i => i.job_id === groupKey) : null;
  if (groupKey && parentInvoice && !["CANCELLED", "PAID"].includes(parentInvoice.status)) return { action: "skip", groupKey };
  const job_id = isMultiDayChild ? laporan.parent_job_id : (isTeamSplit && laporan.job_group_id) ? laporan.job_group_id : laporan.id;
  return { action: "create", job_id };
}

// ───────── State untuk cleanup ─────────
const createdOrderIds = [];
const createdReportIds = [];
let clientId = null;
const unitIds = [];

async function rq(method, path, body) {
  const r = await fetch(REST(path), { method, headers: { ...H, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
  return { ok: r.ok, status: r.status, json };
}

async function cleanup() {
  console.log("\n🧹 Cleanup…");
  for (const id of createdReportIds) await rq("DELETE", `service_reports?id=eq.${encodeURIComponent(id)}`);
  for (const id of createdOrderIds) await rq("DELETE", `orders?id=eq.${encodeURIComponent(id)}`);
  if (unitIds.length) await rq("DELETE", `maintenance_units?id=in.(${unitIds.join(",")})`);
  if (clientId) await rq("DELETE", `maintenance_clients?id=eq.${clientId}`);
  console.log("   selesai.");
}

async function main() {
  console.log(`\n🔬 SMOKE TEAM-SPLIT + FOTO PER-UNIT  [${RUN}]\n`);

  // ── Setup: maintenance client + 30 unit ──
  const cRes = await rq("POST", "maintenance_clients", {
    name: "SMOKE PT TeamSplit " + RUN, pic_name: "Smoke PIC", pic_phone: "6281200000099",
    address: "Jl. Smoke No. 30", contract_status: "active",
  });
  ok("Create maintenance client", cRes.ok && cRes.json?.[0]?.id, cRes.ok ? "" : JSON.stringify(cRes.json));
  clientId = cRes.json?.[0]?.id;
  if (!clientId) { await cleanup(); process.exit(1); }

  const TOTAL_UNITS = 30;
  const unitPayload = Array.from({ length: TOTAL_UNITS }, (_, i) => ({
    client_id: clientId, unit_code: `SMK-${RUN}-${String(i + 1).padStart(2, "0")}`,
    location: `Lantai ${Math.floor(i / 10) + 1}`, brand: "Daikin", ac_type: "split",
    capacity_pk: 1, refrigerant: "R32", status: "active",
  }));
  const uRes = await rq("POST", "maintenance_units", unitPayload);
  ok("Seed 30 unit", uRes.ok && uRes.json?.length === 30, uRes.ok ? `got ${uRes.json?.length}` : JSON.stringify(uRes.json));
  (uRes.json || []).forEach(u => unitIds.push(u.id));

  // ── Team-split: 30 unit / 4 tim (bagi rata contiguous: 8/8/8/6) ──
  const TEAM_COUNT = 4;
  const per = Math.ceil(TOTAL_UNITS / TEAM_COUNT); // 8
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const mkId = () => "JOB-" + RUN + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const groupId = mkId();
  const teamUnitIds = [];
  for (let i = 0; i < TEAM_COUNT; i++) {
    const slice = unitIds.slice(i * per, (i + 1) * per);
    if (!slice.length) continue;
    teamUnitIds.push(slice);
    const id = i === 0 ? groupId : mkId();
    const payload = {
      id, customer: "SMOKE PT TeamSplit " + RUN, phone: "6281200000099",
      address: "Jl. Smoke No. 30", area: "Karawaci", service: "Cleaning", type: "Cleaning",
      units: slice.length, date, time: "09:00", time_end: hitungJamSelesai("09:00", "Cleaning", slice.length),
      status: "PENDING", dispatch: false, source: "maintenance",
      job_group_id: groupId, is_team_split: true,
      maintenance_client_id: clientId, maintenance_unit_ids: slice,
      notes: `Smoke Tim ${i + 1}/${TEAM_COUNT} [${RUN}]`,
    };
    const r = await rq("POST", "orders", payload);
    ok(`Buat sub-order tim ${i + 1} (${slice.length} unit)`, r.ok && r.json?.[0]?.id, r.ok ? "" : JSON.stringify(r.json));
    if (r.json?.[0]?.id) createdOrderIds.push(r.json[0].id);
  }

  // ── Verifikasi grup di DB ──
  const gRes = await rq("GET", `orders?job_group_id=eq.${encodeURIComponent(groupId)}&select=id,units,job_group_id,is_team_split,maintenance_unit_ids&order=id`);
  const grp = gRes.json || [];
  ok("Grup punya 4 sub-order", grp.length === TEAM_COUNT, `got ${grp.length}`);
  ok("Σ units = 30", grp.reduce((s, o) => s + (o.units || 0), 0) === TOTAL_UNITS, `got ${grp.reduce((s, o) => s + (o.units || 0), 0)}`);
  ok("Semua is_team_split=true", grp.every(o => o.is_team_split === true));
  ok("Parent id === job_group_id ada tepat 1", grp.filter(o => o.id === o.job_group_id).length === 1);
  ok("Tidak ada unit dobel antar tim", new Set(grp.flatMap(o => o.maintenance_unit_ids || [])).size === TOTAL_UNITS);

  // ── Multi-report: tiap tim 1 laporan, foto di-tag per unit ──
  const reports = [];
  for (let i = 0; i < grp.length; i++) {
    const order = grp[i];
    const uIds = order.maintenance_unit_ids || [];
    const nUnit = uIds.length;
    // laporanUnits unit_no = 1..nUnit (per laporan, lokal)
    const laporanUnits = Array.from({ length: nUnit }, (_, k) => ({
      unit_no: k + 1, label: `Unit ${k + 1}`, tipe: "Split 1PK", merk: "Daikin", pk: "1PK",
      pekerjaan: ["Cuci evaporator"], kondisi_sebelum: ["Kotor"], kondisi_setelah: ["Bersih"],
    }));
    // Foto: 2 foto per unit + 1 foto umum (unit_no null) → simulasi realistis
    const fotos = [];
    const fotoUrls = [];
    laporanUnits.forEach(u => {
      for (let p = 0; p < 2; p++) {
        const url = `laporan/${order.id}/unit${u.unit_no}_${p}_${RUN}.jpg`;
        fotos.push({ url, label: `Unit ${u.unit_no} foto ${p + 1}`, unit_no: u.unit_no });
        fotoUrls.push(url);
      }
    });
    // 1 foto umum
    const umumUrl = `laporan/${order.id}/umum_${RUN}.jpg`;
    fotos.push({ url: umumUrl, label: "Tampak depan gedung", unit_no: null });
    fotoUrls.push(umumUrl);

    const repId = "REP-" + RUN + "-T" + (i + 1);
    const payload = {
      id: repId, job_id: order.id, teknisi: "Smoke Teknisi " + (i + 1), customer: "SMOKE PT TeamSplit " + RUN,
      service: "Cleaning", type: "Cleaning", date, total_units: nUnit, status: "SUBMITTED",
      units: laporanUnits, units_json: JSON.stringify(laporanUnits),
      foto_urls: fotoUrls, fotos, rekomendasi: "OK", catatan_global: "",
      submitted_at: new Date().toISOString(),
    };
    const r = await rq("POST", "service_reports", payload);
    ok(`Laporan tim ${i + 1} tersimpan (${nUnit} unit, ${fotoUrls.length} foto)`, r.ok && r.json?.[0]?.id, r.ok ? "" : JSON.stringify(r.json));
    if (r.json?.[0]?.id) { createdReportIds.push(r.json[0].id); reports.push({ order, repId, nUnit, fotoUrls, fotos }); }
  }

  // ── Round-trip: baca ulang fotos jsonb dari DB ──
  for (const rep of reports) {
    const rr = await rq("GET", `service_reports?id=eq.${rep.repId}&select=id,foto_urls,fotos,units_json`);
    const row = rr.json?.[0];
    ok(`[${rep.repId}] foto_urls round-trip (${rep.fotoUrls.length})`, row && (row.foto_urls || []).length === rep.fotoUrls.length, `got ${(row?.foto_urls || []).length}`);
    ok(`[${rep.repId}] fotos jsonb round-trip (${rep.fotos.length})`, row && Array.isArray(row.fotos) && row.fotos.length === rep.fotos.length, `got ${Array.isArray(row?.fotos) ? row.fotos.length : typeof row?.fotos}`);
    const taggedCount = (row?.fotos || []).filter(f => f.unit_no).length;
    ok(`[${rep.repId}] unit_no terjaga (${rep.nUnit * 2} foto bertag)`, taggedCount === rep.nUnit * 2, `got ${taggedCount}`);
    const umumCount = (row?.fotos || []).filter(f => f.unit_no == null).length;
    ok(`[${rep.repId}] 1 foto umum (unit_no null)`, umumCount === 1, `got ${umumCount}`);
    // Tidak ada foto yang kehilangan url
    ok(`[${rep.repId}] semua fotos punya url`, (row?.fotos || []).every(f => f.url));

    // PDF grouping
    const g = pdfGroups({ foto_urls: row.foto_urls, fotos: row.fotos });
    const totalInGroups = g.reduce((s, x) => s + x.urls.length, 0);
    ok(`[${rep.repId}] PDF: semua foto tergrup (${rep.fotoUrls.length})`, totalInGroups === rep.fotoUrls.length, `got ${totalInGroups}`);
    ok(`[${rep.repId}] PDF: ${rep.nUnit} grup unit + 1 umum`, g.filter(x => x.key !== "_umum").length === rep.nUnit && g.some(x => x.key === "_umum"), `groups=${g.map(x => x.key).join(",")}`);
    ok(`[${rep.repId}] PDF: tiap grup unit 2 foto`, g.filter(x => x.key !== "_umum").every(x => x.urls.length === 2));

    // Portal grouping konsisten (fotos sbg string JSON, simulasi PostgREST kadang balikin objek)
    const pg = portalGroups({ foto_urls: row.foto_urls, fotos: row.fotos });
    ok(`[${rep.repId}] Portal grouping = PDF grouping`, pg && pg.length === g.length && pg.reduce((s, x) => s + x.urls.length, 0) === totalInGroups);
  }

  // ── Invoice grouping: simulasi verifikasi 4 laporan berurutan ──
  // Setiap laporan bawa flag grup dari order-nya.
  let invoices = [];
  const decisions = [];
  for (let i = 0; i < reports.length; i++) {
    const order = reports[i].order;
    const laporan = { id: reports[i].repId, is_team_split: true, job_group_id: order.job_group_id, parent_job_id: null, is_multi_day: false };
    const d = decideInvoice(laporan, invoices);
    decisions.push(d);
    if (d.action === "create") invoices.push({ id: "INV-" + reports[i].repId, job_id: d.job_id, status: "UNPAID" });
  }
  ok("Invoice: tepat 1 dibuat untuk seluruh project", invoices.length === 1, `got ${invoices.length}`);
  ok("Invoice: job_id = job_group_id", invoices[0]?.job_id === groupId, `got ${invoices[0]?.job_id}`);
  ok("Invoice: 1 create + 3 skip", decisions.filter(d => d.action === "create").length === 1 && decisions.filter(d => d.action === "skip").length === 3,
    decisions.map(d => d.action).join(","));

  // ── Edge: laporan verifikasi urutan acak (tim 3 duluan) tetap 1 invoice ──
  let invoices2 = [];
  const order123 = [2, 0, 3, 1];
  for (const idx of order123) {
    const order = reports[idx].order;
    const laporan = { id: reports[idx].repId, is_team_split: true, job_group_id: order.job_group_id };
    const d = decideInvoice(laporan, invoices2);
    if (d.action === "create") invoices2.push({ id: "INV2-" + idx, job_id: d.job_id, status: "UNPAID" });
  }
  ok("Invoice: urutan verifikasi acak tetap 1 invoice", invoices2.length === 1, `got ${invoices2.length}`);
  ok("Invoice: tetap job_id=job_group_id meski child duluan", invoices2[0]?.job_id === groupId, `got ${invoices2[0]?.job_id}`);

  // ── Edge: laporan tanpa foto & foto semua umum ──
  const noFoto = pdfGroups({ foto_urls: [], fotos: [] });
  ok("Edge: laporan tanpa foto → 0 grup foto", noFoto.length === 1 && noFoto[0].urls.length === 0);
  const allUmum = pdfGroups({ foto_urls: ["a.jpg", "b.jpg"], fotos: [{ url: "a.jpg", unit_no: null }, { url: "b.jpg", unit_no: null }] });
  ok("Edge: semua foto umum (tanpa tag) → fallback datar", allUmum.length === 1 && allUmum[0].key === "_flat" && allUmum[0].urls.length === 2);
  const mixUntagged = pdfGroups({ foto_urls: ["a.jpg", "b.jpg", "c.jpg"], fotos: [{ url: "a.jpg", unit_no: 1 }, { url: "b.jpg", unit_no: null }] });
  // c.jpg ada di foto_urls tapi tidak di fotos meta → harus masuk _umum (safety)
  const cInUmum = mixUntagged.find(x => x.key === "_umum")?.urls.includes("c.jpg");
  ok("Edge: foto_urls tanpa meta → masuk grup umum (tak hilang)", !!cInUmum, JSON.stringify(mixUntagged));

  // ── Edge: hapus unit di tengah → remap tag foto (replikasi handler delete unit) ──
  const remap = (fotos, deletedNo) => fotos.map(f => {
    if (f.unit_no == null) return f;
    if (f.unit_no === deletedNo) return { ...f, unit_no: null };
    if (f.unit_no > deletedNo) return { ...f, unit_no: f.unit_no - 1 };
    return f;
  });
  const before = [{ url: "u1.jpg", unit_no: 1 }, { url: "u2.jpg", unit_no: 2 }, { url: "u3.jpg", unit_no: 3 }, { url: "um.jpg", unit_no: null }];
  const after = remap(before, 2); // hapus unit 2
  ok("Remap: foto unit terhapus → umum (null)", after.find(f => f.url === "u2.jpg").unit_no === null);
  ok("Remap: foto unit di atasnya geser turun (3→2)", after.find(f => f.url === "u3.jpg").unit_no === 2);
  ok("Remap: foto unit di bawahnya tetap (1)", after.find(f => f.url === "u1.jpg").unit_no === 1);
  ok("Remap: foto umum tetap null", after.find(f => f.url === "um.jpg").unit_no === null);

  console.log(`\n────────────────────────\n  PASS: ${pass}   FAIL: ${fail}\n────────────────────────`);
}

main().catch(e => { console.error("\n💥 ERROR:", e.message); fail++; }).finally(async () => {
  await cleanup();
  process.exit(fail > 0 ? 1 : 0);
});
