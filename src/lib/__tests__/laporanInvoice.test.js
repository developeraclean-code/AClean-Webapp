import { describe, it, expect } from "vitest";
import { buildInvoiceDetail } from "../laporanInvoice.js";
import { summarize } from "../invoicing.js";

// Fixture price list — minimal, cukup untuk jalur Cleaning/Repair/Install.
const priceList = [
  { service: "Cleaning", type: "AC Split 0.5-1PK", price: 65000, is_active: true },
  { service: "Cleaning", type: "AC Split 1.5-2.5PK", price: 75000, is_active: true },
  { service: "Cleaning", type: "Biaya Transport Bila 1 Unit", price: 50000, is_active: true },
  { service: "Repair", type: "Biaya Pengecekan AC", price: 100000, is_active: true },
];
// Helper component-local di-stub deterministik.
const lookupHargaGlobal = () => 0;
const hitungLabor = () => 0;

const base = { priceListData: priceList, lookupHargaGlobal, hitungLabor };
const unit = (no, tipe = "AC Split 1PK", extra = {}) => ({ unit_no: no, tipe, label: "R" + no, ...extra });

describe("buildInvoiceDetail — Cleaning", () => {
  it("1 unit AC Split 1PK → baris cleaning per-unit + transport (total 115.000)", () => {
    const { mDetail } = buildInvoiceDetail({
      ...base, order: { service: "Cleaning", type: "" }, units: [unit(1)],
    });
    const s = summarize(mDetail);
    expect(s.lineTotal).toBe(115000); // 65.000 cleaning + 50.000 transport
    expect(mDetail.some(r => r.nama.includes("Transport"))).toBe(true);
    expect(mDetail.filter(r => r.keterangan === "jasa").length).toBe(2);
  });

  it("2 unit → 2 baris cleaning, TANPA transport (transport hanya 1 unit)", () => {
    const { mDetail } = buildInvoiceDetail({
      ...base, order: { service: "Cleaning", type: "" }, units: [unit(1), unit(2)],
    });
    const s = summarize(mDetail);
    expect(s.lineTotal).toBe(130000); // 2 × 65.000
    expect(mDetail.some(r => r.nama.includes("Transport"))).toBe(false);
  });

  it("baseline cleaning di-SKIP jika sudah ada jasa cleaning manual", () => {
    const { mDetail } = buildInvoiceDetail({
      ...base, order: { service: "Cleaning", type: "" }, units: [unit(1)],
      jasaItems: [{ nama: "Cuci AC Premium", jumlah: 1, satuan: "unit", harga_satuan: 90000 }],
    });
    // tidak ada baris cleaning auto (sudah ada 'cuci'); transport tetap inject 1 unit
    const autoCleaningRows = mDetail.filter(r => r.nama.startsWith("Cleaning AC Split"));
    expect(autoCleaningRows.length).toBe(0);
    expect(summarize(mDetail).lineTotal).toBe(140000); // 90.000 jasa + 50.000 transport
  });
});

describe("buildInvoiceDetail — Repair", () => {
  it("tanpa item & bukan gratis → inject Biaya Pengecekan per unit", () => {
    const { mDetail } = buildInvoiceDetail({
      ...base, order: { service: "Repair", type: "" }, units: [unit(1), unit(2)],
      isRepairGratis: false,
    });
    const cek = mDetail.find(r => r.nama === "Biaya Pengecekan AC");
    expect(cek).toBeTruthy();
    expect(cek.jumlah).toBe(2);              // per unit
    expect(summarize(mDetail).lineTotal).toBe(200000); // 100.000 × 2
  });

  it("isRepairGratis=true → TIDAK inject biaya pengecekan (total 0)", () => {
    const { mDetail } = buildInvoiceDetail({
      ...base, order: { service: "Repair", type: "" }, units: [unit(1)],
      isRepairGratis: true,
    });
    expect(mDetail.find(r => r.nama === "Biaya Pengecekan AC")).toBeFalsy();
    expect(summarize(mDetail).lineTotal).toBe(0);
  });

  it("cleaning-in-repair → append baris cleaning untuk unit dicentang", () => {
    const { mDetail } = buildInvoiceDetail({
      ...base, order: { service: "Repair", type: "" }, units: [unit(1)],
      barangItems: [{ nama: "Kapasitor", jumlah: 1, satuan: "pcs", harga_satuan: 75000 }],
      cleaningInRepair: [1],
    });
    expect(mDetail.some(r => r.nama.includes("[+Repair]"))).toBe(true);
    // 75.000 kapasitor + 65.000 cleaning unit 1
    expect(summarize(mDetail).lineTotal).toBe(140000);
  });
});

describe("buildInvoiceDetail — Barang & Freon", () => {
  it("barang item jadi baris keterangan 'barang'", () => {
    const { mDetail } = buildInvoiceDetail({
      ...base, order: { service: "Cleaning", type: "" }, units: [unit(1)],
      barangItems: [{ nama: "Pipa AC", jumlah: 2, satuan: "meter", harga_satuan: 30000 }],
    });
    const barang = mDetail.find(r => r.keterangan === "barang");
    expect(barang.subtotal).toBe(60000); // 2 × 30.000
  });

  it("freon dibulatkan ke atas (1.3 kg → 2 kg)", () => {
    const { mDetail } = buildInvoiceDetail({
      ...base, order: { service: "Cleaning", type: "" }, units: [unit(1)],
      barangItems: [{ nama: "Freon R-32", jumlah: 1.3, satuan: "kg", harga_satuan: 100000 }],
    });
    const freon = mDetail.find(r => r.nama === "Freon R-32");
    expect(freon.jumlah).toBe(2);            // ceil(1.3)=2
    expect(freon.subtotal).toBe(200000);
    expect(freon.keterangan).toBe("barang"); // ket dari section C menimpa note pembulatan
  });
});

describe("buildInvoiceDetail — Install", () => {
  it("Install → baris hanya dari effectiveMaterials, tanpa auto-inject cleaning/transport", () => {
    const { mDetail } = buildInvoiceDetail({
      ...base, order: { service: "Install", type: "" }, units: [unit(1)],
      effectiveMaterials: [
        { nama: "Pasang AC Baru", jumlah: 1, satuan: "unit", harga_satuan: 300000 },
        { nama: "Pipa AC Hoda 1PK", jumlah: 4, satuan: "meter", harga_satuan: 90000 },
      ],
    });
    expect(mDetail.length).toBe(2);
    expect(mDetail.some(r => r.nama.includes("Transport"))).toBe(false);
    expect(mDetail.find(r => r.nama === "Pasang AC Baru").keterangan).toBe("jasa");
    expect(summarize(mDetail).lineTotal).toBe(660000); // 300.000 + 4×90.000
  });
});

describe("buildInvoiceDetail — Complain garansi", () => {
  it("garansi aktif → append baris diskon garansi (menetralkan jasa)", () => {
    const { mDetail } = buildInvoiceDetail({
      ...base, order: { service: "Complain", type: "" }, units: [unit(1)],
      finalLabor: 100000, prevGaransiActive: { id: "INV-LAMA" },
    });
    // baris jasa biaya cek (100rb) + baris diskon garansi negatif (-100rb) → total bersih 0
    const s = summarize(mDetail);
    expect(mDetail.some(r => r.subtotal < 0)).toBe(true); // baris diskon garansi
    expect(s.lineDiscount).toBe(100000); // diskon garansi tercatat
    expect(s.total).toBe(0);             // net setelah diskon = 0 (jasa ditanggung garansi)
  });
});
