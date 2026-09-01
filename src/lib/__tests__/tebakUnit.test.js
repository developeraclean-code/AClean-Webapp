import { describe, it, expect } from "vitest";
import { tebakUnit, isiUnitOtomatis } from "../tebakUnit.js";

const K = { id: "uK", unit_label: "Tabung R32 - K", inventory_code: "SKU009" };
const G = { id: "uG", unit_label: "Tanung R32 - G", inventory_code: "SKU009" };
const rollA = { id: "rA", unit_label: "Roll 1PK-A4", inventory_code: "SKU022" };

describe("tebakUnit", () => {
  it("satu kandidat → langsung dipilih", () => {
    expect(tebakUnit({ material_type: "pipa" }, [rollA], "")).toBe("rA");
  });

  it("banyak kandidat → dipilih lewat kata pembeda di laporan", () => {
    // caption nyata: "K R32 terpakai di ibu cassy 0,3 kg"
    expect(tebakUnit({ label: "Freon" }, [K, G], "K R32 terpakai di ibu cassy 0,3 kg")).toBe("uK");
  });

  it("tidak ada petunjuk → menyerah, biar admin pilih", () => {
    expect(tebakUnit({ label: "Freon" }, [K, G], "freon terpakai 0,3kg")).toBe(null);
  });

  it("petunjuk mengarah ke dua unit sekaligus → menyerah", () => {
    // Label ditulis konsisten, jadi pembedanya benar-benar hanya "K" vs "G".
    const Ka = { id: "uKa", unit_label: "Tabung R32 - K" };
    const Ga = { id: "uGa", unit_label: "Tabung R32 - G" };
    expect(tebakUnit({ label: "Freon" }, [Ka, Ga], "tabung K dan G dibawa")).toBe(null);
  });

  it("salah ketik di label unit ikut jadi pembeda — konsekuensi yang disengaja", () => {
    // Dulu data nyata: satu tabung tertulis "Tabung", satunya "Tanung" — sampai
    // salah ketiknya dirapikan 1 Sep 2026 (migrasi 161). Perilakunya tetap diuji:
    // label yang tidak konsisten BISA jadi kata pembeda, dan itu risiko yang perlu
    // disadari kalau ada salah ketik baru. Tetap butuh kata itu MUNCUL di laporan,
    // jadi tidak asal tebak.
    expect(tebakUnit({ label: "Freon" }, [K, G], "tabung K dan G dibawa")).toBe("uK");
    expect(tebakUnit({ label: "Freon" }, [K, G], "freon dibawa")).toBe(null);
  });

  it("unit_id yang sudah ada tidak pernah ditimpa", () => {
    expect(tebakUnit({ unit_id: "sudah-ada" }, [K, G], "K R32")).toBe("sudah-ada");
  });

  it("tanpa kandidat → null", () => {
    expect(tebakUnit({}, [], "apa saja")).toBe(null);
    expect(tebakUnit({}, null, "")).toBe(null);
  });
});

describe("isiUnitOtomatis", () => {
  const unitsByType = { freon: [K, G], pipa: [rollA], kabel: [] };

  it("mengisi baris tracked yang jelas & menandainya sebagai tebakan", () => {
    const { lines, terisi } = isiUnitOtomatis(
      [{ material_type: "pipa", label: "Pipa", qty: 5 }], unitsByType, "");
    expect(lines[0].unit_id).toBe("rA");
    expect(lines[0].inventory_code).toBe("SKU022");
    expect(lines[0]._unitTebakan).toBe(true);
    expect(terisi).toEqual([{ label: "Pipa", unit_label: "Roll 1PK-A4" }]);
  });

  it("baris yang ambigu dibiarkan kosong", () => {
    const { lines, terisi } = isiUnitOtomatis(
      [{ material_type: "freon", label: "Freon", qty: 0.3 }], unitsByType, "freon 0,3kg");
    expect(lines[0].unit_id).toBeUndefined();
    expect(terisi).toEqual([]);
  });

  it("baris non-tracked tidak disentuh", () => {
    const asli = { material_type: "lain", label: "Duct Tape", qty: 1 };
    const { lines } = isiUnitOtomatis([asli], unitsByType, "");
    expect(lines[0]).toBe(asli);
  });

  it("baris yang sudah punya unit tidak diubah", () => {
    const asli = { material_type: "pipa", label: "Pipa", unit_id: "pilihan-admin" };
    const { lines, terisi } = isiUnitOtomatis([asli], unitsByType, "");
    expect(lines[0]).toBe(asli);
    expect(terisi).toEqual([]);
  });

  it("aman untuk input kosong", () => {
    expect(isiUnitOtomatis(null, null, null).lines).toEqual([]);
  });
});
