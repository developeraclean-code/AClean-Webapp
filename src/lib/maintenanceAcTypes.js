// Vocabulary bersama registry, pemilih unit teknisi, dan tarif maintenance.
// VRV/VRF indoor dan outdoor adalah aset berbeda; jangan fallback ke Split Wall.
export const MAINT_AC_TYPE_LABELS = {
  split: "Split Wall", cassette: "Cassette", standing: "Floor Standing", floor: "Split Duct",
  vrv_indoor: "VRV / VRF Indoor", vrv_outdoor: "VRV / VRF Outdoor",
};
export const MAINT_AC_TYPES = Object.keys(MAINT_AC_TYPE_LABELS);
export const MAINT_REPORT_BASE = {
  split: "AC Split", cassette: "AC Cassette", standing: "AC Floor Standing", floor: "AC Split Duct",
  vrv_indoor: "AC VRV Indoor", vrv_outdoor: "AC VRV Outdoor",
};
export const normalizeMaintenanceAcType = value => {
  const s = String(value || "").trim().toLowerCase();
  if (["duct", "ducted"].includes(s)) return "floor";
  const vrv = s.match(/^(?:ac\s+)?(?:vrv|vrf)[ _/-]+(indoor|outdoor)(?:\s+[\d.,]+\s*pk)?$/);
  if (vrv) return `vrv_${vrv[1]}`;
  return MAINT_AC_TYPES.includes(s) ? s : null;
};
export const isVrvType = value => /\b(?:vrv|vrf)(?:\b|_)/i.test(String(value || ""));
export const capacityPkNumber = value => {
  const s = String(value ?? "").trim().replace(/\s*PK$/i, "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};
export const maintenanceAcLabel = type => MAINT_AC_TYPE_LABELS[normalizeMaintenanceAcType(type)] || type || "—";
