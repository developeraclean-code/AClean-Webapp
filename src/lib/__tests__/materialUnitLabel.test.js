import { describe, it, expect } from "vitest";
import { computeDayDeduct } from "../materialDeduct.js";

// Bentuk items nyata dari app Material Harian (sesi Usaeri 25 Agu 2026).
const pagi = [
  { qty: 7, label: "Pipa AC Hoda 1PK", inventory_code: "SKU022", material_type: "pipa",
    units: [{ qty: 7, label: "Roll 1PK-A4", unit_id: "u-pipa" }] },
  { qty: 4.8, label: "Freon R-32", inventory_code: "SKU009", material_type: "freon",
    weight_kg: [{ kg: 4.8, label: "Tabung R32 - K", unit_id: "u-freon" }] },
];
const pulang = [
  { qty: 2, label: "Pipa AC Hoda 1PK", inventory_code: "SKU022", material_type: "pipa",
    units: [{ qty: 2, label: "Roll 1PK-A4", unit_id: "u-pipa" }] },
  { qty: 4.5, label: "Freon R-32", inventory_code: "SKU009", material_type: "freon",
    weight_kg: [{ kg: 4.5, label: "Tabung R32 - K", unit_id: "u-freon" }] },
];

describe("computeDayDeduct — nama tabung/roll fisik", () => {
  const lines = computeDayDeduct(pagi, pulang);

  it("membawa unit_label terpisah dari nama material", () => {
    const pipa = lines.find((l) => l.unit_id === "u-pipa");
    expect(pipa.label).toBe("Pipa AC Hoda 1PK");
    expect(pipa.unit_label).toBe("Roll 1PK-A4");
    expect(pipa.used).toBe(5);
  });

  it("freon ikut terbawa dari weight_kg", () => {
    const freon = lines.find((l) => l.unit_id === "u-freon");
    expect(freon.unit_label).toBe("Tabung R32 - K");
    expect(freon.used).toBe(0.3);
  });

  it("dua roll dari material yang SAMA tetap terbedakan", () => {
    const dua = computeDayDeduct(
      [{ qty: 100, label: "Pipa 1/4", material_type: "pipa", inventory_code: "SKU022",
         units: [{ qty: 60, label: "Roll A", unit_id: "uA" }, { qty: 40, label: "Roll B", unit_id: "uB" }] }],
      [{ qty: 70, label: "Pipa 1/4", material_type: "pipa", inventory_code: "SKU022",
         units: [{ qty: 50, label: "Roll A", unit_id: "uA" }, { qty: 20, label: "Roll B", unit_id: "uB" }] }],
    );
    expect(dua).toHaveLength(2);
    expect(dua.map((l) => [l.unit_label, l.used])).toEqual([["Roll A", 10], ["Roll B", 20]]);
  });

  it("item legacy tanpa unit → unit_label null, bukan meniru nama material", () => {
    const legacy = computeDayDeduct(
      [{ qty: 5, label: "Duct Tape", material_type: "lain", inventory_code: "SKU031" }],
      [{ qty: 2, label: "Duct Tape", material_type: "lain", inventory_code: "SKU031" }],
    );
    expect(legacy[0].unit_id).toBeFalsy();
    expect(legacy[0].unit_label).toBe(null);
    expect(legacy[0].used).toBe(3);
  });
});
