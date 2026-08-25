import { describe, it, expect } from "vitest";
import { isHarianManagedItem, classifyMaterial } from "../materialRecon.js";

describe("isHarianManagedItem — gerbang anti dobel-potong", () => {
  it("mengenali dari nama seperti biasa", () => {
    expect(isHarianManagedItem({ nama: "Pipa AC Hoda 1PK" })).toBe(true);
    expect(isHarianManagedItem({ nama: "Freon R-32" })).toBe(true);
    expect(isHarianManagedItem({ nama: "Kabel NYM 3x1.5" })).toBe(true);
    expect(isHarianManagedItem({ nama: "Duct Tape Non Lem" })).toBe(false);
  });

  it("KASUS BUG: nama tidak menyebut jenis, tapi jenis eksplisit ada", () => {
    // "A4" hasil Link ke Job dari foto WA — classifyMaterial menebaknya "lain"
    expect(classifyMaterial("A4")).toBe("lain");
    // ...tapi jenis aslinya pipa, jadi harus tetap dikelola Material Harian
    expect(isHarianManagedItem({ nama: "A4", _matType: "pipa" })).toBe(true);
    expect(isHarianManagedItem({ nama: "A4", material_type: "pipa" })).toBe(true);
  });

  it("jenis eksplisit menang atas tebakan nama", () => {
    // nama terdengar pipa tapi jenisnya barang biasa → jangan dikunci gerbang
    expect(isHarianManagedItem({ nama: "Klem Pipa", _matType: "lain" })).toBe(false);
  });

  it("jenis eksplisit kosong → jatuh ke tebakan nama", () => {
    expect(isHarianManagedItem({ nama: "Pipa 1/4", _matType: "" })).toBe(true);
    expect(isHarianManagedItem({ nama: "Bracket", material_type: null })).toBe(false);
  });

  it("aman untuk input kosong", () => {
    expect(isHarianManagedItem({})).toBe(false);
    expect(isHarianManagedItem(null)).toBe(false);
    expect(isHarianManagedItem({ nama: "" })).toBe(false);
  });

  it("membaca inventory_name juga (bentuk baris job_materials_brought)", () => {
    expect(isHarianManagedItem({ inventory_name: "Pipa AC Hoda 2PK" })).toBe(true);
  });
});
