// service_reports keeps legacy TEXT JSON columns alongside canonical JSONB.
// Writes must keep both representations aligned; reads prefer JSONB because it
// is the column selected by report list/detail queries.
export function normalizeReportArray(primary, legacy, fallback = []) {
  if (Array.isArray(primary)) return primary;
  if (typeof primary === "string") {
    try {
      const parsed = JSON.parse(primary);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) { /* use legacy data below */ }
  }

  if (Array.isArray(legacy)) return legacy;
  if (typeof legacy === "string") {
    try {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) { /* use fallback below */ }
  }

  return fallback;
}

export function reportArrayPersistenceFields(units, materials) {
  const safeUnits = Array.isArray(units) ? units : [];
  const safeMaterials = Array.isArray(materials) ? materials : [];
  return {
    units: safeUnits,
    units_json: JSON.stringify(safeUnits),
    materials_used: safeMaterials,
    materials_json: JSON.stringify(safeMaterials),
  };
}

export function serviceReportUpdateError(data, error) {
  if (error) return error.message || "Penyimpanan laporan gagal";
  if (!data?.id) return "Baris laporan tidak ditemukan atau tidak dapat diubah";
  return null;
}

export function reportStatusAfterEdit(status) {
  return status === "REVISION" ? "SUBMITTED" : status;
}
