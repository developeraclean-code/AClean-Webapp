import { describe, it, expect } from "vitest";
import { defaultSplit, splitTotal, splitRemainder, isSplitComplete, splitToAllocations, belumTerbagi } from "../materialSplit.js";

const jobs1 = [{ id: "JOB-A", customer: "IBU CASSY", date: "2026-08-25" }];
const jobs2 = [
  { id: "JOB-A", customer: "IBU CASSY", date: "2026-08-25" },
  { id: "JOB-B", customer: "PAK RANU", date: "2026-08-25" },
];

describe("defaultSplit", () => {
  it("satu job → langsung terisi penuh (tidak menambah kerja admin)", () => {
    expect(defaultSplit(30, jobs1)).toEqual({ "JOB-A": 30 });
  });
  it("lebih dari satu job → dikosongkan, admin yang membagi", () => {
    expect(defaultSplit(30, jobs2)).toEqual({});
  });
  it("tanpa job atau qty nol → kosong", () => {
    expect(defaultSplit(30, [])).toEqual({});
    expect(defaultSplit(0, jobs1)).toEqual({});
  });
});

describe("splitRemainder & isSplitComplete", () => {
  it("menghitung sisa yang belum dibagi", () => {
    expect(splitRemainder(30, { "JOB-A": 20 })).toBe(10);
    expect(splitRemainder(30, { "JOB-A": 20, "JOB-B": 10 })).toBe(0);
  });
  it("kelebihan membagi menghasilkan sisa negatif", () => {
    expect(splitRemainder(30, { "JOB-A": 25, "JOB-B": 10 })).toBe(-5);
    expect(isSplitComplete(30, { "JOB-A": 25, "JOB-B": 10 })).toBe(false);
  });
  it("belum habis dibagi = belum boleh confirm", () => {
    expect(isSplitComplete(30, { "JOB-A": 20 })).toBe(false);
    expect(isSplitComplete(30, {})).toBe(false);
  });
  it("baris terpakai 0 selalu sah", () => {
    expect(isSplitComplete(0, {})).toBe(true);
  });
  it("tahan pembulatan desimal", () => {
    expect(isSplitComplete(0.3, { a: 0.1, b: 0.2 })).toBe(true);
    expect(isSplitComplete(7, { a: 2.33, b: 2.33, c: 2.34 })).toBe(true);
  });
  it("selisih nyata tetap ditolak", () => {
    expect(isSplitComplete(7, { a: 2.3, b: 2.3, c: 2.3 })).toBe(false);
  });
});

describe("splitToAllocations", () => {
  it("membawa customer & tanggal job untuk transaksi stok", () => {
    expect(splitToAllocations({ "JOB-A": 20, "JOB-B": 10 }, jobs2)).toEqual([
      { job_id: "JOB-A", qty: 20, customer: "IBU CASSY", job_date: "2026-08-25" },
      { job_id: "JOB-B", qty: 10, customer: "PAK RANU", job_date: "2026-08-25" },
    ]);
  });
  it("membuang alokasi nol supaya tidak lahir transaksi kosong", () => {
    expect(splitToAllocations({ "JOB-A": 20, "JOB-B": 0, "JOB-C": "" }, jobs2)).toEqual([
      { job_id: "JOB-A", qty: 20, customer: "IBU CASSY", job_date: "2026-08-25" },
    ]);
  });
  it("job yang tidak dikenal tetap ditulis, tanpa customer", () => {
    expect(splitToAllocations({ "JOB-X": 5 }, jobs2)).toEqual([
      { job_id: "JOB-X", qty: 5, customer: null, job_date: null },
    ]);
  });
  it("aman untuk input kosong", () => {
    expect(splitToAllocations(null, null)).toEqual([]);
    expect(splitTotal(null)).toBe(0);
  });
});

describe("belumTerbagi", () => {
  const lines = [
    { key: "u:1", label: "Pipa 1/4", used: 30 },
    { key: "u:2", label: "Freon R32", used: 1.5 },
    { key: "u:3", label: "Kabel", used: 0 },
  ];
  it("menyebut baris mana yang belum beres beserta sisanya", () => {
    const hasil = belumTerbagi(lines, { "u:1": { "JOB-A": 30 }, "u:2": { "JOB-A": 1 } });
    expect(hasil).toEqual([{ key: "u:2", label: "Freon R32", sisa: 0.5 }]);
  });
  it("semua beres → daftar kosong (boleh confirm)", () => {
    expect(belumTerbagi(lines, { "u:1": { "JOB-A": 30 }, "u:2": { "JOB-A": 1.5 } })).toEqual([]);
  });
  it("baris terpakai 0 tidak pernah menghalangi", () => {
    expect(belumTerbagi([{ key: "u:3", label: "Kabel", used: 0 }], {})).toEqual([]);
  });
});
