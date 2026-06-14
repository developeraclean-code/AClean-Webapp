// Logika murni untuk potong stok dari Material Harian (Opsi A: confirm-gated deduct).
// terpakai per UNIT = dibawa (pagi) − sisa (pulang), dihitung per unit_id (tabung/roll).
// Dipakai saat Owner/Admin confirm di dashboard. Lihat materials harian flow + migrasi 088.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Ambil daftar unit dari satu item checkout (pipa/kabel/freon) → [{unit_id, qty, ...meta}].
function unitEntries(item) {
  if (!item || !item.material_type) return [];
  const cat = item.material_type;
  let arr;
  if (Array.isArray(item.units)) arr = item.units.map((u) => ({ unit_id: u.unit_id || null, qty: Number(u.qty) || 0 }));
  else if (cat === "freon" && Array.isArray(item.weight_kg)) arr = item.weight_kg.map((u) => ({ unit_id: u.unit_id || null, qty: Number(u.kg) || 0 }));
  else arr = [{ unit_id: null, qty: Number(item.qty) || 0 }];  // legacy: agregat tanpa unit
  return arr.map((u) => ({ unit_id: u.unit_id, qty: u.qty, inventory_code: item.inventory_code || null, label: item.label || cat, material_type: cat }));
}

const keyOf = (e) => (e.unit_id ? "u:" + e.unit_id : "c:" + (e.inventory_code || e.label));

// computeDayDeduct(pagiItems, pulangItems) → baris deduct per unit:
//   [{unit_id, inventory_code, label, material_type, brought, returned, used}]
// used = max(0, brought − returned). Unit yang dibawa tapi tak ada di pulang → returned 0 (used = penuh).
export function computeDayDeduct(pagiItems, pulangItems) {
  const brought = new Map();
  const meta = new Map();
  for (const it of (Array.isArray(pagiItems) ? pagiItems : [])) {
    for (const e of unitEntries(it)) {
      const k = keyOf(e);
      brought.set(k, (brought.get(k) || 0) + e.qty);
      if (!meta.has(k)) meta.set(k, { unit_id: e.unit_id, inventory_code: e.inventory_code, label: e.label, material_type: e.material_type });
    }
  }
  const returned = new Map();
  for (const it of (Array.isArray(pulangItems) ? pulangItems : [])) {
    for (const e of unitEntries(it)) {
      const k = keyOf(e);
      returned.set(k, (returned.get(k) || 0) + e.qty);
    }
  }
  const out = [];
  for (const [k, b] of brought) {
    const r = returned.get(k) || 0;
    const used = round2(b - r);
    out.push({ ...meta.get(k), brought: round2(b), returned: round2(r), used: used > 0 ? used : 0 });
  }
  return out;
}

// Hanya baris yang benar-benar terpakai (used > 0) — yang perlu dipotong dari stok.
export function deductLines(pagiItems, pulangItems) {
  return computeDayDeduct(pagiItems, pulangItems).filter((l) => l.used > 0);
}

// Total terpakai per inventory_code (utk ringkasan).
export function usedByCode(pagiItems, pulangItems) {
  const m = {};
  for (const l of computeDayDeduct(pagiItems, pulangItems)) {
    if (l.used <= 0) continue;
    const c = l.inventory_code || l.label;
    m[c] = round2((m[c] || 0) + l.used);
  }
  return m;
}
