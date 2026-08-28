import { describe, it, expect } from "vitest";
import { detectBonusFromInvoice } from "../bonus.js";
import { DEFAULT_BONUS_CATEGORIES } from "../../constants/bonus.js";

const CATS = DEFAULT_BONUS_CATEGORIES;
const inv = (...nama) => JSON.stringify(nama.map(n => ({ nama: n, jumlah: 1 })));
const det = (...nama) => detectBonusFromInvoice(inv(...nama), "", CATS).detected;

// Nama item NYATA dari produksi (invoices.materials_detail, Apr–Agu 2026).
describe("deteksi bonus — kategori freon", () => {
  it("menangkap ketiga bentuk yang dikonfirmasi Owner sebagai kategori freon", () => {
    expect(det("Kuras Vacum Freon R32/R410")).toContain("freon");
    expect(det("Kuras Vacum + Isi Freon R32/R410")).toContain("freon");
    expect(det("Tambah Freon R-32")).toContain("freon");
    expect(det("Freon R-410A")).toContain("freon");
    expect(det("Repair / Tambah Freon R-22")).toContain("freon");
  });

  it("MEMBUANG 'Jasa Pengisian Freon' — freon milik customer, teknisi hanya jasa isi", () => {
    expect(det("Jasa Pengisian Freon")).not.toContain("freon");
    expect(det("JASA PENGISIAN FREON")).not.toContain("freon");
  });

  it("tidak menyentuh 'Jasa Vacum AC' — vacuum saat instalasi, bukan isi freon", () => {
    expect(det("Jasa Vacum AC 0,5PK - 2,5PK")).toEqual([]);
    expect(det("Install / Jasa Vacum AC 0,5PK - 2,5PK")).toEqual([]);
  });
});

describe("deteksi bonus — kategori kapasitor", () => {
  it("menangkap semua varian nama, tanpa peduli ukuran PK", () => {
    expect(det("Kapasitor AC 0.5-1.5PK + Pasang")).toContain("kapasitor");
    expect(det("Kapasitor AC 2-2.5PK + Pasang")).toContain("kapasitor");
    expect(det("Sparepart Kapasitor Fan Outdoor")).toContain("kapasitor");
    expect(det("Jasa Pergantian Kapasitor Fan Indoor")).toContain("kapasitor");
  });

  it("MEMBUANG kapasitor milik customer", () => {
    expect(det("Jasa pasang Sparepart kapasitor ( Kapasitor dari customer ) "))
      .not.toContain("kapasitor");
  });
});

describe("exclude_keywords", () => {
  it("ber-logika ATAU: satu kata cocok sudah cukup membatalkan", () => {
    const cats = [{ id: "x", label: "X", amount: 1, detection_keywords: ["pipa"], exclude_keywords: ["bekas", "customer"] }];
    const d = (n) => detectBonusFromInvoice(inv(n), "", cats).detected;
    expect(d("Pipa AC 1/4")).toEqual(["x"]);
    expect(d("Pipa AC bekas")).toEqual([]);
    expect(d("Pipa AC dari customer")).toEqual([]);
  });

  it("kategori tanpa exclude_keywords tetap jalan (kompatibel data lama)", () => {
    const cats = [{ id: "y", label: "Y", amount: 1, detection_keywords: ["thermis"] }];
    expect(detectBonusFromInvoice(inv("Sparepart Thermis"), "", cats).detected).toEqual(["y"]);
  });

  it("menerima keyword berbentuk string koma, bukan hanya array", () => {
    const cats = [{ id: "z", label: "Z", amount: 1, detection_keywords: "freon", exclude_keywords: "pengisian" }];
    const d = (n) => detectBonusFromInvoice(inv(n), "", cats).detected;
    expect(d("Tambah Freon R-32")).toEqual(["z"]);
    expect(d("Jasa Pengisian Freon")).toEqual([]);
  });
});

describe("nominal mengikuti poster Skema Insentif 2025", () => {
  const amt = (id) => CATS.find(c => c.id === id).amount;
  it("sparepart", () => {
    expect(amt("freon")).toBe(20000);
    expect(amt("thermis")).toBe(25000);
  });
  it("pemasangan AC — 2/3/4 unit per hari", () => {
    expect(amt("install_2")).toBe(50000);
    expect(amt("install_3")).toBe(150000);
    expect(amt("install_4")).toBe(300000);
  });
  it("omset TIDAK diubah di repo ini (ditangani terpisah)", () => {
    expect(amt("margin_1jt")).toBe(50000);
    expect(amt("margin_2jt")).toBe(100000);
    expect(amt("margin_3jt")).toBe(200000);
  });
});
