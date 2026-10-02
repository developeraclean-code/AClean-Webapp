import { describe, expect, it } from "vitest";
import {
  MATERIAL_MASTER_PRESETS,
  PIPA_MASTER_OPTIONS,
  classifyInventoryMaterial,
  defaultUnitForMaterialType,
  findDuplicateMaterial,
  findMaterialPreset,
  isPhysicalUnitName,
  validateNewMaterial,
} from "../materialCatalog.js";

describe("material catalog guard", () => {
  it("provides fixed Hoda pipe master choices", () => {
    expect(PIPA_MASTER_OPTIONS).toContain("Pipa AC Hoda 1PK");
    expect(PIPA_MASTER_OPTIONS).toContain("Pipa AC Hoda 2,5PK");
  });

  it("provides operational presets with internal units", () => {
    expect(MATERIAL_MASTER_PRESETS.map((item) => item.name)).toEqual(expect.arrayContaining([
      "Freon R-32", "Freon R-410", "Freon R-22", "Pipa AC Hoda 3PK",
    ]));
    expect(findMaterialPreset("Freon R-32")).toMatchObject({ materialType: "freon", unit: "kg" });
    expect(findMaterialPreset("Pipa AC Hoda 2PK")).toMatchObject({ materialType: "pipa", unit: "m" });
    expect(defaultUnitForMaterialType("kabel")).toBe("m");
    expect(defaultUnitForMaterialType("other")).toBe("pcs");
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

  it("treats legacy freon spelling as the same master", () => {
    const inventory = [{ code: "FR32", name: "Freon R32", material_type: "freon" }];
    expect(findDuplicateMaterial(inventory, "Freon R-32", "freon")?.code).toBe("FR32");
    expect(findDuplicateMaterial(
      [{ code: "FR410", name: "Freon R-410A", material_type: "freon" }],
      "Freon R-410",
      "freon",
    )?.code).toBe("FR410");
  });

  it("allows a guarded manual master without forcing a pipa preset", () => {
    const result = validateNewMaterial({
      name: "Pipa Drain Fleksibel",
      materialType: "pipa",
      pipaMaster: "",
      manualEntry: true,
      inventoryData: [],
    });
    expect(result.ok).toBe(true);
  });
});
