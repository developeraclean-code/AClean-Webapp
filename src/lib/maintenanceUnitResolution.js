// Riwayat servis hanya boleh ditulis untuk unit fisik yang dipilih di laporan.
// Urutan array/planning bukan identitas unit: jumlah aktual dapat berubah di lapangan.
export function resolveMaintenanceReportUnits(reportUnits, registryUnits, clientId) {
  const units = Array.isArray(reportUnits) ? reportUnits : [];
  if (!units.length) return { ok: false, reason: "report_empty", pairs: [] };
  const registry = new Map((Array.isArray(registryUnits) ? registryUnits : []).map(unit => [String(unit.id).toLowerCase(), unit]));
  const seen = new Set();
  const pairs = [];
  for (let index = 0; index < units.length; index += 1) {
    const reportUnit = units[index];
    const id = String(reportUnit?.maint_unit_id || "").trim().toLowerCase();
    if (!id) return { ok: false, reason: "unit_id_missing", index, pairs: [] };
    if (seen.has(id)) return { ok: false, reason: "unit_id_duplicate", index, pairs: [] };
    const registered = registry.get(id);
    if (!registered) return { ok: false, reason: "unit_id_unknown", index, pairs: [] };
    if (String(registered.client_id) !== String(clientId)) {
      return { ok: false, reason: "unit_other_client", index, pairs: [] };
    }
    seen.add(id);
    pairs.push({ uid: String(registered.id), lu: reportUnit });
  }
  return { ok: true, reason: null, pairs };
}
