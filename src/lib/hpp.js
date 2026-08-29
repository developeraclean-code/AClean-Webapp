// HPP material (harga beli per satuan dasar) — SATU sumber kebenaran perhitungan.
// Dipakai bersama oleh: panel Harga Beli (InventoryView), RestockModal, modal Tautkan Stok
// (ExpensesView), laporan MatTrack, dan autosum biaya material di modal Komisi.
//
// Beda dua kolom harga yang gampang tertukar (migrasi 153):
//   inventory.price          = harga JUAL — fallback harga material ke invoice (pricing.js:302).
//   inventory.purchase_price = harga BELI per satuan dasar (HPP) — yang dipakai file ini.
//
// Metode HPP = RATA-RATA BERGERAK tertimbang (keputusan Owner 28 Agu 2026), bukan harga
// terakhir: 1 nota kecil yang mahal tidak boleh menggeser seluruh perhitungan bonus.

export const HPP_STALE_DAYS = 90;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Pembulatan 2 desimal — HPP per meter/kg sering pecahan (900rb ÷ 30m = 30.000, tapi
// 255rb ÷ 33m = 7.727,27). Jangan dibulatkan ke rupiah utuh: error-nya menumpuk di qty besar.
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * HPP baru setelah barang masuk — rata-rata bergerak tertimbang.
 *
 *   HPP = (stok_lama × HPP_lama + qty_masuk × harga_masuk) ÷ (stok_lama + qty_masuk)
 *
 * Penjaga yang disengaja:
 *   - harga_masuk ≤ 0 (restock tanpa harga)  → HPP TIDAK berubah. Jangan pernah mencemari
 *     HPP dengan nol; itu persis bug yang membuat semua laporan biaya jadi Rp 0.
 *   - stok_lama ≤ 0 atau HPP_lama ≤ 0        → pakai harga masuk apa adanya (tidak ada
 *     bobot lama yang valid; stok minus tidak boleh jadi bobot negatif).
 */
export function movingAvgCost({ stokLama, hppLama, qtyMasuk, hargaMasuk }) {
  const qty   = num(qtyMasuk);
  const harga = num(hargaMasuk);
  const hpp   = num(hppLama);
  if (qty <= 0 || harga <= 0) return round2(hpp);

  const stok = Math.max(0, num(stokLama));
  if (stok <= 0 || hpp <= 0) return round2(harga);

  return round2((stok * hpp + qty * harga) / (stok + qty));
}

/**
 * Harga per kemasan → harga per satuan dasar. Inti keluhan Owner: pipa dibeli per ROLL,
 * freon per TABUNG, tapi dipakai per meter/kg — konversinya harus eksplisit.
 * packSize kosong/0 = barang memang dibeli satuan → harga dipakai apa adanya.
 */
export function unitCostFromPack(hargaPerPack, packSize) {
  const size = num(packSize);
  return size > 0 ? round2(num(hargaPerPack) / size) : round2(num(hargaPerPack));
}

/** Qty kemasan → qty satuan dasar (2 roll × 30 m = 60 meter). */
export function qtyFromPack(qtyPack, packSize) {
  const size = num(packSize);
  return size > 0 ? round2(num(qtyPack) * size) : round2(num(qtyPack));
}

/** Label satuan untuk UI: "Harga Beli per Meter" / "per KG" / "per Pcs". */
export function hppLabel(unit) {
  const u = String(unit || "").trim();
  return u ? `per ${u}` : "per satuan";
}

/** Umur harga dalam hari. null (belum pernah diisi) → Infinity supaya selalu dianggap basi. */
export function hppAgeDays(updatedAt) {
  if (!updatedAt) return Infinity;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86400000);
}

/** Harga sudah usang? Dipakai badge peringatan di panel Harga Beli. */
export function isHppStale(updatedAt, days = HPP_STALE_DAYS) {
  return hppAgeDays(updatedAt) > days;
}

/**
 * Pemakaian BERSIH per item untuk satu job, dari ledger inventory_transactions.
 *
 * Aturan: jumlahkan kolom `qty` saja, JANGAN `qty_actual`. Koreksi timbang freon menulis
 * DUA baris — baris asli di-set qty_actual = -aktual DAN dibuat baris `adjustment` berisi
 * selisihnya (MatTrackView.jsx:735). Menjumlahkan `qty_actual ?? qty` berarti koreksinya
 * terhitung dua kali. Σ qty konsisten dengan pergerakan stok sebenarnya.
 *
 * Return: Map code → { code, name, qty, unit_cost } (hanya yang qty bersihnya > 0).
 */
export function netUsageByItem(txs = []) {
  const acc = {};
  for (const tx of txs) {
    const code = tx?.inventory_code;
    if (!code) continue;
    if (!acc[code]) {
      acc[code] = { code, name: tx.inventory_name || code, qty: 0, unit_cost: null };
    }
    acc[code].qty += num(tx.qty);
    // Harga yang berlaku SAAT transaksi (kalau tercatat) menang atas HPP hari ini.
    if (acc[code].unit_cost == null && num(tx.unit_cost) > 0) acc[code].unit_cost = num(tx.unit_cost);
  }
  const out = {};
  for (const [code, row] of Object.entries(acc)) {
    const terpakai = round2(-row.qty);   // qty pemakaian negatif → dibalik jadi positif
    if (terpakai > 0) out[code] = { ...row, qty: terpakai };
  }
  return out;
}

/**
 * Biaya material sebuah job — angka untuk field "Biaya Material Aktual" di modal Komisi.
 *
 * Dua sumber, sengaja tidak tumpang tindih:
 *   1. Stok terpakai  → Σ qty bersih × HPP (unit_cost transaksi, fallback purchase_price item).
 *   2. Nota tertaut job yang BELUM jadi stok (stock_linked_at kosong) → amount apa adanya.
 *      Nota yang sudah ditautkan ke stok sengaja DILEWATI: biayanya sudah terhitung lewat
 *      jalur 1 saat barangnya dipakai. Ini penjaga anti dobel-hitung.
 *
 * Return { total, lines[], missing[] } — `missing` = item terpakai yang HPP-nya belum diisi,
 * dipakai UI untuk badge "⚠ N item belum ada harga beli" supaya angka yang kurang lengkap
 * tidak lewat diam-diam.
 */
export function jobMaterialCost({ txs = [], expenses = [], inventory = [] } = {}) {
  const invByCode = {};
  for (const it of inventory) if (it?.code) invByCode[it.code] = it;

  const lines = [];
  const missing = [];

  for (const row of Object.values(netUsageByItem(txs))) {
    const item = invByCode[row.code];
    const hppItem = num(item?.purchase_price);
    const unitCost = row.unit_cost != null ? row.unit_cost : hppItem;
    const line = {
      source: "stok",
      code: row.code,
      name: item?.name || row.name,
      qty: row.qty,
      unit: item?.unit || "",
      unit_cost: unitCost,
      subtotal: round2(row.qty * unitCost),
      // true = harga transaksi tidak tercatat, memakai HPP item hari ini (perkiraan).
      estimated: row.unit_cost == null && unitCost > 0,
    };
    lines.push(line);
    if (!(unitCost > 0)) missing.push(line);
  }

  for (const e of expenses) {
    if (e?.stock_linked_at) continue;             // sudah masuk lewat jalur stok
    lines.push({
      source: "nota",
      code: e?.inventory_code || null,
      name: e?.item_name || e?.description || "Nota material",
      qty: num(e?.qty) || null,
      unit: e?.unit || "",
      unit_cost: num(e?.unit_cost) || null,
      subtotal: round2(num(e?.amount)),
      estimated: false,
    });
  }

  const total = round2(lines.reduce((s, l) => s + num(l.subtotal), 0));
  return { total, lines, missing };
}

const normName = (s) => String(s || "").trim().toLowerCase();

// Parse materials_detail invoice (bisa jsonb array, string JSON, atau null) → array baris.
function parseMaterialsDetail(md) {
  if (Array.isArray(md)) return md;
  if (typeof md === "string" && md.trim()) {
    try { const p = JSON.parse(md); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

/**
 * Biaya material "quick count" untuk Bonus Margin — dihitung dari RINCIAN INVOICE
 * (materials_detail) × HPP, BUKAN dari stok yang tertaut ke job. Ini basis bonus, bukan
 * laporan keuangan presisi (keputusan Owner 29 Agu 2026).
 *
 * Aturan:
 *   - Tiap baris material yang DITAGIH (category != "LABOR") dinilai qty × HPP (purchase_price),
 *     dicocokkan ke inventory by nama (case-insensitive).
 *   - LABOR/jasa → dilewati (tak punya modal).
 *   - Material tanpa HPP → biaya 0 (skip → jadi margin), dicatat di `missing` untuk badge UI.
 *
 * Keunggulan vs jalur stok-tertaut: rincian invoice SELALU ada & lengkap → tak under-count
 * gara-gara tagging stok yang kurang. Return { total, lines[], missing[] } (bentuk sama
 * dengan jobMaterialCost supaya UI modal tidak berubah).
 */
export function invoiceMaterialCostHPP({ materialsDetail, inventory = [] } = {}) {
  const hppByName = {};
  for (const it of inventory) if (it?.name) hppByName[normName(it.name)] = num(it.purchase_price);

  const lines = [];
  const missing = [];
  for (const l of parseMaterialsDetail(materialsDetail)) {
    if (String(l?.category || "").toUpperCase() === "LABOR") continue;  // jasa tak punya modal
    const nama = l?.nama || l?.name || "";
    const qty = num(l?.jumlah ?? l?.qty ?? 1) || 1;
    const hpp = hppByName[normName(nama)] || 0;
    const line = {
      source: "invoice",
      name: nama || "Material",
      qty,
      unit: l?.satuan || l?.unit || "",
      unit_cost: hpp,
      subtotal: round2(qty * hpp),
      estimated: true,   // pakai HPP kini (perkiraan), bukan harga transaksi historis
    };
    lines.push(line);
    if (!(hpp > 0)) missing.push(line);
  }
  const total = round2(lines.reduce((s, l) => s + num(l.subtotal), 0));
  return { total, lines, missing };
}
