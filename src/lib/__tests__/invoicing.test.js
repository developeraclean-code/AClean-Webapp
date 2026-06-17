import { describe, it, expect } from "vitest";
import {
  LINE_CATEGORY,
  categoryOf,
  lineSubtotal,
  summarize,
  checkInvoiceConsistency,
  describeInconsistency,
} from "../invoicing.js";

describe("categoryOf", () => {
  it("jasa & repair → LABOR", () => {
    expect(categoryOf({ keterangan: "jasa" })).toBe(LINE_CATEGORY.LABOR);
    expect(categoryOf({ keterangan: "repair" })).toBe(LINE_CATEGORY.LABOR);
    expect(categoryOf({ keterangan: "JASA" })).toBe(LINE_CATEGORY.LABOR);
  });
  it("barang/freon/null/empty/note → MATERIAL", () => {
    expect(categoryOf({ keterangan: "barang" })).toBe(LINE_CATEGORY.MATERIAL);
    expect(categoryOf({ keterangan: "freon" })).toBe(LINE_CATEGORY.MATERIAL);
    expect(categoryOf({ keterangan: "" })).toBe(LINE_CATEGORY.MATERIAL);
    expect(categoryOf({ keterangan: null })).toBe(LINE_CATEGORY.MATERIAL);
    expect(categoryOf({})).toBe(LINE_CATEGORY.MATERIAL);
    expect(categoryOf({ keterangan: "Aktual: 0.5 kg → dibulatkan 1 kg" })).toBe(LINE_CATEGORY.MATERIAL);
  });
});

describe("lineSubtotal", () => {
  it("pakai subtotal bila ada", () => {
    expect(lineSubtotal({ subtotal: 500000, harga_satuan: 1, jumlah: 1 })).toBe(500000);
  });
  it("hitung dari harga × jumlah bila subtotal kosong", () => {
    expect(lineSubtotal({ harga_satuan: 150000, jumlah: 4 })).toBe(600000);
    expect(lineSubtotal({ subtotal: "", harga_satuan: 100000, jumlah: 2 })).toBe(200000);
    expect(lineSubtotal({ subtotal: null, harga_satuan: 95000, jumlah: 1 })).toBe(95000);
  });
  it("null aman", () => {
    expect(lineSubtotal(null)).toBe(0);
    expect(lineSubtotal({})).toBe(0);
  });
});

describe("summarize", () => {
  it("memisah jasa vs material dan menjumlah total", () => {
    const lines = [
      { nama: "Cleaning 1.5PK", keterangan: "jasa", subtotal: 100000 },
      { nama: "Freon R-410A", keterangan: "barang", subtotal: 500000 },
    ];
    const s = summarize(lines);
    expect(s.labor).toBe(100000);
    expect(s.material).toBe(500000);
    expect(s.lineTotal).toBe(600000);
    expect(s.total).toBe(600000);
  });

  it("kasus barang-drop (0ZU4O): semua barang ikut material & total", () => {
    const lines = [
      { nama: "Biaya Pengecekan AC", keterangan: "jasa", subtotal: 100000 },
      { nama: "Duct Tape", keterangan: "barang", subtotal: 20000 },
      { nama: "Pipa AC 1PK", keterangan: "barang", subtotal: 600000 },
      { nama: "Kuras Vacum Freon R32/R410", keterangan: "barang", subtotal: 650000 },
    ];
    const s = summarize(lines);
    expect(s.labor).toBe(100000);
    expect(s.material).toBe(1270000);
    expect(s.total).toBe(1370000); // BUKAN 100000 seperti bug lama
  });

  it("menerapkan diskon & trade-in pada total (gross labor/material tetap)", () => {
    const lines = [
      { keterangan: "jasa", subtotal: 1000000 },
      { keterangan: "barang", subtotal: 500000 },
    ];
    const s = summarize(lines, { discount: 100000, tradeIn: 250000 });
    expect(s.labor).toBe(1000000);
    expect(s.material).toBe(500000);
    expect(s.lineTotal).toBe(1500000);
    expect(s.total).toBe(1150000);
  });

  it("total tidak pernah negatif", () => {
    expect(summarize([{ keterangan: "jasa", subtotal: 100000 }], { discount: 999999 }).total).toBe(0);
  });

  it("input kosong/invalid → nol", () => {
    expect(summarize(null)).toEqual({ labor: 0, material: 0, lineTotal: 0, total: 0 });
    expect(summarize([])).toEqual({ labor: 0, material: 0, lineTotal: 0, total: 0 });
  });
});

describe("checkInvoiceConsistency", () => {
  it("invoice konsisten → ok", () => {
    const inv = {
      materials_detail: [
        { keterangan: "jasa", subtotal: 100000 },
        { keterangan: "barang", subtotal: 500000 },
      ],
      labor: 100000, material: 500000, total: 600000, discount: 0,
    };
    expect(checkInvoiceConsistency(inv).ok).toBe(true);
  });

  it("menangkap bug barang-drop (material phantom, total kurang)", () => {
    const inv = {
      materials_detail: [{ nama: "Biaya Pengecekan AC", keterangan: "jasa", subtotal: 100000 }],
      labor: 0, material: 1270000, total: 100000, discount: 0,
    };
    const c = checkInvoiceConsistency(inv);
    expect(c.ok).toBe(false);
    expect(c.diff.material).toBe(1270000); // material tersimpan 1.27jt, line item 0
    expect(c.expected.total).toBe(100000);
  });

  it("menghormati diskon", () => {
    const inv = {
      materials_detail: [{ keterangan: "jasa", subtotal: 1200000 }],
      labor: 1200000, material: 0, total: 1080000, discount: 120000,
    };
    expect(checkInvoiceConsistency(inv).ok).toBe(true);
  });

  it("waiver garansi: jasa ditanggung → ok bila waiverAmount diberikan", () => {
    // labor di-waive (jasa gratis garansi), total hanya material
    const inv = {
      materials_detail: [
        { keterangan: "jasa", subtotal: 200000 },
        { keterangan: "barang", subtotal: 500000 },
      ],
      labor: 0, material: 500000, total: 500000, discount: 0,
    };
    expect(checkInvoiceConsistency(inv).ok).toBe(false); // tanpa waiver → flagged
    expect(checkInvoiceConsistency(inv, { waiverAmount: 200000 }).ok).toBe(true);
  });

  it("describeInconsistency kosong saat ok, berisi saat tidak", () => {
    const okInv = { materials_detail: [{ keterangan: "jasa", subtotal: 100000 }], labor: 100000, material: 0, total: 100000 };
    expect(describeInconsistency(checkInvoiceConsistency(okInv), "INV-OK")).toBe("");
    const badInv = { materials_detail: [{ keterangan: "jasa", subtotal: 100000 }], labor: 0, material: 999, total: 50 };
    expect(describeInconsistency(checkInvoiceConsistency(badInv), "INV-BAD")).toContain("INV-BAD");
  });
});
