import { describe, it, expect } from "vitest";
import { clientCleaningUnitPrice, unitTipeToCode, unitPkNumber, normalizeAcCode } from "../maintClientPrice.js";

const row = (over = {}) => ({
  service_type: "Cuci Rutin", ac_type: "split", capacity_pk: 1, unit_price: 95000, ...over,
});

describe("unitTipeToCode", () => {
  it("memetakan semua varian tipe laporan ke kode registry", () => {
    expect(unitTipeToCode("AC Split 1PK")).toBe("split");
    expect(unitTipeToCode("AC Cassette 3PK")).toBe("cassette");
    expect(unitTipeToCode("AC Floor Standing 2.5PK")).toBe("standing");
    expect(unitTipeToCode("AC Split Duct 4PK")).toBe("floor");
    expect(unitTipeToCode("")).toBe(null);
    expect(unitTipeToCode(null)).toBe(null);
  });
});

describe("unitPkNumber", () => {
  it("prioritas kolom pk, fallback angka di tipe", () => {
    expect(unitPkNumber({ pk: "1.5PK", tipe: "AC Split 2PK" })).toBe(1.5);
    expect(unitPkNumber({ tipe: "AC Split 2PK" })).toBe(2);
    expect(unitPkNumber({ pk: "2,5PK" })).toBe(2.5); // koma desimal
    expect(unitPkNumber({})).toBe(null);
  });
});

describe("normalizeAcCode", () => {
  it("menyeragamkan alias ducted/floor/duct → floor (Split Duct)", () => {
    expect(normalizeAcCode("ducted")).toBe("floor");
    expect(normalizeAcCode("floor")).toBe("floor");
    expect(normalizeAcCode("Split")).toBe("split");
    expect(normalizeAcCode("apapun")).toBe(null);
    expect(normalizeAcCode(null)).toBe(null);
  });
});

describe("clientCleaningUnitPrice (STRICT tipe+PK)", () => {
  const unit = { tipe: "AC Split 1PK", pk: "1PK" };

  it("match persis tipe & PK → pakai harga deal", () => {
    expect(clientCleaningUnitPrice([row()], unit)).toBe(95000);
  });

  it("service_type varian cleaning tetap match (Cuci Besar / Cleaning)", () => {
    expect(clientCleaningUnitPrice([row({ service_type: "Cuci Besar" })], unit)).toBe(95000);
    expect(clientCleaningUnitPrice([row({ service_type: "Cleaning" })], unit)).toBe(95000);
  });

  it("baris non-cleaning diabaikan", () => {
    expect(clientCleaningUnitPrice([row({ service_type: "Perbaikan" })], unit)).toBe(null);
    expect(clientCleaningUnitPrice([row({ service_type: "Isi Freon" })], unit)).toBe(null);
  });

  it("wildcard TIDAK dipakai: capacity_pk atau ac_type kosong → null", () => {
    expect(clientCleaningUnitPrice([row({ capacity_pk: null })], unit)).toBe(null);
    expect(clientCleaningUnitPrice([row({ ac_type: null })], unit)).toBe(null);
    expect(clientCleaningUnitPrice([row({ ac_type: "" })], unit)).toBe(null);
  });

  it("PK beda → null (fallback global oleh caller)", () => {
    expect(clientCleaningUnitPrice([row()], { tipe: "AC Split 2PK", pk: "2PK" })).toBe(null);
  });

  it("tipe beda → null; alias ducted match Split Duct", () => {
    expect(clientCleaningUnitPrice([row({ ac_type: "cassette" })], unit)).toBe(null);
    expect(clientCleaningUnitPrice(
      [row({ ac_type: "ducted", capacity_pk: 4, unit_price: 250000 })],
      { tipe: "AC Split Duct 4PK", pk: "4PK" }
    )).toBe(250000);
  });

  it("capacity_pk desimal match PK unit desimal", () => {
    expect(clientCleaningUnitPrice(
      [row({ ac_type: "standing", capacity_pk: 2.5, unit_price: 300000 })],
      { tipe: "AC Floor Standing 2.5PK", pk: "2.5PK" }
    )).toBe(300000);
  });

  it("harga 0/negatif atau input kosong → null", () => {
    expect(clientCleaningUnitPrice([row({ unit_price: 0 })], unit)).toBe(null);
    expect(clientCleaningUnitPrice([], unit)).toBe(null);
    expect(clientCleaningUnitPrice(null, unit)).toBe(null);
    expect(clientCleaningUnitPrice([row()], null)).toBe(null);
    expect(clientCleaningUnitPrice([row()], { tipe: "" })).toBe(null);
  });

  it("baris pertama yang match dipakai", () => {
    const prices = [row({ unit_price: 90000 }), row({ unit_price: 80000 })];
    expect(clientCleaningUnitPrice(prices, unit)).toBe(90000);
  });
});
