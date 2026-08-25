import { describe, it, expect } from "vitest";
import { applyAdminOverrides, clampUsed, lineKey, computeDayDeduct } from "../materialDeduct.js";

const baris = (o) => ({ unit_id: null, inventory_code: "PIPA14", label: "Pipa 1/4", material_type: "pipa", brought: 50, returned: 20, used: 30, ...o });

describe("clampUsed", () => {
  it("tidak boleh melebihi yang dibawa", () => {
    expect(clampUsed(80, 50)).toBe(50);
    expect(clampUsed(50, 50)).toBe(50);
  });
  it("tidak boleh minus", () => {
    expect(clampUsed(-5, 50)).toBe(0);
  });
  it("input kosong / bukan angka dianggap nol", () => {
    expect(clampUsed("", 50)).toBe(0);
    expect(clampUsed("abc", 50)).toBe(0);
    expect(clampUsed(null, 50)).toBe(0);
  });
  it("membulatkan 2 desimal", () => {
    expect(clampUsed(12.345, 50)).toBe(12.35);
  });
});

describe("applyAdminOverrides", () => {
  it("mengoreksi terpakai dan mencatat perubahannya", () => {
    const base = [baris({ unit_id: "u1" })];
    const { lines, changes } = applyAdminOverrides(base, { "u:u1": 42 });
    expect(lines[0].used).toBe(42);
    expect(lines[0].used_asli).toBe(30);
    expect(lines[0].dikoreksi).toBe(true);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ dari: 30, jadi: 42, label: "Pipa 1/4" });
  });

  it("koreksi yang sama dengan angka asli tidak dianggap perubahan", () => {
    const { lines, changes } = applyAdminOverrides([baris({ unit_id: "u1" })], { "u:u1": 30 });
    expect(changes).toHaveLength(0);
    expect(lines[0].dikoreksi).toBeUndefined();
  });

  it("dipagari maksimal sebanyak yang dibawa", () => {
    const { lines, changes } = applyAdminOverrides([baris({ unit_id: "u1", brought: 50 })], { "u:u1": 999 });
    expect(lines[0].used).toBe(50);
    expect(changes[0].jadi).toBe(50);
  });

  it("baris tanpa koreksi tidak disentuh sama sekali", () => {
    const base = [baris({ unit_id: "u1" }), baris({ unit_id: "u2", label: "Pipa 3/8", used: 10 })];
    const { lines, changes } = applyAdminOverrides(base, { "u:u1": 40 });
    expect(lines[1]).toBe(base[1]);
    expect(changes).toHaveLength(1);
  });

  it("bisa menaikkan baris yang semula nol", () => {
    const { lines, changes } = applyAdminOverrides([baris({ unit_id: "u1", returned: 50, used: 0 })], { "u:u1": 8 });
    expect(lines[0].used).toBe(8);
    expect(changes[0]).toMatchObject({ dari: 0, jadi: 8 });
  });

  it("bisa menurunkan ke nol (batal potong stok)", () => {
    const { lines, changes } = applyAdminOverrides([baris({ unit_id: "u1" })], { "u:u1": 0 });
    expect(lines[0].used).toBe(0);
    expect(changes[0]).toMatchObject({ dari: 30, jadi: 0 });
  });

  it("aman untuk input kosong", () => {
    expect(applyAdminOverrides([], {}).lines).toEqual([]);
    expect(applyAdminOverrides(null, null).changes).toEqual([]);
  });

  it("kunci baris cocok dengan yang dipakai computeDayDeduct", () => {
    const pagi = [{ material_type: "pipa", inventory_code: "PIPA14", label: "Pipa 1/4", units: [{ unit_id: "u9", qty: 50 }] }];
    const pulang = [{ material_type: "pipa", inventory_code: "PIPA14", label: "Pipa 1/4", units: [{ unit_id: "u9", qty: 18 }] }];
    const base = computeDayDeduct(pagi, pulang);
    expect(base[0].used).toBe(32);
    const { lines } = applyAdminOverrides(base, { [lineKey(base[0])]: 35 });
    expect(lines[0].used).toBe(35);
  });
});
