import { describe, expect, it } from "vitest";
import { normalizeSopGuidelineCategory, sortSopGuidelines } from "../teamGuidelineCategories.js";

describe("SOP guideline categories", () => {
  it("keeps legacy rows visible under Umum and groups categories in a stable order", () => {
    const rows = [
      { id: 4, category: "program_promo", sort_order: 1 },
      { id: 3, category: "cleaning", sort_order: 2 },
      { id: 2, category: null, sort_order: 1 },
      { id: 1, category: "cleaning", sort_order: 1 },
    ];
    expect(normalizeSopGuidelineCategory(null)).toBe("umum");
    expect(sortSopGuidelines(rows).map(row => row.id)).toEqual([2, 1, 3, 4]);
    expect(rows[0].id).toBe(4);
  });
});
