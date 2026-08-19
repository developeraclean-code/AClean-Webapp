// Harga deal per-klien Maintenance B2B (tabel maintenance_client_prices) →
// override harga CLEANING per unit di builder invoice jalur VERIFY & EDIT
// (Owner/Admin). Jalur submit teknisi TETAP pakai harga global — harga deal
// klien tidak diekspos ke device teknisi (RLS price book = service-key only).
//
// Aturan match (revisi Owner 19 Agu 2026): ac_type WAJIB terisi & cocok tipe
// unit + service_type cleaning ("Cuci ..."/"Cleaning") + harga > 0. Untuk PK:
//   1) STRICT — baris dgn capacity_pk terisi & sama persis PK unit = prioritas.
//   2) WILDCARD — baris tanpa capacity_pk = harga FLAT per tipe (berlaku semua
//      PK), dipakai bila tak ada baris STRICT yang cocok.
// (Sebelumnya wildcard diabaikan total; diaktifkan agar harga flat per-tipe
// yang di-set Owner benar-benar terpakai — mis. Youthology split 95k, cassette
// & ducted 250k. Baris ber-PK tetap menang, jadi backward-compatible.)
// Tanpa baris cocok sama sekali → caller fallback ke harga global price_list.

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
  if (!code) return null;
  const pk = unitPkNumber(u);
  // Baris cleaning utk tipe unit ini (ac_type WAJIB terisi & cocok, harga > 0).
  const rows = prices.filter(
    (p) => isCleaningPriceRow(p) && normalizeAcCode(p.ac_type) === code && Number(p.unit_price) > 0
  );
  if (!rows.length) return null;
  // 1) STRICT: baris ber-capacity_pk yang sama persis PK unit → prioritas tertinggi.
  if (pk != null) {
    const strict = rows.find(
      (p) => p.capacity_pk != null && p.capacity_pk !== "" && Number(p.capacity_pk) === pk
    );
    if (strict) return Number(strict.unit_price);
  }
  // 2) WILDCARD: baris tanpa capacity_pk = harga flat per tipe (berlaku semua PK).
  const wild = rows.find((p) => p.capacity_pk == null || p.capacity_pk === "");
  return wild ? Number(wild.unit_price) : null;
}
