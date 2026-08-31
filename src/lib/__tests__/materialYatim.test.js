import { describe, it, expect } from "vitest";
import { computeDayDeduct, deductLines, usedByCode, barisHanyaPulang, pesanHanyaPulang } from "../materialDeduct.js";

// Bentuk item persis seperti yang tersimpan di teknisi_material_checkout.items.
const pipa = (qty, unitId = "u-pipa", label = "Roll 1PK - A6") => ({
  qty, label: "Pipa AC Hoda 1PK", satuan: "meter", material_type: "pipa",
  inventory_code: "SKU022", units: [{ qty, unit_id: unitId, label }],
});
const freon = (qty, unitId = "u-freon", label = "Tabung R32 - S") => ({
  qty, label: "Freon R-32", satuan: "kg", material_type: "freon",
  inventory_code: "SKU009",
  units: [{ qty, unit_id: unitId, label }],
  weight_kg: [{ kg: qty, unit_id: unitId, label }],
});

describe("barang yang hanya ada di sesi pulang", () => {
  // Kasus nyata Bu Vessa, 29 Agu 2026: sesi pagi Mulyadi hanya pipa 10 m,
  // freon 2,9 kg baru ditulis di sesi pulang → dulu lenyap tanpa jejak.
  const pagi   = [pipa(10)];
  const pulang = [pipa(3), freon(2.9)];

  it("sekarang diterbitkan sebagai baris bertanda, bukan dibuang", () => {
    const lines = computeDayDeduct(pagi, pulang);
    expect(lines).toHaveLength(2);
    const f = lines.find((l) => l.material_type === "freon");
    expect(f).toBeDefined();
    expect(f.hanyaPulang).toBe(true);
    expect(f.brought).toBe(0);
    expect(f.returned).toBe(2.9);
    expect(f.used).toBe(0);
  });

  it("membawa serta label unit fisiknya supaya peringatan bisa menyebut tabung mana", () => {
    const f = computeDayDeduct(pagi, pulang).find((l) => l.hanyaPulang);
    expect(f.unit_label).toBe("Tabung R32 - S");
  });

  it("baris normal tetap dihitung benar dan TIDAK ikut bertanda", () => {
    const p = computeDayDeduct(pagi, pulang).find((l) => l.material_type === "pipa");
    expect(p.used).toBe(7);
    expect(p.hanyaPulang).toBe(false);
  });

  it("tidak mengubah apa yang dipotong — used 0 tetap tersaring", () => {
    expect(deductLines(pagi, pulang)).toHaveLength(1);
    expect(usedByCode(pagi, pulang)).toEqual({ SKU022: 7 });
  });

  it("barisHanyaPulang & pesannya menyebut unit dan qty", () => {
    const lines = computeDayDeduct(pagi, pulang);
    expect(barisHanyaPulang(lines)).toHaveLength(1);
    const pesan = pesanHanyaPulang(lines);
    expect(pesan).toContain("Tabung R32 - S");
    expect(pesan).toContain("2.9");
  });

  it("hari yang normal tidak memunculkan peringatan palsu", () => {
    const lines = computeDayDeduct([pipa(10), freon(4)], [pipa(3), freon(1.1)]);
    expect(barisHanyaPulang(lines)).toHaveLength(0);
    expect(pesanHanyaPulang(lines)).toBe("");
  });

  it("dibawa tapi tidak dilaporkan pulang = terpakai penuh (perilaku lama tetap)", () => {
    const lines = computeDayDeduct([freon(4)], []);
    expect(lines).toHaveLength(1);
    expect(lines[0].used).toBe(4);
    expect(lines[0].hanyaPulang).toBe(false);
  });

  it("sesi pagi kosong sama sekali: semua baris pulang bertanda", () => {
    const lines = computeDayDeduct([], [pipa(3), freon(2.9)]);
    expect(barisHanyaPulang(lines)).toHaveLength(2);
    expect(deductLines([], [pipa(3), freon(2.9)])).toHaveLength(0);
  });
});
