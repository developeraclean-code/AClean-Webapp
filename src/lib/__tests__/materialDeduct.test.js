import { describe, it, expect } from "vitest";
import { computeDayDeduct, deductLines, usedByCode } from "../materialDeduct.js";

const pipa = (code, units) => ({ material_type: "pipa", inventory_code: code, label: code, qty: units.reduce((s, u) => s + u.qty, 0), satuan: "meter", units });
const freon = (code, units) => ({ material_type: "freon", inventory_code: code, label: code, qty: units.length, satuan: "kg", units, weight_kg: units.map((u) => ({ unit_id: u.unit_id, kg: u.qty })) });

describe("computeDayDeduct", () => {
  it("per unit: used = dibawa - sisa", () => {
    const out = computeDayDeduct(
      [pipa("SKU022", [{ unit_id: "a", qty: 30 }, { unit_id: "b", qty: 20 }])],
      [pipa("SKU022", [{ unit_id: "a", qty: 20 }, { unit_id: "b", qty: 15 }])]
    );
    const a = out.find((x) => x.unit_id === "a"); const b = out.find((x) => x.unit_id === "b");
    expect(a.used).toBe(10); expect(b.used).toBe(5);
  });
  it("unit dibawa tapi tak ada di pulang → used penuh", () => {
    const out = computeDayDeduct([pipa("SKU022", [{ unit_id: "a", qty: 30 }])], []);
    expect(out[0].used).toBe(30);
  });
  it("sisa = dibawa → used 0 (tak kepake)", () => {
    const out = computeDayDeduct([pipa("SKU022", [{ unit_id: "a", qty: 30 }])], [pipa("SKU022", [{ unit_id: "a", qty: 30 }])]);
    expect(out[0].used).toBe(0);
  });
  it("freon pakai weight_kg per tabung", () => {
    const out = computeDayDeduct(
      [freon("SKU009", [{ unit_id: "t1", qty: 6 }, { unit_id: "t2", qty: 6 }])],
      [freon("SKU009", [{ unit_id: "t1", qty: 3 }, { unit_id: "t2", qty: 4 }])]
    );
    expect(out.find((x) => x.unit_id === "t1").used).toBe(3);
    expect(out.find((x) => x.unit_id === "t2").used).toBe(2);
  });
  it("sisa > dibawa → used 0 (tak negatif)", () => {
    const out = computeDayDeduct([pipa("SKU022", [{ unit_id: "a", qty: 10 }])], [pipa("SKU022", [{ unit_id: "a", qty: 15 }])]);
    expect(out[0].used).toBe(0);
  });
  it("legacy tanpa unit_id → key by code", () => {
    const out = computeDayDeduct(
      [{ material_type: "kabel", inventory_code: "SKU025", label: "Kabel", qty: 30 }],
      [{ material_type: "kabel", inventory_code: "SKU025", label: "Kabel", qty: 12 }]
    );
    expect(out[0].unit_id).toBeNull(); expect(out[0].used).toBe(18);
  });
});

describe("deductLines / usedByCode", () => {
  it("deductLines hanya used>0", () => {
    const lines = deductLines(
      [pipa("SKU022", [{ unit_id: "a", qty: 30 }, { unit_id: "b", qty: 20 }])],
      [pipa("SKU022", [{ unit_id: "a", qty: 30 }, { unit_id: "b", qty: 15 }])]  // a tak kepake, b kepake 5
    );
    expect(lines).toHaveLength(1); expect(lines[0].unit_id).toBe("b"); expect(lines[0].used).toBe(5);
  });
  it("usedByCode menjumlah per SKU", () => {
    const m = usedByCode(
      [pipa("SKU022", [{ unit_id: "a", qty: 30 }, { unit_id: "b", qty: 20 }])],
      [pipa("SKU022", [{ unit_id: "a", qty: 25 }, { unit_id: "b", qty: 18 }])]
    );
    expect(m.SKU022).toBe(7); // (30-25)+(20-18)=5+2
  });
});
