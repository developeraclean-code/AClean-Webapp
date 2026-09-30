import { describe, expect, it } from "vitest";
import {
  PIPA_MASTER_OPTIONS,
  classifyInventoryMaterial,
  findDuplicateMaterial,
  isPhysicalUnitName,
  validateNewMaterial,
} from "../materialCatalog.js";

describe("material catalog guard", () => {
  it("provides fixed Hoda pipe master choices", () => {
    expect(PIPA_MASTER_OPTIONS).toContain("Pipa AC Hoda 1PK");
    expect(PIPA_MASTER_OPTIONS).toContain("Pipa AC Hoda 2,5PK");
  });

  it("detects roll/tabung as physical-unit names", () => {
    expect(isPhysicalUnitName("Roll 2,5PK - C1")).toBe(true);
    expect(isPhysicalUnitName("Pipa AC Hoda 2,5PK")).toBe(false);
  });

  it("uses material_type before guessing from the name", () => {
    expect(classifyInventoryMaterial({ name: "Roll 2,5PK - C1", material_type: "pipa" })).toBe("pipa");
    expect(classifyInventoryMaterial({ name: "KLEM PIPA PVC", material_type: "sparepart" })).toBe(null);
    expect(classifyInventoryMaterial({ name: "Kabel Listrik 3x2,5" })).toBe("kabel");
  });

  it("blocks a roll from becoming a pipa master", () => {
    const result = validateNewMaterial({
      name: "Roll 2,5PK - C1",
      materialType: "pipa",
      pipaMaster: "Pipa AC Hoda 2,5PK",
      inventoryData: [],
    });
    expect(result.ok).toBe(false);
  });

  it("blocks duplicate pipa master despite punctuation differences", () => {
    const inventory = [{ code: "SKU024", name: "Pipa AC Hoda 2,5PK", material_type: "pipa" }];
    const result = validateNewMaterial({
      name: "Pipa AC Hoda 2.5PK",
      materialType: "pipa",
      pipaMaster: "Pipa AC Hoda 2.5PK",
      inventoryData: inventory,
    });
    expect(findDuplicateMaterial(inventory, "Pipa AC Hoda 2.5PK", "pipa").code).toBe("SKU024");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("SKU024");
  });
});
