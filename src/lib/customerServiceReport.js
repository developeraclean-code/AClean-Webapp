const parseArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Normalisasi satu baris service_reports untuk panel riwayat Customer. Fungsi ini
// sengaja pure supaya jalur JSONB baru dan kolom TEXT legacy tetap aman diuji.
export const normalizeCustomerServiceReport = (row) => {
  if (!row) return null;
  const units = parseArray(row.units).length > 0 ? parseArray(row.units) : parseArray(row.units_json);
  const materials = parseArray(row.materials_used).length > 0
    ? parseArray(row.materials_used)
    : (parseArray(row.materials).length > 0 ? parseArray(row.materials) : parseArray(row.materials_json));
  const fotos = parseArray(row.fotos);
  const directUrls = parseArray(row.foto_urls).filter(Boolean);
  const fotoUrls = directUrls.length > 0
    ? directUrls
    : fotos.map(f => typeof f === "string" ? f : f?.url).filter(Boolean);

  return {
    ...row,
    units,
    materials,
    fotos,
    foto_urls: fotoUrls,
    rekomendasi: row.rekomendasi || "",
    catatan_global: row.catatan_global || row.catatan || "",
    status: row.status || "SUBMITTED",
    _detailLoaded: true,
  };
};
