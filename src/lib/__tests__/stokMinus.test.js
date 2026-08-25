import { describe, it, expect } from "vitest";
import { hitungKekuranganStok, pesanKekuranganStok } from "../materialDeduct.js";

describe("hitungKekuranganStok", () => {
  it("menangkap klaim yang melebihi isi roll — kasus simulasi 15", () => {
    const kurang = hitungKekuranganStok(
      [{ unit_id: "u1", label: "Pipa AC Hoda 1PK", unit_label: "Roll 1PK-A4", used: 30 }],
      { u1: 2 });
    expect(kurang).toHaveLength(1);
    expect(kurang[0]).toMatchObject({ diminta: 30, tersedia: 2, selisih: 28 });
  });

  it("pas-pasan (diminta = tersedia) tetap boleh", () => {
    expect(hitungKekuranganStok([{ unit_id: "u1", used: 5 }], { u1: 5 })).toEqual([]);
  });

  it("beberapa baris pada unit yang SAMA dijumlahkan dulu", () => {
    // 3 + 3 dari roll berisi 5 → kurang 1, walau tiap barisnya sendiri muat
    const kurang = hitungKekuranganStok(
      [{ unit_id: "u1", used: 3 }, { unit_id: "u1", used: 3 }], { u1: 5 });
    expect(kurang[0]).toMatchObject({ diminta: 6, tersedia: 5, selisih: 1 });
  });

  it("baris tanpa unit (material non-tracked) diabaikan", () => {
    expect(hitungKekuranganStok([{ unit_id: null, used: 99 }], {})).toEqual([]);
  });

  it("unit yang tidak dikenal dianggap stok 0", () => {
    expect(hitungKekuranganStok([{ unit_id: "hantu", used: 1 }], {})[0].tersedia).toBe(0);
  });

  it("qty nol atau kosong tidak dihitung", () => {
    expect(hitungKekuranganStok([{ unit_id: "u1", used: 0 }], { u1: 0 })).toEqual([]);
  });

  it("membaca qty juga (bentuk baris draft AI)", () => {
    expect(hitungKekuranganStok([{ unit_id: "u1", qty: 4 }], { u1: 1 })[0].selisih).toBe(3);
  });

  it("aman untuk input kosong", () => {
    expect(hitungKekuranganStok(null, null)).toEqual([]);
  });
});

describe("pesanKekuranganStok", () => {
  it("menyebut unit, diminta, tersedia, dan kurangnya", () => {
    const pesan = pesanKekuranganStok([
      { unit_label: "Roll 1PK-A4", diminta: 30, tersedia: 2, selisih: 28 },
    ]);
    expect(pesan).toBe("Roll 1PK-A4: diminta 30, tersedia 2 (kurang 28)");
  });
  it("kosong → string kosong", () => {
    expect(pesanKekuranganStok([])).toBe("");
  });
});
