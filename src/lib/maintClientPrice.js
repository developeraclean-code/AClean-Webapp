// Harga deal per-klien Maintenance B2B (tabel maintenance_client_prices) →
// override harga CLEANING per unit di builder invoice jalur VERIFY & EDIT
// (Owner/Admin). Jalur submit teknisi TETAP pakai harga global — harga deal
// klien tidak diekspos ke device teknisi (RLS price book = service-key only).
//
// Aturan match (keputusan Owner 10 Jul 2026): STRICT per tipe & PK —
// baris price book hanya dipakai bila service_type = cleaning ("Cuci ..."/
// "Cleaning"), ac_type terisi & cocok dengan tipe unit laporan, dan
// capacity_pk terisi & sama persis dengan PK unit. Baris wildcard
// (ac_type/capacity_pk kosong) TIDAK dipakai. Tanpa baris cocok → caller
// fallback ke harga global price_list (perilaku lama).

// Kode tipe registry maintenance (maintenance_units.ac_type / price book
// ac_type). Vocab historis tidak seragam: "floor" & "ducted" sama-sama
// dipakai untuk Split Duct (AC_TYPE_LABELS vs AC_TYPE_BASE) → dinormalkan.
const AC_CODE_ALIAS = {
  split: "split",
  cassette: "cassette",
  standing: "standing", // Floor Standing
  floor: "floor",       // Split Duct (label MaintenanceView)
  ducted: "floor",      // Split Duct (label laporanConstants)
  duct: "floor",
};

export const normalizeAcCode = (v) =>
  AC_CODE_ALIAS[String(v || "").trim().toLowerCase()] || null;

// Tipe unit laporan ("AC Split 1PK" / "AC Cassette 3PK" / "AC Floor Standing
// 2.5PK" / "AC Split Duct 4PK") → kode registry.
export const unitTipeToCode = (tipe) => {
  const t = String(tipe || "").toLowerCase();
  if (!t.trim()) return null;
  if (t.includes("cassette")) return "cassette";
  if (t.includes("floor standing")) return "standing";
  if (t.includes("duct")) return "floor";
  return "split";
};

// PK numerik unit laporan: prioritas kolom pk ("1.5PK"), fallback angka di tipe.
export const unitPkNumber = (u) => {
  const m = String(u?.pk || u?.tipe || "").match(/([\d.,]+)\s*PK/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const isCleaningPriceRow = (p) => /cuci|cleaning/i.test(String(p?.service_type || ""));

// Harga deal cleaning untuk 1 unit laporan. null = tidak ada baris match →
// caller pakai harga global.
export function clientCleaningUnitPrice(prices, u) {
  if (!Array.isArray(prices) || !prices.length || !u) return null;
  const code = unitTipeToCode(u.tipe);
  const pk = unitPkNumber(u);
  if (!code || pk == null) return null;
  const row = prices.find(
    (p) =>
      isCleaningPriceRow(p) &&
      normalizeAcCode(p.ac_type) === code &&
      p.capacity_pk != null &&
      p.capacity_pk !== "" &&
      Number(p.capacity_pk) === pk &&
      Number(p.unit_price) > 0
  );
  return row ? Number(row.unit_price) : null;
}
