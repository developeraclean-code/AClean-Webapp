// Logika murni untuk "Alat Kantor" (office tools) — registry + log gerak Bawa/Kembali.
// Alat NON-consumable: tidak memotong stok. Yang dilacak = jumlah keluar vs tersedia,
// siapa pemegang, ke job mana. Lihat migrations/086_office_tools.sql.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Movement yang masih dibawa (belum dikembalikan).
export function isOut(m) {
  return (m?.status || "OUT") === "OUT";
}

// Ringkasan satu alat: total dimiliki, sedang keluar, tersedia, + daftar pemegang aktif.
export function toolStatus(tool, movements = []) {
  const total = num(tool?.qty);
  const mine = movements.filter((m) => m.tool_id === tool?.id);
  const outMoves = mine.filter(isOut);
  const out = outMoves.reduce((s, m) => s + num(m.qty), 0);
  const available = Math.max(0, total - out);
  const holders = outMoves.map((m) => ({
    movementId: m.id, carriedBy: m.carried_by || "", qty: num(m.qty),
    scope: m.scope || "order", refId: m.ref_id || "", refLabel: m.ref_label || "",
    checkoutAt: m.checkout_at || null,
  }));
  return { total, out, available, holders };
}

// Map { toolId → status } untuk seluruh registry sekali jalan.
export function summarizeTools(tools = [], movements = []) {
  const map = {};
  for (const t of tools) map[t.id] = toolStatus(t, movements);
  return map;
}

// Apakah qty bisa di-checkout dari alat ini (tidak melebihi tersedia).
export function canCheckout(tool, movements, qty) {
  const q = num(qty);
  if (q <= 0) return false;
  return q <= toolStatus(tool, movements).available;
}

// Movement aktif (OUT) untuk satu job tertentu (utk layar Kembali).
export function outMovementsForRef(movements = [], scope, refId) {
  return movements.filter((m) => isOut(m) && (m.scope || "order") === scope && String(m.ref_id) === String(refId));
}

// Movement aktif (OUT) yang sedang dipegang seorang teknisi — utk layar "Alat Saya" (daily).
export function outMovementsForCarrier(movements = [], carrierName) {
  const n = String(carrierName || "").trim().toLowerCase();
  if (!n) return [];
  return movements.filter((m) => isOut(m) && String(m.carried_by || "").trim().toLowerCase() === n);
}

// Jumlah alat (unit) yang sedang dibawa untuk satu job — utk badge tombol.
export function outCountForRef(movements = [], scope, refId) {
  return outMovementsForRef(movements, scope, refId).reduce((s, m) => s + num(m.qty), 0);
}

// Status registry global: ada alat yang masih di luar?
export function anyOut(tools = [], movements = []) {
  return tools.some((t) => toolStatus(t, movements).out > 0);
}
