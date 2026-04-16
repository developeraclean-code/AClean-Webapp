import { describe, it, expect } from "vitest";
import { isFreonItem, displayStock, computeStockStatus } from "../inventory.js";

describe("isFreonItem", () => {
  it("detects freon by name variants", () => {
    expect(isFreonItem({ name: "Freon R22", unit: "" })).toBe(true);
    expect(isFreonItem({ name: "R-22", unit: "" })).toBe(true);
    expect(isFreonItem({ name: "R32", unit: "" })).toBe(true);
    expect(isFreonItem({ name: "R-410A", unit: "" })).toBe(true);
    expect(isFreonItem({ name: "r410", unit: "" })).toBe(true);
  });
  it("detects freon by kg unit", () => {
    expect(isFreonItem({ name: "Bahan X", unit: "kg" })).toBe(true);
    expect(isFreonItem({ name: "Bahan X", unit: "KG" })).toBe(true);
  });
  it("rejects non-freon items", () => {
    expect(isFreonItem({ name: "Kapasitor", unit: "pcs" })).toBe(false);
    expect(isFreonItem({ name: "", unit: "" })).toBe(false);
    expect(isFreonItem(null)).toBe(false);
    expect(isFreonItem(undefined)).toBe(false);
  });
});

describe("displayStock", () => {
  it("renders freon stock with 1 decimal", () => {
    expect(displayStock({ name: "Freon R32", stock: 2.5 })).toBe("2.5");
    expect(displayStock({ name: "Freon R22", stock: 0 })).toBe("0.0");
    expect(displayStock({ name: "Bahan", unit: "kg", stock: 1.75 })).toBe("1.8");
  });
  it("renders non-freon stock as integer floor", () => {
    expect(displayStock({ name: "Kapasitor", stock: 5 })).toBe("5");
    expect(displayStock({ name: "Kapasitor", stock: 5.9 })).toBe("5");
    expect(displayStock({ name: "Kapasitor", stock: 0 })).toBe("0");
  });
  it("handles missing stock", () => {
    expect(displayStock({ name: "Kapasitor" })).toBe("0");
    expect(displayStock({ name: "Freon R32" })).toBe("0.0");
    expect(displayStock(null)).toBe("0");
  });
});

describe("computeStockStatus", () => {
  it("returns OUT at 0", () => {
    expect(computeStockStatus(0)).toBe("OUT");
    expect(computeStockStatus("0")).toBe("OUT");
    expect(computeStockStatus(null)).toBe("OUT");
  });
  it("returns CRITICAL at <=1", () => {
    expect(computeStockStatus(0.5)).toBe("CRITICAL");
    expect(computeStockStatus(1)).toBe("CRITICAL");
  });
  it("returns WARNING at <= reorder threshold", () => {
    expect(computeStockStatus(3)).toBe("WARNING");
    expect(computeStockStatus(5)).toBe("WARNING");
    expect(computeStockStatus(2, 10)).toBe("WARNING");
    expect(computeStockStatus(10, 10)).toBe("WARNING");
  });
  it("returns OK above threshold", () => {
    expect(computeStockStatus(6)).toBe("OK");
    expect(computeStockStatus(11, 10)).toBe("OK");
    expect(computeStockStatus(100)).toBe("OK");
  });
});
