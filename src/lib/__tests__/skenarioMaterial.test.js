import { describe, it, expect } from "vitest";
import { computeDayDeduct, applyAdminOverrides, lineKey, clampUsed } from "../materialDeduct.js";
import { defaultSplit, isSplitComplete, splitToAllocations, belumTerbagi } from "../materialSplit.js";
import { detectKind, qtyEfektif, pisahkanItemLink, namaItem } from "../aiMaterialKind.js";
import { isiUnitOtomatis } from "../tebakUnit.js";
import { isHarianManagedItem } from "../materialRecon.js";

// Simulasi cerita nyata alur material — bukan unit test terpisah, tapi rangkaian
// langkah seperti yang benar-benar terjadi di lapangan.

describe("SKENARIO 18 — satu hari kerja Usaeri: bawa, pakai di 2 job, sisa", () => {
  const pagi = [{ qty: 7, label: "Pipa AC Hoda 1PK", inventory_code: "SKU022", material_type: "pipa",
    units: [{ qty: 7, label: "Roll 1PK-A4", unit_id: "u1" }] }];
  const pulang = [{ qty: 2, label: "Pipa AC Hoda 1PK", inventory_code: "SKU022", material_type: "pipa",
    units: [{ qty: 2, label: "Roll 1PK-A4", unit_id: "u1" }] }];
  const jobs = [
    { id: "JOB-A", customer: "IBU CASSY", date: "2026-08-25" },
    { id: "JOB-B", customer: "PAK RANU", date: "2026-08-25" },
  ];

  const baris = computeDayDeduct(pagi, pulang);
  const l = baris[0];

  it("terpakai dihitung otomatis 7 − 2 = 5, tabung/roll ikut terbawa", () => {
    expect(l.used).toBe(5);
    expect(l.unit_label).toBe("Roll 1PK-A4");
  });

  it("2 job → pembagian TIDAK ditebak, admin wajib mengisi", () => {
    expect(defaultSplit(l.used, jobs)).toEqual({});
    expect(isSplitComplete(l.used, {})).toBe(false);
  });

  it("pembagian belum habis → confirm ditahan & menyebut barisnya", () => {
    const kurang = belumTerbagi([{ key: lineKey(l), label: l.label, used: l.used }],
      { [lineKey(l)]: { "JOB-A": 3 } });
    expect(kurang).toEqual([{ key: lineKey(l), label: "Pipa AC Hoda 1PK", sisa: 2 }]);
  });

  it("dibagi habis → 2 potongan, satu per job, total pas 5", () => {
    const split = { "JOB-A": 3, "JOB-B": 2 };
    expect(isSplitComplete(l.used, split)).toBe(true);
    const alokasi = splitToAllocations(split, jobs);
    expect(alokasi).toHaveLength(2);
    expect(alokasi.reduce((s, a) => s + a.qty, 0)).toBe(5);
    expect(alokasi.map((a) => a.customer)).toEqual(["IBU CASSY", "PAK RANU"]);
  });

  it("kalau hanya 1 job, pembagian terisi penuh sendiri (admin tak perlu mengetik)", () => {
    expect(defaultSplit(l.used, [jobs[0]])).toEqual({ "JOB-A": 5 });
  });
});

describe("SKENARIO 19 — admin mengoreksi angka terpakai", () => {
  const baris = [{ unit_id: "u1", inventory_code: "SKU022", label: "Pipa", material_type: "pipa",
    brought: 7, returned: 2, used: 5 }];

  it("koreksi tercatat lengkap dari-berapa ke-berapa", () => {
    const { lines, changes } = applyAdminOverrides(baris, { "u:u1": 6 });
    expect(lines[0].used).toBe(6);
    expect(lines[0].used_asli).toBe(5);
    expect(changes[0]).toMatchObject({ dari: 5, jadi: 6, brought: 7 });
  });

  it("tidak bisa mengaku pakai lebih banyak dari yang dibawa", () => {
    const { lines } = applyAdminOverrides(baris, { "u:u1": 99 });
    expect(lines[0].used).toBe(7);
    expect(clampUsed(99, 7)).toBe(7);
  });

  it("koreksi ke nol = batal potong stok, tetap tercatat sebagai perubahan", () => {
    const { lines, changes } = applyAdminOverrides(baris, { "u:u1": 0 });
    expect(lines[0].used).toBe(0);
    expect(changes[0]).toMatchObject({ dari: 5, jadi: 0 });
  });
});

describe("SKENARIO 20 — foto grup: sisa, alat, dan tebak tabung", () => {
  it("foto sisa TIDAK boleh terbaca sebagai barang dibawa", () => {
    expect(detectKind({}, "pipa A4 sisa 2 meter kembali kantor")).toBe("sisa");
    expect(detectKind({}, "Kr32 kembali tidak terpakai 4.8kg")).toBe("sisa");
  });

  it("angka yang nyasar ke kolom ukuran tetap terselamatkan", () => {
    expect(qtyEfektif({ qty: 1, size: "4.8kg" })).toBe(4.8);
  });

  it("satu foto berisi pipa + manifold + duct tape → hanya pipa yang boleh di-link", () => {
    const { boleh, tolak } = pisahkanItemLink([
      { type: "pipa", size: "A4", qty: 7 },
      { type: "lain", brand: "Manifold", qty: 1 },
      { type: "lain", brand: "Duct Tape", qty: 2 },
    ]);
    expect(boleh.map(namaItem)).toEqual(["pipa A4"]);
    expect(tolak).toHaveLength(2);
  });

  it("paralon ditolak walau AI menandainya pipa", () => {
    expect(pisahkanItemLink([{ type: "pipa", brand: "paralon" }]).boleh).toHaveLength(0);
  });

  it("tabung/roll terisi otomatis kalau hanya ada satu kandidat", () => {
    const { lines, terisi } = isiUnitOtomatis(
      [{ material_type: "pipa", label: "Pipa", qty: 5 }],
      { pipa: [{ id: "rA", unit_label: "Roll 1PK-A4", inventory_code: "SKU022" }] }, "");
    expect(lines[0].unit_id).toBe("rA");
    expect(lines[0]._unitTebakan).toBe(true);
    expect(terisi).toHaveLength(1);
  });

  it("dua tabung mirip tanpa petunjuk → dikosongkan, admin yang pilih", () => {
    const { lines } = isiUnitOtomatis(
      [{ material_type: "freon", label: "Freon", qty: 0.3 }],
      { freon: [
        { id: "uK", unit_label: "Tabung R32 - K" },
        { id: "uG", unit_label: "Tabung R32 - G" },
      ] }, "freon terpakai 0,3kg");
    expect(lines[0].unit_id).toBeUndefined();
  });

  it("gerbang anti dobel-potong: nama tak menyebut jenis, tapi jenis eksplisit menang", () => {
    expect(isHarianManagedItem({ nama: "A4", _matType: "pipa" })).toBe(true);
    expect(isHarianManagedItem({ nama: "Duct Tape" })).toBe(false);
  });
});
