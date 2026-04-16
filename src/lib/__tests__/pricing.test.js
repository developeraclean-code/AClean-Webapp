import { describe, it, expect } from "vitest";
import {
  PRICE_LIST_DEFAULT, tipeToPkNumber, getBracketKey,
  hargaPerUnitFromTipe, hitungLaborFromUnits, buildPriceListFromDB,
} from "../pricing.js";

describe("tipeToPkNumber", () => {
  it("parses standard PK notations", () => {
    expect(tipeToPkNumber("1 PK")).toBe(1);
    expect(tipeToPkNumber("1.5PK")).toBe(1.5);
    expect(tipeToPkNumber("2,5 PK")).toBe(2.5);
    expect(tipeToPkNumber("3PK")).toBe(3);
  });
  it("defaults to 1 when missing/invalid", () => {
    expect(tipeToPkNumber("")).toBe(1);
    expect(tipeToPkNumber(null)).toBe(1);
    expect(tipeToPkNumber("Split")).toBe(1);
  });
});

describe("getBracketKey", () => {
  it("maps Cleaning split by PK bracket", () => {
    expect(getBracketKey("Cleaning", "Split 0.5PK")).toBe("AC Split 0.5-1PK");
    expect(getBracketKey("Cleaning", "Split 1PK")).toBe("AC Split 0.5-1PK");
    expect(getBracketKey("Cleaning", "Split 2PK")).toBe("AC Split 1.5-2.5PK");
    expect(getBracketKey("Cleaning", "Split 2,5PK")).toBe("AC Split 1.5-2.5PK");
  });
  it("maps Cleaning cassette by PK bracket", () => {
    expect(getBracketKey("Cleaning", "Cassette 2PK")).toBe("AC Cassette 2-2.5PK");
    expect(getBracketKey("Cleaning", "Cassette 3PK")).toBe("AC Cassette 3PK");
    expect(getBracketKey("Cleaning", "Cassette 4PK")).toBe("AC Cassette 4PK");
    expect(getBracketKey("Cleaning", "Cassette 5PK")).toBe("AC Cassette 5PK");
    expect(getBracketKey("Cleaning", "Cassette 6PK")).toBe("AC Cassette 6PK");
  });
  it("maps Install by PK", () => {
    expect(getBracketKey("Install", "1PK")).toBe("Pemasangan AC Baru 0,5PK - 1PK");
    expect(getBracketKey("Install", "2PK")).toBe("Pemasangan AC Baru 1,5PK - 2PK");
    expect(getBracketKey("Install", "3PK")).toBe("Pasang AC Split 3PK");
  });
  it("returns null for unknown service", () => {
    expect(getBracketKey("Repair", "1PK")).toBe(null);
    expect(getBracketKey("Complain", "1PK")).toBe(null);
  });
});

describe("hargaPerUnitFromTipe", () => {
  it("prefers DB active row over fallback", () => {
    const db = [{ service: "Cleaning", type: "AC Split 0.5-1PK", price: 99000, is_active: true }];
    expect(hargaPerUnitFromTipe("Cleaning", "1PK", db)).toBe(99000);
  });
  it("ignores inactive DB rows", () => {
    const db = [{ service: "Cleaning", type: "AC Split 0.5-1PK", price: 99000, is_active: false }];
    expect(hargaPerUnitFromTipe("Cleaning", "1PK", db)).toBe(85000); // default
  });
  it("falls back to PRICE_LIST_DEFAULT", () => {
    expect(hargaPerUnitFromTipe("Cleaning", "2PK", [])).toBe(100000);
    expect(hargaPerUnitFromTipe("Cleaning", "Cassette 3PK", [])).toBe(300000);
  });
  it("returns 0 for unknown bracket", () => {
    expect(hargaPerUnitFromTipe("Repair", "1PK", [])).toBe(0);
  });
});

describe("hitungLaborFromUnits", () => {
  it("sums per-unit labor correctly", () => {
    const units = [{ tipe: "Split 1PK" }, { tipe: "Cassette 3PK" }];
    expect(hitungLaborFromUnits("Cleaning", units)).toBe(85000 + 300000);
  });
  it("returns 0 for empty units", () => {
    expect(hitungLaborFromUnits("Cleaning", [])).toBe(0);
    expect(hitungLaborFromUnits("Cleaning", null)).toBe(0);
  });
});

describe("buildPriceListFromDB", () => {
  it("merges DB rows with default, overrides type prices", () => {
    const rows = [
      { service: "Cleaning", type: "AC Split 0.5-1PK", price: 90000, is_active: true },
      { service: "Cleaning", type: "AC Split 1.5-2.5PK", price: 120000, is_active: true },
    ];
    const pl = buildPriceListFromDB(rows);
    expect(pl.Cleaning["AC Split 0.5-1PK"]).toBe(90000);
    expect(pl.Cleaning["AC Split 1.5-2.5PK"]).toBe(120000);
    expect(pl.Cleaning.default).toBe(85000); // preserved
  });
  it("maps freon notes to freon_* keys", () => {
    const rows = [
      { service: "Material", type: "Freon R22", price: 500000, notes: "freon_R22", is_active: true },
      { service: "Material", type: "Freon R32", price: 600000, notes: "freon_R32", is_active: true },
    ];
    const pl = buildPriceListFromDB(rows);
    expect(pl.freon_R22).toBe(500000);
    expect(pl.freon_R32).toBe(600000);
  });
  it("skips inactive rows", () => {
    const rows = [
      { service: "Cleaning", type: "AC Split 0.5-1PK", price: 99999, is_active: false },
    ];
    const pl = buildPriceListFromDB(rows);
    expect(pl.Cleaning["AC Split 0.5-1PK"]).toBe(85000); // default preserved
  });
});
