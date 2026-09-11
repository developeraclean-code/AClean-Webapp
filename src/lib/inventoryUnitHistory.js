// Riwayat tabung/roll harus mengikuti identitas fisik (`inventory_units.id`),
// bukan label yang bisa dipakai kembali setelah unit lama diarsipkan.

const norm = (value) => String(value || "").trim().toLowerCase();

// ID pendek hanya untuk membantu manusia membedakan unit berlabel sama.
// Relasi database tetap selalu memakai UUID lengkap.
export const shortInventoryUnitId = (id) => {
  const compact = String(id || "").replace(/-/g, "").trim();
  return compact ? compact.slice(0, 6).toUpperCase() : "—";
};

const timeOf = (row) => {
  const raw = row?.created_at || row?.job_date;
  if (!raw) return null;
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : null;
};

const sameReusableLabel = (a, b) =>
  norm(a?.inventory_code) === norm(b?.inventory_code) &&
  norm(a?.unit_label) === norm(b?.unit_label);

/**
 * Ambil transaksi milik satu unit fisik.
 *
 * Data baru wajib cocok lewat unit_id. Untuk transaksi legacy yang belum punya
 * unit_id, label hanya boleh menjadi fallback di dalam rentang waktu lifecycle
 * unit: created_at unit ini sampai sebelum unit berikutnya dengan kode+label sama.
 */
export function transactionsForInventoryUnit(unit, allUnits = [], transactions = []) {
  if (!unit?.id) return [];

  const sameLabelUnits = allUnits.filter((candidate) => sameReusableLabel(candidate, unit));
  const unitStartedAt = timeOf(unit);
  const nextStartedAt = unitStartedAt == null
    ? null
    : sameLabelUnits
      .map(timeOf)
      .filter((value) => value != null && value > unitStartedAt)
      .sort((a, b) => a - b)[0] ?? null;

  return transactions.filter((tx) => {
    // ID adalah sumber kebenaran. Transaksi yang sudah menunjuk unit lain tidak
    // boleh pernah "pindah" hanya karena labelnya sama.
    if (tx?.unit_id) return tx.unit_id === unit.id;

    if (!sameReusableLabel(tx, unit)) return false;

    // Tanpa timestamp unit, fallback label aman hanya bila label tersebut unik.
    if (unitStartedAt == null) return sameLabelUnits.length === 1;

    const txAt = timeOf(tx);
    if (txAt == null || txAt < unitStartedAt) return false;
    return nextStartedAt == null || txAt < nextStartedAt;
  });
}
