import { describe, it, expect } from "vitest";
import {
  movingAvgCost,
  unitCostFromPack,
  qtyFromPack,
  hppLabel,
  hppAgeDays,
  isHppStale,
  netUsageByItem,
  jobMaterialCost,
  invoiceMaterialCostHPP,
} from "../hpp.js";

const usage = (code, qty, extra = {}) => ({
  inventory_code: code, inventory_name: code, type: "usage", qty: -Math.abs(qty), ...extra,
});

describe("movingAvgCost — rata-rata bergerak tertimbang", () => {
  it("mencampur stok lama dengan pembelian baru sesuai bobot", () => {
    // 100 m @ 30.000 + 50 m @ 36.000 → (3.000.000 + 1.800.000) / 150 = 32.000
    expect(movingAvgCost({ stokLama: 100, hppLama: 30000, qtyMasuk: 50, hargaMasuk: 36000 })).toBe(32000);
  });

  it("stok lama nol → pakai harga masuk apa adanya", () => {
    expect(movingAvgCost({ stokLama: 0, hppLama: 30000, qtyMasuk: 30, hargaMasuk: 35000 })).toBe(35000);
  });

  it("stok minus tidak jadi bobot negatif (Kabel 3x2,5 stoknya -24)", () => {
    expect(movingAvgCost({ stokLama: -24, hppLama: 10000, qtyMasuk: 100, hargaMasuk: 12000 })).toBe(12000);
  });

  it("HPP lama nol → pakai harga masuk (kasus 25 item yang belum punya HPP)", () => {
    expect(movingAvgCost({ stokLama: 159, hppLama: 0, qtyMasuk: 30, hargaMasuk: 30000 })).toBe(30000);
  });

  it("restock TANPA harga tidak boleh mencemari HPP jadi nol", () => {
    expect(movingAvgCost({ stokLama: 100, hppLama: 30000, qtyMasuk: 50, hargaMasuk: 0 })).toBe(30000);
    expect(movingAvgCost({ stokLama: 100, hppLama: 30000, qtyMasuk: 50, hargaMasuk: null })).toBe(30000);
  });

  it("qty masuk nol/negatif tidak mengubah HPP", () => {
    expect(movingAvgCost({ stokLama: 100, hppLama: 30000, qtyMasuk: 0, hargaMasuk: 99000 })).toBe(30000);
    expect(movingAvgCost({ stokLama: 100, hppLama: 30000, qtyMasuk: -5, hargaMasuk: 99000 })).toBe(30000);
  });

  it("hasil dibulatkan 2 desimal, bukan ke rupiah utuh", () => {
    // 33 m @ 7.727,27 + 33 m @ 8.000 → 7.863,64 (pembulatan rupiah menumpuk error di qty besar)
    expect(movingAvgCost({ stokLama: 33, hppLama: 7727.27, qtyMasuk: 33, hargaMasuk: 8000 })).toBe(7863.64);
  });
});

describe("konversi kemasan → satuan dasar", () => {
  it("harga per roll 30 meter jadi harga per meter", () => {
    expect(unitCostFromPack(900000, 30)).toBe(30000);
  });

  it("harga per tabung freon 5,4 kg jadi harga per kg", () => {
    expect(unitCostFromPack(486000, 5.4)).toBe(90000);
  });

  it("packSize kosong = barang dibeli satuan, harga dipakai apa adanya", () => {
    expect(unitCostFromPack(50000, null)).toBe(50000);
    expect(unitCostFromPack(50000, 0)).toBe(50000);
  });

  it("qty kemasan dikali isi kemasan", () => {
    expect(qtyFromPack(2, 30)).toBe(60);
    expect(qtyFromPack(3, null)).toBe(3);
  });
});

describe("label & umur harga", () => {
  it("label mengikuti satuan item", () => {
    expect(hppLabel("Meter")).toBe("per Meter");
    expect(hppLabel("KG")).toBe("per KG");
    expect(hppLabel("")).toBe("per satuan");
  });

  it("harga yang belum pernah diisi selalu dianggap basi", () => {
    expect(hppAgeDays(null)).toBe(Infinity);
    expect(isHppStale(null)).toBe(true);
  });

  it("harga hari ini tidak basi, harga 100 hari lalu basi", () => {
    const hariIni = new Date().toISOString();
    const lama = new Date(Date.now() - 100 * 86400000).toISOString();
    expect(isHppStale(hariIni)).toBe(false);
    expect(isHppStale(lama)).toBe(true);
  });
});

describe("netUsageByItem — pemakaian bersih dari ledger", () => {
  it("menjumlahkan beberapa pemakaian item yang sama", () => {
    const out = netUsageByItem([usage("SKU022", 5), usage("SKU022", 3)]);
    expect(out.SKU022.qty).toBe(8);
  });

  it("koreksi timbang freon TIDAK terhitung dua kali", () => {
    // Estimasi 1,0 kg lalu ditimbang 0,7 kg: baris asli qty_actual di-set -0,7 DAN
    // dibuat baris adjustment +0,3. Yang benar = 0,7 kg, bukan 0,4 atau 1,0.
    const out = netUsageByItem([
      { inventory_code: "SKU009", inventory_name: "Freon R-32", type: "usage", qty: -1.0, qty_actual: -0.7 },
      { inventory_code: "SKU009", inventory_name: "Freon R-32", type: "adjustment", qty: 0.3, qty_actual: 0.3 },
    ]);
    expect(out.SKU009.qty).toBe(0.7);
  });

  it("barang yang dikembalikan penuh tidak muncul sebagai pemakaian", () => {
    const out = netUsageByItem([usage("SKU024", 5), { inventory_code: "SKU024", type: "adjustment", qty: 5 }]);
    expect(out.SKU024).toBeUndefined();
  });

  it("harga saat transaksi menang atas HPP hari ini", () => {
    const out = netUsageByItem([usage("SKU022", 10, { unit_cost: 28000 })]);
    expect(out.SKU022.unit_cost).toBe(28000);
  });
});

describe("jobMaterialCost — autosum biaya material satu job", () => {
  const inventory = [
    { code: "SKU022", name: "Pipa AC Hoda 1PK", unit: "Meter", purchase_price: 30000 },
    { code: "SKU025", name: "Kabel Listrik 3x1,5", unit: "Meter", purchase_price: 0 },
  ];

  it("menjumlahkan stok terpakai × HPP", () => {
    const { total, lines } = jobMaterialCost({ txs: [usage("SKU022", 10)], inventory });
    expect(total).toBe(300000);
    expect(lines[0]).toMatchObject({ source: "stok", qty: 10, unit_cost: 30000, subtotal: 300000 });
  });

  it("harga historis transaksi dipakai, bukan HPP terkini", () => {
    const { total, lines } = jobMaterialCost({ txs: [usage("SKU022", 10, { unit_cost: 25000 })], inventory });
    expect(total).toBe(250000);
    expect(lines[0].estimated).toBe(false);
  });

  it("tanpa unit_cost historis → pakai HPP item & tandai perkiraan", () => {
    const { lines } = jobMaterialCost({ txs: [usage("SKU022", 4)], inventory });
    expect(lines[0].estimated).toBe(true);
  });

  it("item tanpa HPP masuk daftar missing supaya tidak lolos diam-diam", () => {
    const { total, missing } = jobMaterialCost({ txs: [usage("SKU025", 12)], inventory });
    expect(total).toBe(0);
    expect(missing).toHaveLength(1);
    expect(missing[0].code).toBe("SKU025");
  });

  it("nota tertaut job ikut dihitung", () => {
    const { total } = jobMaterialCost({
      txs: [],
      expenses: [{ amount: 59000, item_name: "kapasitor", stock_linked_at: null }],
      inventory,
    });
    expect(total).toBe(59000);
  });

  it("nota yang SUDAH jadi stok dilewati — anti dobel-hitung", () => {
    const { total, lines } = jobMaterialCost({
      txs: [usage("SKU022", 10)],
      expenses: [{ amount: 900000, item_name: "Pipa 1 roll", stock_linked_at: "2026-08-20T03:00:00Z" }],
      inventory,
    });
    expect(total).toBe(300000);
    expect(lines).toHaveLength(1);
  });

  it("stok + nota digabung", () => {
    const { total } = jobMaterialCost({
      txs: [usage("SKU022", 10)],
      expenses: [{ amount: 59000, item_name: "kapasitor", stock_linked_at: null }],
      inventory,
    });
    expect(total).toBe(359000);
  });

  it("job tanpa material sama sekali → nol, bukan error", () => {
    expect(jobMaterialCost().total).toBe(0);
  });
});

describe("invoiceMaterialCostHPP (quick count invoice × HPP)", () => {
  const inventory = [
    { name: "Pipa AC Hoda 1PK", purchase_price: 95000 },
    { name: "Pipa AC Hoda 2PK", purchase_price: 120000 },
    { name: "Kabel Listrik 3x1,5", purchase_price: 17000 },
    { name: "Kabel Listrik 3x2,5", purchase_price: 25000 },
    { name: "Breket Outdoor Inc Dinabolt", purchase_price: 80000 },
  ];
  const md = [
    { nama: "Pemasangan AC Baru", jumlah: 1, category: "LABOR", subtotal: 400000 },
    { nama: "Pipa AC Hoda 1PK", jumlah: 4, category: "PART" },
    { nama: "Pipa AC Hoda 2PK", jumlah: 7, category: "PART" },
    { nama: "Kabel Listrik 3x1,5", jumlah: 4, category: "PART" },
    { nama: "Kabel Listrik 3x2,5", jumlah: 7, category: "PART" },
    { nama: "Breket Outdoor Inc Dinabolt", jumlah: 2, category: "PART" },
  ];

  it("jumlahkan PART × HPP, LABOR dilewati", () => {
    // 4×95k + 7×120k + 4×17k + 7×25k + 2×80k = 380+840+68+175+160 rb = 1.623.000
    const { total } = invoiceMaterialCostHPP({ materialsDetail: md, inventory });
    expect(total).toBe(1623000);
  });

  it("material tanpa HPP → biaya 0 & masuk missing (skip jadi margin)", () => {
    const r = invoiceMaterialCostHPP({
      materialsDetail: [{ nama: "Barang Tanpa HPP", jumlah: 3, category: "PART" }],
      inventory,
    });
    expect(r.total).toBe(0);
    expect(r.missing).toHaveLength(1);
  });

  it("terima materials_detail berupa string JSON", () => {
    const { total } = invoiceMaterialCostHPP({ materialsDetail: JSON.stringify(md), inventory });
    expect(total).toBe(1623000);
  });

  it("invoice hanya jasa (semua LABOR) → 0", () => {
    const { total, lines } = invoiceMaterialCostHPP({
      materialsDetail: [{ nama: "Jasa", jumlah: 1, category: "LABOR" }], inventory,
    });
    expect(total).toBe(0);
    expect(lines).toHaveLength(0);
  });

  it("cocokkan nama case-insensitive", () => {
    const { total } = invoiceMaterialCostHPP({
      materialsDetail: [{ nama: "  breket outdoor inc dinabolt ", jumlah: 1, category: "PART" }],
      inventory,
    });
    expect(total).toBe(80000);
  });

  it("materialsDetail kosong/null → 0, bukan error", () => {
    expect(invoiceMaterialCostHPP().total).toBe(0);
    expect(invoiceMaterialCostHPP({ materialsDetail: null, inventory }).total).toBe(0);
  });

  it("jasa/keuntungan salah-kategori PART → di-skip (bukan missing, bukan biaya)", () => {
    const r = invoiceMaterialCostHPP({
      materialsDetail: [
        { nama: "Jasa Vacum AC 0,5PK - 2,5PK", jumlah: 2, category: "PART" },
        { nama: "keuntungan unit ac panasonic", jumlah: 1, category: "PART" },
        { nama: "Pemasangan AC Baru 0,5PK - 1PK", jumlah: 1, category: "PART" },
        { nama: "Breket Outdoor Inc Dinabolt", jumlah: 1, category: "PART" },
      ],
      inventory,
    });
    expect(r.total).toBe(80000);     // hanya breket yang terhitung
    expect(r.lines).toHaveLength(1);
    expect(r.missing).toHaveLength(0); // jasa/markup tak dianggap "belum ada HPP"
  });

  it("normalisasi spasi ganda pada nama", () => {
    const { total } = invoiceMaterialCostHPP({
      materialsDetail: [{ nama: "Breket  Outdoor   Inc  Dinabolt", jumlah: 1, category: "PART" }],
      inventory,
    });
    expect(total).toBe(80000);
  });
});
