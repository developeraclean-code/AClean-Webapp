import { describe, it, expect } from "vitest";
import { buildAraContext } from "../araContext.js";

const TODAY = "2026-06-25";
const fixtures = () => ({
  today: TODAY,
  bulanIni: "2026-06",
  ordersData: [
    { id: "J1", customer: "Budi", service: "Cleaning", type: "", units: 1, status: "CONFIRMED", date: TODAY, time: "09:00", teknisi: "Andi", helper: "Eko", dispatch: true, invoice_id: null },
    { id: "J2", customer: "Sari", service: "Repair", units: 1, status: "DONE", date: "2026-06-01", time: "10:00", teknisi: "Andi", helper: null },
  ],
  invoicesData: [
    { id: "INV1", customer: "Budi", phone: "628111", total: 200000, status: "PAID", sent: "2026-06-10", labor: 200000, material: 0, materials_detail: [{ nama: "Cuci", jumlah: 1, satuan: "unit", harga_satuan: 200000, subtotal: 200000 }] },
    { id: "INV2", customer: "Sari", total: 150000, status: "UNPAID" },
  ],
  inventoryData: [
    { code: "M1", name: "Freon", stock: 10, unit: "kg", status: "OK", price: 100000, reorder: 2 },
    { code: "M2", name: "Kapasitor", stock: 0, unit: "pcs", status: "CRITICAL", price: 75000, reorder: 5 },
  ],
  customersData: [{ id: "C1", name: "Budi", phone: "08123456789", area: "BSD", total_orders: 3, is_vip: true }],
  laporanReports: [
    { id: "L1", job_id: "J1", teknisi: "Andi", customer: "Budi", service: "Cleaning", status: "SUBMITTED", date: TODAY, total_units: 2, units: [{ pekerjaan: ["Service Besar"] }], materials: [] },
    { id: "L2", job_id: "J2", teknisi: "Andi", customer: "Sari", service: "Repair", status: "REVISION", date: TODAY, total_units: 1, units: [{ pekerjaan: ["Ganti kapasitor"] }], materials: [] },
  ],
  teknisiData: [
    { name: "Andi", role: "Teknisi", status: "active", phone: "628999", skills: ["cleaning"], area: "BSD" },
    { name: "Eko", role: "Helper", status: "active", phone: "628888" },
  ],
  waConversations: [{ phone: "628123456789", name: "Budi WA", last_message: "halo", updated_at: "2026-06-25T01:00:00Z", unread: 1, intent: "tanya" }],
  paymentSuggestions: [{ phone: "628111", sender_name: "Budi", amount: 200000, bank: "BCA", invoice_id: "INV1", status: "PENDING", source: "image", image_url: "x", created_at: "2026-06-25" }],
  priceListData: [
    { service: "Cleaning", type: "AC Split 0.5-1PK", price: 95000, is_active: true, notes: null },
    { service: "Cleaning", type: "Biaya Transport Bila 1 Unit", price: 20000, is_active: true },
  ],
  PRICE_LIST: { Cleaning: { "AC Split 0.5-1PK": 65000, default: 0 } },
  cariSlotKosong: () => true,
  araSchedulingSuggest: () => ({ pref: { Andi: "Eko" }, sorted: [{ name: "Andi" }] }),
});

describe("buildAraContext", () => {
  it("memetakan orders/invoices/inventory/customers ke field ringkas", () => {
    const ctx = buildAraContext(fixtures());
    expect(ctx.today).toBe(TODAY);
    expect(ctx.orders).toHaveLength(2);
    expect(ctx.orders[0]).toMatchObject({ id: "J1", customer: "Budi", teknisi: "Andi" });
    // invoices kini diurut: belum-lunas dulu → cari by id (order tak dijamin)
    expect(ctx.invoices.find(i => i.id === "INV1").materials_detail[0].nama).toBe("Cuci");
    expect(ctx.inventory).toHaveLength(2);
    expect(ctx.customers[0]).toMatchObject({ name: "Budi", is_vip: true });
  });

  it("hitung laporanPending & laporanRevisi", () => {
    const ctx = buildAraContext(fixtures());
    expect(ctx.laporanPending).toBe(1);
    expect(ctx.laporanRevisi).toBe(1);
  });

  it("deteksi service besar + tipe berdasarkan total_units", () => {
    const ctx = buildAraContext(fixtures());
    const l1 = ctx.laporan.find(r => r.id === "L1");
    expect(l1.has_service_besar).toBe(true);
    expect(l1.service_besar_type).toBe("Jasa Service Besar 1,5PK - 2,5PK"); // total_units=2 → >1
  });

  it("teknisiWorkload jobsToday & jadwalHariIni hanya untuk hari ini", () => {
    const ctx = buildAraContext(fixtures());
    const andi = ctx.teknisiWorkload.find(t => t.name === "Andi");
    expect(andi.jobsToday).toBe(1);     // hanya J1 (J2 tanggal lain)
    expect(andi.jadwalHariIni).toHaveLength(1);
    expect(andi.slotKosongHariIni).toBe(true);
  });

  it("recentWa mengenali customer via samePhone (normalisasi 08→628)", () => {
    const ctx = buildAraContext(fixtures());
    expect(ctx.recentWa[0].isKnownCustomer).toBe(true);
    expect(ctx.recentWa[0].customerName).toBe("Budi");
    expect(ctx.recentWa[0].totalOrders).toBe(3);
  });

  it("revenueStats: bulanIni dari PAID, totalUnpaid dari UNPAID/OVERDUE, stokKritis", () => {
    const ctx = buildAraContext(fixtures());
    expect(ctx.revenueStats.bulanIni).toBe(200000);   // INV1 PAID Juni
    expect(ctx.revenueStats.totalUnpaid).toBe(150000); // INV2 UNPAID
    expect(ctx.revenueStats.stokKritis).toContain("Kapasitor");
  });

  it("hargaLayanan dari priceListData aktif", () => {
    const ctx = buildAraContext(fixtures());
    expect(ctx.hargaLayanan).toHaveLength(2);
    expect(ctx.hargaLayanan[0]).toMatchObject({ service: "Cleaning", harga: 95000 });
    expect(ctx.hargaLayanan[0].formatted).toBe("Rp95.000");
  });

  it("hargaLayanan fallback ke PRICE_LIST saat priceListData kosong", () => {
    const f = fixtures(); f.priceListData = [];
    const ctx = buildAraContext(f);
    expect(ctx.hargaLayanan.some(r => r.type === "AC Split 0.5-1PK" && r.harga === 65000)).toBe(true);
    expect(ctx.hargaLayanan.some(r => r.type === "default")).toBe(false); // 'default' di-skip
  });

  it("slotRekomendasi dari araSchedulingSuggest", () => {
    const ctx = buildAraContext(fixtures());
    expect(ctx.slotRekomendasi.teknisiDisarankan[0].nama).toBe("Andi");
    expect(ctx.slotRekomendasi.pasanganFavorit).toEqual({ Andi: "Eko" });
  });

  it("slotRekomendasi aman saat araSchedulingSuggest throw", () => {
    const f = fixtures(); f.araSchedulingSuggest = () => { throw new Error("boom"); };
    const ctx = buildAraContext(f);
    expect(ctx.slotRekomendasi).toEqual({ teknisiDisarankan: [], pasanganFavorit: {} });
  });
});
