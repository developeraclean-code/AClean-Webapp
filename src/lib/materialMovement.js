// Per-job material movement (Bawa/Pulang) — pure logic. Pipa & Kabel.
// used = bawa - pulang (pemakaian fisik per job). Cross-check vs pemakaian dilaporkan (laporan job).
// FASE 1: hanya hitung & tampilkan selisih (tidak deduct). Lihat materialMovement.test.js.

const TOL = { pipa: 1.0, kabel: 1.0 };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function computeUsed(qtyBawa, qtyPulang) {
  if (qtyPulang == null || qtyPulang === "") return null; // pulang belum diisi
  return r2((Number(qtyBawa) || 0) - (Number(qtyPulang) || 0));
}

// Gabung baris Bawa & Pulang (preset) per (category+inventory_code).
// bawaItems/pulangItems: [{category, inventory_code, type_label, qty}]
export function buildMovementRows(bawaItems, pulangItems) {
  const map = new Map();
  const key = (it) => it.category + "|" + it.inventory_code;
  for (const it of (bawaItems || [])) {
    if (!it || !it.inventory_code) continue;
    map.set(key(it), { category: it.category, inventory_code: it.inventory_code, type_label: it.type_label || "", qty_bawa: r2(it.qty), qty_pulang: null });
  }
  for (const it of (pulangItems || [])) {
    if (!it || !it.inventory_code) continue;
    const k = key(it);
    if (!map.has(k)) map.set(k, { category: it.category, inventory_code: it.inventory_code, type_label: it.type_label || "", qty_bawa: 0, qty_pulang: null });
    map.get(k).qty_pulang = r2(it.qty);
  }
  return [...map.values()].map(row => ({ ...row, qty_used: computeUsed(row.qty_bawa, row.qty_pulang) }));
}

// Cross-check: used (fisik) vs reported (laporan, by inventory_code).
// reportedByCode: { SKU022: 18, ... } (meter). tolerances per category.
// flag: PENDING_PULANG (belum pulang) | OK | OVER (used>reported) | UNDER (used<reported)
export function reconcileMovement(rows, reportedByCode = {}, tolerances = TOL) {
  const tol = tolerances || TOL;
  return (rows || []).map(row => {
    const reported = r2(reportedByCode[row.inventory_code] || 0);
    if (row.qty_used == null) {
      return { ...row, used: null, reported, selisih: null, tolerance: tol[row.category] ?? 1, flag: "PENDING_PULANG" };
    }
    const used = r2(row.qty_used);
    const selisih = r2(used - reported);
    const t = tol[row.category] != null ? tol[row.category] : 1;
    let flag = "OK";
    if (Math.abs(selisih) > t) flag = selisih > 0 ? "OVER" : "UNDER";
    return { ...row, used, reported, selisih, tolerance: t, flag };
  });
}

export function movementStatus(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  if (arr.some(l => l.flag === "OVER" || l.flag === "UNDER")) return "FLAGGED";
  if (arr.some(l => l.flag === "PENDING_PULANG")) return "PENDING";
  return "OK";
}
