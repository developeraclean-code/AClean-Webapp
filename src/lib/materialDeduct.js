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

// ── Koreksi admin atas hasil bawa−sisa ──────────────────────────────────────
// Angka "terpakai" dihitung otomatis dari selisih bawa−sisa yang dilaporkan
// teknisi. Kadang laporannya meleset (sisa salah ukur / lupa dicatat), jadi
// Admin/Owner boleh mengoreksi sebelum stok dipotong — dengan jejak audit.
// Lihat MaterialConfirmTab + migrasi 146 (kolom admin_adjustments).

export const lineKey = (l) => (l?.unit_id ? "u:" + l.unit_id : "c:" + (l?.inventory_code || l?.label));

// Batas aman: tidak boleh minus, dan tidak boleh melebihi yang dibawa —
// mustahil memakai lebih banyak dari isi roll/tabung yang dibawa hari itu.
export function clampUsed(nilai, brought) {
  const n = Number(nilai);
  if (!Number.isFinite(n) || n < 0) return 0;
  const maks = Number(brought);
  if (Number.isFinite(maks) && maks >= 0 && n > maks) return round2(maks);
  return round2(n);
}

// Terapkan koreksi admin ke baris hasil computeDayDeduct.
// overrides = { [lineKey]: qtyTerpakaiBaru }
// → { lines, changes } — changes hanya berisi baris yang benar-benar berubah,
//   dipakai untuk catatan audit & isi kolom admin_adjustments.
export function applyAdminOverrides(baseLines, overrides) {
  const ov = overrides || {};
  const changes = [];
  const lines = (Array.isArray(baseLines) ? baseLines : []).map((l) => {
    const k = lineKey(l);
    if (!Object.prototype.hasOwnProperty.call(ov, k)) return l;
    const semula = round2(l.used);
    const jadi = clampUsed(ov[k], l.brought);
    if (jadi === semula) return l;
    changes.push({
      key: k, unit_id: l.unit_id || null, label: l.label,
      inventory_code: l.inventory_code || null,
      brought: round2(l.brought), returned: round2(l.returned),
      dari: semula, jadi,
    });
    return { ...l, used: jadi, used_asli: semula, dikoreksi: true };
  });
  return { lines, changes };
}

// ── Pembalikan potongan stok (buka koreksi sesi yang sudah dikonfirmasi) ─────
// Owner/Admin perlu bisa membuka sesi beberapa hari lalu untuk membetulkan qty
// aktual & pembagian jobnya. Alih-alih menyunting transaksi lama (yang merusak
// jejak), potongannya DIBALIK dengan transaksi lawan bertipe 'adjustment', lalu
// sesinya kembali PENDING sehingga admin mengonfirmasi ulang lewat jalur normal.
// Pola yang sama dipakai saat laporan dihapus (LaporanTimView) — sudah terbukti.
export function buildReversalRow(tx, { oleh, alasan } = {}) {
  if (!tx) return null;
  const qty = Math.abs(Number(tx.qty) || 0);
  if (!(qty > 0)) return null;
  return {
    inventory_code: tx.inventory_code,
    inventory_name: tx.inventory_name,
    order_id: tx.order_id || null,
    report_id: tx.report_id || null,
    unit_id: tx.unit_id || null,
    unit_label: tx.unit_label || null,
    qty,
    qty_actual: Math.abs(Number(tx.qty_actual ?? tx.qty) || 0),
    type: "adjustment",
    teknisi_name: tx.teknisi_name || null,
    customer_name: tx.customer_name || null,
    job_date: tx.job_date || null,
    notes: `Buka koreksi Material Harian — stok dikembalikan${oleh ? " oleh " + oleh : ""}${alasan ? " (" + alasan + ")" : ""}`,
    created_by_name: oleh || "",
  };
}

// Berapa yang harus dikembalikan ke tiap unit fisik (tabung/roll) saat dibalik.
// → { [unit_id]: qty }
export function reversalByUnit(txs) {
  const m = {};
  for (const tx of (txs || [])) {
    if (!tx?.unit_id) continue;
    const qty = Math.abs(Number(tx.qty) || 0);
    if (!(qty > 0)) continue;
    m[tx.unit_id] = round2((m[tx.unit_id] || 0) + qty);
  }
  return m;
}
