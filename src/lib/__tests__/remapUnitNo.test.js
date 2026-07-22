// Guard: penggeseran referensi unit_no saat satu unit dihapus dari laporan.
// Bug yang dicegah (review 20 Jul 2026): foto & centang cuci sudah di-remap, tapi
// baris jasa/barang belum → "Ganti Kapasitor untuk Unit 3" diam-diam menempel ke
// unit yang tadinya Unit 4. Salah atribusi seperti ini tak memunculkan error apa pun.
import { describe, it, expect } from "vitest";
import { remapUnitNo, remapUnitNoList } from "../laporanConstants.js";

describe("remapUnitNo", () => {
  it("referensi ke unit yang DIHAPUS jadi null (umum), bukan menempel ke unit lain", () => {
    expect(remapUnitNo(2, 2)).toBeNull();
  });

  it("unit SETELAH yang dihapus digeser turun 1", () => {
    expect(remapUnitNo(3, 2)).toBe(2);
    expect(remapUnitNo(4, 2)).toBe(3);
  });

  it("unit SEBELUM yang dihapus tidak berubah", () => {
    expect(remapUnitNo(1, 2)).toBe(1);
  });

  it("null/undefined tetap null — baris 'umum' tidak ikut tergeser", () => {
    expect(remapUnitNo(null, 1)).toBeNull();
    expect(remapUnitNo(undefined, 1)).toBeNull();
  });

  it("skenario nyata: hapus Unit 1 dari 4 unit", () => {
    // Baris jasa untuk unit 1..4 + satu baris umum
    const baris = [1, 2, 3, 4, null].map(n => remapUnitNo(n, 1));
    expect(baris).toEqual([null, 1, 2, 3, null]);
  });
});

describe("remapUnitNoList (centang cuci)", () => {
  it("buang unit terhapus, geser sisanya", () => {
    expect(remapUnitNoList([1, 2, 3, 4], 2)).toEqual([1, 2, 3]);
  });
  it("aman untuk list kosong/null", () => {
    expect(remapUnitNoList([], 1)).toEqual([]);
    expect(remapUnitNoList(null, 1)).toEqual([]);
  });
  it("hapus unit terakhir tidak menggeser apa pun", () => {
    expect(remapUnitNoList([1, 2, 3], 3)).toEqual([1, 2]);
  });
});
