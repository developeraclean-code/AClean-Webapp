// Harga deal per-klien Maintenance B2B (tabel maintenance_client_prices) →
// override harga CLEANING per unit di builder invoice jalur VERIFY & EDIT
// (Owner/Admin). Jalur submit teknisi TETAP pakai harga global — harga deal
// klien tidak diekspos ke device teknisi (RLS price book = service-key only).
//
// Aturan match (revisi Owner 19 Agu 2026): ac_type WAJIB terisi & cocok tipe
// unit + service_type cleaning ("Cuci ..."/"Cleaning") + harga > 0, atau Rp0
// dengan included_in_service=true yang disepakati eksplisit. Untuk PK:
//   1) STRICT — baris dgn capacity_pk terisi & sama persis PK unit = prioritas.
//   2) WILDCARD — baris tanpa capacity_pk = harga FLAT per tipe (berlaku semua
//      PK), dipakai bila tak ada baris STRICT yang cocok.
// (Sebelumnya wildcard diabaikan total; diaktifkan agar harga flat per-tipe
// yang di-set Owner benar-benar terpakai — mis. Youthology split 95k, cassette
// & ducted 250k. Baris ber-PK tetap menang, jadi backward-compatible.)
// Tanpa baris cocok sama sekali → caller fallback ke harga global price_list.
import { normalizeMaintenanceAcType, isVrvType, capacityPkNumber } from "./maintenanceAcTypes.js";

// Kode tipe registry maintenance (maintenance_units.ac_type / price book
// ac_type). Vocab historis tidak seragam: "floor" & "ducted" sama-sama
// dipakai untuk Split Duct (AC_TYPE_LABELS vs AC_TYPE_BASE) → dinormalkan.
export const normalizeAcCode = normalizeMaintenanceAcType;

// Tipe unit laporan ("AC Split 1PK" / "AC Cassette 3PK" / "AC Floor Standing
// 2.5PK" / "AC Split Duct 4PK") → kode registry.
export const unitTipeToCode = (tipe) => {
  const t = String(tipe || "").toLowerCase();
  if (!t.trim()) return null;
  if (isVrvType(t)) return normalizeAcCode(t);
  if (t.includes("cassette")) return "cassette";
  if (t.includes("floor standing")) return "standing";
  if (t.includes("duct")) return "floor";
  return "split";
};

// PK numerik unit laporan: prioritas kolom pk ("1.5PK"), fallback angka di tipe.
export const unitPkNumber = (u) => {
  const explicit = capacityPkNumber(u?.pk);
  if (explicit != null) return explicit;
  const m = String(u?.tipe || "").match(/([\d.,]+)\s*PK/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const isCleaningPriceRow = (p) => /cuci|cleaning/i.test(String(p?.service_type || ""));

// Harga deal cleaning untuk 1 unit laporan. null = tidak ada baris match →
// caller pakai harga global.
export function clientCleaningUnitRate(prices, u) {
  if (!Array.isArray(prices) || !prices.length || !u) return null;
  const code = unitTipeToCode(u.tipe);
  if (!code) return null;
  const pk = unitPkNumber(u);
  // Jangan memperlakukan 0 kosong/null/legacy sebagai layanan gratis.
  const rows = prices.filter(
    (p) => isCleaningPriceRow(p) && normalizeAcCode(p.ac_type) === code &&
      p.unit_price != null && p.unit_price !== "" && Number.isFinite(Number(p.unit_price)) &&
      ((Number(p.unit_price) > 0 && p.included_in_service !== true) ||
       (Number(p.unit_price) === 0 && p.included_in_service === true))
  );
  if (!rows.length) return null;
  // 1) STRICT: baris ber-capacity_pk yang sama persis PK unit → prioritas tertinggi.
  if (pk != null) {
    const strict = rows.find(
      (p) => p.capacity_pk != null && p.capacity_pk !== "" && Number(p.capacity_pk) === pk
    );
    if (strict) return { ...strict, unit_price: Number(strict.unit_price), included_in_service: strict.included_in_service === true };
  }
  // 2) WILDCARD: baris tanpa capacity_pk = harga flat per tipe (berlaku semua PK).
  const wild = rows.find((p) => p.capacity_pk == null || p.capacity_pk === "");
  return wild ? { ...wild, unit_price: Number(wild.unit_price), included_in_service: wild.included_in_service === true } : null;
}

// Kompatibilitas caller lama. Nol eksplisit harus dipertahankan, bukan || fallback.
export function clientCleaningUnitPrice(prices, u) {
  return clientCleaningUnitRate(prices, u)?.unit_price ?? null;
}
