// Sumber aturan bersama untuk master material dan klasifikasi Material Harian.
// Master material = jenis barang (mis. Pipa AC Hoda 2,5PK).
// Unit fisik = roll/tabung tertentu (mis. Roll C1), disimpan di inventory_units.

export const PIPA_MASTER_OPTIONS = Object.freeze([
  "Pipa AC Hoda 1PK",
  "Pipa AC Hoda 2PK",
  "Pipa AC Hoda 2,5PK",
  "Pipa AC Hoda 3PK",
]);

export const normalizeMaterialName = (value) => String(value || "")
  .toLowerCase()
  .replace(/[.,]/g, "")
  .replace(/\s+/g, " ")
  .trim();

export const isPhysicalUnitName = (value) => {
  const name = normalizeMaterialName(value);
  return /(^|\s)(roll|gulungan|tabung|unit fisik)(\s|$)/i.test(name);
};

// material_type adalah sumber utama. Tebak dari nama hanya untuk data historis
// yang belum memiliki material_type.
export const classifyInventoryMaterial = (itemOrName) => {
  const item = itemOrName && typeof itemOrName === "object" ? itemOrName : { name: itemOrName };
  const explicit = String(item.material_type || "").toLowerCase().trim();
  if (["pipa", "kabel", "freon"].includes(explicit)) return explicit;

  const name = String(item.name || "").toLowerCase();
  if (name.startsWith("freon")) return "freon";
  if (name.startsWith("pipa ac")) return "pipa";
  if (name.startsWith("kabel")) return "kabel";
  return null;
};

export const findDuplicateMaterial = (inventoryData, name, materialType) => {
  const normalized = normalizeMaterialName(name);
  if (!normalized) return null;
  return (inventoryData || []).find((item) =>
    item.material_type === materialType && normalizeMaterialName(item.name) === normalized
  ) || null;
};

export const validateNewMaterial = ({ name, materialType, pipaMaster, inventoryData }) => {
  const trimmedName = String(name || "").trim();
  if (isPhysicalUnitName(trimmedName)) {
    return { ok: false, message: "Roll/unit fisik tidak dibuat sebagai master. Gunakan Tambah Unit di Stok Material." };
  }
  if (materialType === "pipa") {
    if (!pipaMaster) {
      return { ok: false, message: "Pilih klasifikasi master Pipa AC terlebih dahulu" };
    }
    if (normalizeMaterialName(trimmedName) !== normalizeMaterialName(pipaMaster)) {
      return { ok: false, message: "Nama master pipa harus mengikuti klasifikasi yang dipilih" };
    }
  }

  const duplicate = findDuplicateMaterial(inventoryData, trimmedName, materialType);
  if (duplicate) {
    return {
      ok: false,
      duplicate,
      message: `Master material sudah ada (${duplicate.code}). Untuk stok baru gunakan Restock/Tambah Unit, bukan tambah master lagi.`,
    };
  }
  return { ok: true };
};
