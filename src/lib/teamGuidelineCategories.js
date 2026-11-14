export const SOP_GUIDELINE_CATEGORIES = [
  { key: "umum", label: "Umum" },
  { key: "cleaning", label: "Cleaning" },
  { key: "cek_unit", label: "Cek Unit" },
  { key: "test_press", label: "Test Press" },
  { key: "program_promo", label: "Program & Promo" },
];

const categoryOrder = new Map(SOP_GUIDELINE_CATEGORIES.map((item, index) => [item.key, index]));

export function normalizeSopGuidelineCategory(value) {
  return categoryOrder.has(value) ? value : "umum";
}

export function sortSopGuidelines(rows) {
  return [...rows].sort((a, b) =>
    categoryOrder.get(normalizeSopGuidelineCategory(a.category))
      - categoryOrder.get(normalizeSopGuidelineCategory(b.category))
    || (a.sort_order || 0) - (b.sort_order || 0)
    || Number(a.id) - Number(b.id));
}
