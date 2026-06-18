import { describe, it, expect } from "vitest";
import {
  LINE_CATEGORY,
  BILLING_CATEGORY,
  categoryOf,
  lineCategory,
  lineSubtotal,
  summarize,
  checkInvoiceConsistency,
  describeInconsistency,
  normalizeLine,
  buildWarrantyDiscountLine,
  buildFreonAdjustmentLine,
  auditInvoices,
  categoryFromCatalog,
  auditQuoteDeviation,
  computePph23,
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
    const z = summarize(null);
    expect(z.labor).toBe(0);
    expect(z.material).toBe(0);
    expect(z.total).toBe(0);
    expect(summarize([]).total).toBe(0);
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

// ── P1: kategori billing eksplisit ───────────────────────────────────────────
describe("P1 lineCategory", () => {
  it("prioritaskan category eksplisit", () => {
    expect(lineCategory({ category: "FREON", keterangan: "jasa" })).toBe(BILLING_CATEGORY.FREON);
    expect(lineCategory({ category: "part" })).toBe(BILLING_CATEGORY.PART);
  });
  it("biaya pengecekan/transport → FEE", () => {
    expect(lineCategory({ nama: "Biaya Pengecekan AC", keterangan: "jasa" })).toBe(BILLING_CATEGORY.FEE);
    expect(lineCategory({ nama: "Biaya Transport Bila 1 Unit", keterangan: "jasa" })).toBe(BILLING_CATEGORY.FEE);
  });
  it("jasa biasa → LABOR; barang → PART; freon → FREON", () => {
    expect(lineCategory({ nama: "Cleaning 1.5PK", keterangan: "jasa" })).toBe(BILLING_CATEGORY.LABOR);
    expect(lineCategory({ nama: "Pipa AC", keterangan: "barang" })).toBe(BILLING_CATEGORY.PART);
    expect(lineCategory({ nama: "Kuras Vacum Freon R32/R410", keterangan: "barang" })).toBe(BILLING_CATEGORY.FREON);
  });
  it("freon-as-jasa tetap LABOR (vacum saat install)", () => {
    expect(lineCategory({ nama: "Vacum + isi Freon R32", keterangan: "jasa" })).toBe(BILLING_CATEGORY.LABOR);
  });
  it("subtotal negatif / keterangan diskon → DISCOUNT", () => {
    expect(lineCategory({ nama: "Voucher", subtotal: -50000 })).toBe(BILLING_CATEGORY.DISCOUNT);
    expect(lineCategory({ keterangan: "diskon", subtotal: 50000 })).toBe(BILLING_CATEGORY.DISCOUNT);
  });
  it("categoryOf (kasar) konsisten: FEE→LABOR, FREON→MATERIAL", () => {
    expect(categoryOf({ nama: "Biaya Pengecekan AC", keterangan: "jasa" })).toBe(LINE_CATEGORY.LABOR);
    expect(categoryOf({ nama: "Freon R-410A", keterangan: "barang" })).toBe(LINE_CATEGORY.MATERIAL);
  });
});

describe("P1 categoryFromCatalog", () => {
  const catalog = [
    { type: "Cleaning AC Split 1.5-2.5PK", category: "Jasa" },
    { type: "Biaya Pengecekan AC", category: "Jasa" },
    { type: "Pipa AC Hoda 1PK", category: "Barang" },
    { type: "Freon R-410A", category: "Barang" },
    { type: "Freon R32 Refill", category: "Freon Gas" },
  ];
  it("Jasa → LABOR, kecuali fee → FEE", () => {
    expect(categoryFromCatalog("Cleaning AC Split 1.5-2.5PK", catalog)).toBe(BILLING_CATEGORY.LABOR);
    expect(categoryFromCatalog("Biaya Pengecekan AC", catalog)).toBe(BILLING_CATEGORY.FEE);
  });
  it("Barang → PART, kecuali nama freon → FREON", () => {
    expect(categoryFromCatalog("Pipa AC Hoda 1PK", catalog)).toBe(BILLING_CATEGORY.PART);
    expect(categoryFromCatalog("Freon R-410A", catalog)).toBe(BILLING_CATEGORY.FREON);
  });
  it("category Freon* → FREON", () => {
    expect(categoryFromCatalog("Freon R32 Refill", catalog)).toBe(BILLING_CATEGORY.FREON);
  });
  it("match fuzzy via includes (nama invoice ada embel-embel lokasi)", () => {
    expect(categoryFromCatalog("Cleaning AC Split 1.5-2.5PK (Kamar utama)", catalog)).toBe(BILLING_CATEGORY.LABOR);
  });
  it("tak ada di katalog → fallback heuristik nama", () => {
    expect(categoryFromCatalog("Barang Aneh XYZ", catalog)).toBe(BILLING_CATEGORY.PART);
    expect(categoryFromCatalog("Freon R-22 manual", [])).toBe(BILLING_CATEGORY.FREON);
  });
});

describe("P1 normalizeLine", () => {
  it("set category eksplisit", () => {
    expect(normalizeLine({ nama: "Pipa", keterangan: "barang" }).category).toBe("PART");
  });
  it("pindahkan catatan bebas dari keterangan ke note + standarkan keterangan", () => {
    const n = normalizeLine({ nama: "Freon R-410A", keterangan: "Aktual: 0.5 kg → dibulatkan 1 kg", subtotal: 450000 });
    expect(n.note).toBe("Aktual: 0.5 kg → dibulatkan 1 kg");
    expect(n.keterangan).toBe("barang"); // tag kategori lama
    expect(n.category).toBe("FREON");
  });
  it("keterangan tag valid tidak diubah", () => {
    expect(normalizeLine({ nama: "Cleaning", keterangan: "jasa" }).keterangan).toBe("jasa");
  });
});

// ── P3: garansi sbg baris diskon + freon true-up ─────────────────────────────
describe("P3 baris diskon & freon", () => {
  it("buildWarrantyDiscountLine: negatif, DISCOUNT, total konsisten tanpa waiver", () => {
    const lines = [
      { nama: "Jasa servis", keterangan: "jasa", subtotal: 200000 },
      { nama: "Sparepart", keterangan: "barang", subtotal: 500000 },
      buildWarrantyDiscountLine(200000),
    ];
    const s = summarize(lines);
    expect(s.labor).toBe(200000);
    expect(s.material).toBe(500000);
    expect(s.lineDiscount).toBe(200000);
    expect(s.total).toBe(500000); // jasa di-waive lewat baris diskon
    // Model: kolom `discount` = member/manual saja; waiver garansi = baris DISCOUNT.
    // labor disimpan GROSS, discount kolom = 0 → konsisten TANPA waiverAmount.
    const inv = { materials_detail: lines, labor: 200000, material: 500000, discount: 0, total: 500000 };
    expect(checkInvoiceConsistency(inv).ok).toBe(true);
  });
  it("buildFreonAdjustmentLine: delta minus = diskon, plus = freon", () => {
    expect(buildFreonAdjustmentLine(-150000).category).toBe("DISCOUNT");
    expect(buildFreonAdjustmentLine(150000).category).toBe("FREON");
    const s = summarize([{ keterangan: "jasa", subtotal: 100000 }, buildFreonAdjustmentLine(-150000)]);
    expect(s.total).toBe(0); // 100rb - 150rb, clamp 0
  });
});

// ── P2: audit massal ─────────────────────────────────────────────────────────
describe("P2 auditInvoices", () => {
  it("hanya kembalikan yang melanggar, urut Δ terbesar", () => {
    const invoices = [
      { id: "OK", materials_detail: [{ keterangan: "jasa", subtotal: 100000 }], labor: 100000, material: 0, total: 100000 },
      { id: "BUG1", materials_detail: JSON.stringify([{ keterangan: "jasa", subtotal: 100000 }]), labor: 0, material: 1270000, total: 100000 },
      { id: "BUG2", materials_detail: [{ keterangan: "jasa", subtotal: 480000 }], labor: 480000, material: 500000, total: 480000 },
    ];
    const out = auditInvoices(invoices);
    expect(out.map(o => o.id)).toEqual(["BUG1", "BUG2"]); // OK tersaring, BUG1 (Δ besar) duluan
  });
  it("skipCancelled mengabaikan invoice CANCELLED", () => {
    const invoices = [{ id: "C", status: "CANCELLED", materials_detail: [{ keterangan: "jasa", subtotal: 1 }], labor: 0, material: 9, total: 9 }];
    expect(auditInvoices(invoices, { skipCancelled: true })).toHaveLength(0);
  });
});

describe("computePph23 (gross-up 2,5%)", () => {
  it("gross-up: net 1jt → DPP 1.025.641, PPh 25.641, AClean tetap terima 1jt", () => {
    const r = computePph23(1000000, 0.025);
    expect(r.dpp).toBe(1025641);
    expect(r.amount).toBe(25641);
    // verifikasi: DPP - PPh = net (yang diterima AClean)
    expect(r.dpp - r.amount).toBe(1000000);
  });
  it("rate default 2,5%", () => {
    expect(computePph23(1000000).amount).toBe(25641);
  });
  it("net 0 / rate 0 → tanpa potongan", () => {
    expect(computePph23(0)).toEqual({ dpp: 0, amount: 0, rate: 0.025 });
    expect(computePph23(500000, 0).amount).toBe(0);
  });
  it("rate lain (mis. 2%) tetap konsisten dpp-amount=net", () => {
    const r = computePph23(2000000, 0.02);
    expect(r.dpp - r.amount).toBe(2000000);
  });
});

describe("D auditQuoteDeviation", () => {
  const invoices = [
    { id: "INV-A", job_id: "JOB-1", total: 1000000, status: "UNPAID" },
    { id: "INV-B", job_id: "JOB-2", total: 500000, status: "PAID" },
    { id: "INV-C", job_id: "JOB-3", total: 800000, status: "CANCELLED" },
  ];
  it("flag bila total invoice menyimpang dari quote (match invoice_id)", () => {
    const quos = [{ id: "Q1", invoice_id: "INV-A", total: 750000, customer: "PT X" }];
    const out = auditQuoteDeviation(invoices, quos);
    expect(out).toHaveLength(1);
    expect(out[0].diff).toBe(250000);
    expect(out[0].matchedBy).toBe("invoice_id");
  });
  it("fallback match by job_id", () => {
    const quos = [{ id: "Q2", job_id: "JOB-2", total: 500000 }, { id: "Q3", job_id: "JOB-1", total: 900000 }];
    const out = auditQuoteDeviation(invoices, quos);
    expect(out.map(o => o.quotationId)).toEqual(["Q3"]); // Q2 cocok persis, Q3 selisih 100rb
    expect(out[0].matchedBy).toBe("job_id");
  });
  it("quote tanpa invoice / total 0 / invoice cancelled → skip", () => {
    const quos = [
      { id: "Q4", job_id: "JOB-X", total: 999 },        // tak ada invoice
      { id: "Q5", job_id: "JOB-1", total: 0 },          // total 0
      { id: "Q6", job_id: "JOB-3", total: 100 },        // invoice cancelled
    ];
    expect(auditQuoteDeviation(invoices, quos)).toHaveLength(0);
  });
});
