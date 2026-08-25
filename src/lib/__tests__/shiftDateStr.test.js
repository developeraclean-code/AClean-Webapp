import { describe, it, expect } from "vitest";
import { shiftDateStr, shortDateID } from "../dateTime.js";

describe("shiftDateStr", () => {
  it("mundur beberapa hari", () => {
    expect(shiftDateStr("2026-08-25", -7)).toBe("2026-08-18");
    expect(shiftDateStr("2026-08-25", -1)).toBe("2026-08-24");
  });
  it("melewati batas bulan dan tahun", () => {
    expect(shiftDateStr("2026-09-03", -7)).toBe("2026-08-27");
    expect(shiftDateStr("2026-01-02", -7)).toBe("2025-12-26");
  });
  it("menghitung tahun kabisat dengan benar", () => {
    expect(shiftDateStr("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftDateStr("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("nol hari = tanggal tetap", () => {
    expect(shiftDateStr("2026-08-25", 0)).toBe("2026-08-25");
  });
  it("input tidak valid dikembalikan apa adanya", () => {
    expect(shiftDateStr("", -7)).toBe("");
    expect(shiftDateStr(null, -7)).toBe(null);
    expect(shiftDateStr("bukan-tanggal", -7)).toBe("bukan-tanggal");
  });
});

describe("shortDateID", () => {
  it("tahun disembunyikan bila sama dengan acuan", () => {
    expect(shortDateID("2026-08-22", "2026-08-25")).toBe("22 Agu");
  });
  it("tahun ditulis bila beda dari acuan", () => {
    expect(shortDateID("2025-12-31", "2026-08-25")).toBe("31 Des 2025");
  });
  it("input tidak valid tidak bikin error", () => {
    expect(shortDateID("", "2026-08-25")).toBe("");
  });
});
