import { describe, it, expect } from "vitest";
import { extractPhones, samePhone } from "../phone.js";

describe("extractPhones", () => {
  it("menemukan nomor PIC di catatan customer", () => {
    const notes = "PIC kontrak: Bapak Alief Aji (6287820958051). Nomor utama 6285714121850 = nomor perusahaan.";
    expect(extractPhones(notes)).toEqual(["6287820958051", "6285714121850"]);
  });

  it("menormalkan 08xx dan +62 ke bentuk kanonik", () => {
    expect(extractPhones("HP baru 0812-3456-7890")).toEqual(["6281234567890"]);
    expect(extractPhones("WA +62 878 2095 8051")).toEqual(["6287820958051"]);
  });

  it("tidak menjaring potongan alamat / angka pendek", () => {
    expect(extractPhones("Jl. Irigasi RT 014 RW 003 Kav J No.1 Banten 42185")).toEqual([]);
    expect(extractPhones("unit 15 AC, interval 3 bulan")).toEqual([]);
  });

  it("aman untuk input kosong / null", () => {
    expect(extractPhones("")).toEqual([]);
    expect(extractPhones(null)).toEqual([]);
    expect(extractPhones(undefined)).toEqual([]);
  });

  it("tidak menduplikasi nomor yang sama", () => {
    expect(extractPhones("0878-2095-8051 atau 6287820958051")).toEqual(["6287820958051"]);
  });

  it("hasilnya cocok dengan samePhone untuk nomor yang diketik admin", () => {
    const found = extractPhones("cadangan: 6287820958051");
    expect(found.some(p => samePhone(p, "087820958051"))).toBe(true);
    expect(found.some(p => samePhone(p, "6285714121850"))).toBe(false);
  });
});
