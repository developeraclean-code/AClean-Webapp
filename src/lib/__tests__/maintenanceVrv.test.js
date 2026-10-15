import { describe, it, expect } from "vitest";
import { MAINT_AC_TYPES, normalizeMaintenanceAcType, isVrvType, capacityPkNumber } from "../maintenanceAcTypes.js";
import { maintUnitToHist, mkUnit } from "../laporanConstants.js";
import { clientCleaningUnitPrice, unitTipeToCode, unitPkNumber } from "../maintClientPrice.js";
import { getBracketKey, hargaPerUnitFromTipe } from "../pricing.js";
import { reportHasVrv, unpricedVrvUnits, vrvInvoiceUnitLabel } from "../vrvBilling.js";
import { dupoinPreviewUnits } from "../../../preview/maintenance/dupoin-fixture.js";
import { dupoinPrices } from "../../../scripts/data/dupoin-maintenance-20261015.mjs";

const reportUnit = (u, i = 0) => mkUnit(i + 1, maintUnitToHist(u));
const price = (over = {}) => ({ service_type: "Cuci Rutin", ac_type: "vrv_indoor", capacity_pk: null, unit_price: 100000, ...over });

describe("VRV registry → laporan → tarif", () => {
  it("menormalisasi alias VRV/VRF dan legacy duct tanpa memetakan VRV ke split", () => {
    for (const code of ["vrv_indoor", "vrv_outdoor"]) expect(MAINT_AC_TYPES).toContain(code);
    expect(normalizeMaintenanceAcType("VRF Outdoor")).toBe("vrv_outdoor");
    expect(normalizeMaintenanceAcType("AC VRV Indoor 7.63PK")).toBe("vrv_indoor");
    expect(normalizeMaintenanceAcType("ducted")).toBe("floor");
    expect(normalizeMaintenanceAcType("vrv_unknown")).toBeNull();
    expect(unitTipeToCode("AC VRV Indoor")).toBe("vrv_indoor");
    expect(unitTipeToCode("AC VRV Outdoor 34.2PK")).toBe("vrv_outdoor");
    expect(unitTipeToCode("AC VRV")).toBeNull();
    expect(isVrvType("vrv_outdoor")).toBe(true);
  });
  it("kapasitas desimal, koma, atau teks PK dibaca tanpa pembulatan bracket", () => {
    for (const [input, expected] of [["7,63", 7.63], ["34.20PK", 34.2], [" 5.450 PK ", 5.45], [3.69, 3.69]]) {
      expect(capacityPkNumber(input)).toBe(expected);
      expect(unitPkNumber({ pk: input })).toBe(expected);
    }
    for (const input of [null, "", "0", "-1", "Infinity", "NaN", "7PKgarbage"]) expect(capacityPkNumber(input)).toBeNull();
  });
  it("52 aset sesuai gambar: 40 indoor/12 outdoor; kode unik dan pembagian zona tepat", () => {
    expect(dupoinPreviewUnits).toHaveLength(52);
    expect(dupoinPreviewUnits.filter(u => u.ac_type === "vrv_indoor")).toHaveLength(40);
    expect(dupoinPreviewUnits.filter(u => u.ac_type === "vrv_outdoor")).toHaveLength(12);
    expect(new Set(dupoinPreviewUnits.map(u => u.unit_code)).size).toBe(52);
    for (const zone of "ABCDEFGH") expect(dupoinPreviewUnits.filter(u => u.zone === zone)).toHaveLength("ABEF".includes(zone) ? 8 : 5);
    const models = new Map();
    dupoinPreviewUnits.forEach(u => models.set(u.capacity_pk, (models.get(u.capacity_pk) || 0) + 1));
    expect(Object.fromEntries(models)).toEqual({ 7.63: 4, 5.45: 16, 4.77: 4, 34.2: 8, 3.69: 12, 2.35: 4, 13.42: 4 });
  });
  it("seluruh 52 aset mempertahankan tipe, PK, identitas; tidak mengarang serial atau tanggal servis", () => {
    dupoinPreviewUnits.forEach((u, i) => {
      const r = reportUnit(u, i);
      expect(r.tipe).toBe(u.ac_type === "vrv_indoor" ? "AC VRV Indoor" : "AC VRV Outdoor");
      expect(r.pk).toBe(`${u.capacity_pk}PK`);
      expect(r.maint_unit_id).toBe(u.id);
      expect(r.model).toBe("");
      expect(u.serial_no).toBeNull();
      expect(u.last_service_date).toBeNull();
      expect(u.next_service_date).toBeNull();
      expect(r.label).toContain(u.unit_code);
    });
  });
  it("PK kosong tidak diubah diam-diam menjadi 1PK; floor tidak lagi jatuh ke Split Wall", () => {
    const u = reportUnit({ ...dupoinPreviewUnits[0], capacity_pk: null });
    expect(u.tipe).toBe("AC VRV Indoor");
    expect(u.pk).toBe("");
    expect(maintUnitToHist({ ac_type: "floor", capacity_pk: "4.00" }).tipe).toBe("AC Split Duct 4PK");
    expect(maintUnitToHist({ ac_type: "unknown", capacity_pk: 1 }).tipe).toBe("");
  });
  it("tarif strict PK mengalahkan flat untuk tipe sama; tidak tertukar indoor/outdoor/split", () => {
    const u = reportUnit(dupoinPreviewUnits[0]);
    const prices = [price({ ac_type: "split", unit_price: 95000 }), price({ ac_type: "vrv_outdoor", unit_price: 500000 }), price(), price({ capacity_pk: 7.63, unit_price: 175000 })];
    expect(clientCleaningUnitPrice(prices, u)).toBe(175000);
    expect(clientCleaningUnitPrice(prices.filter(p => p.ac_type === "split" || p.ac_type === "vrv_outdoor"), u)).toBeNull();
    expect(clientCleaningUnitPrice([price({ capacity_pk: 7.6 })], u)).toBeNull();
    expect(clientCleaningUnitPrice([price({ capacity_pk: 7.63 })], { ...u, pk: "7,63" })).toBe(100000);
  });
  it("global price key VRV terpisah, termasuk service besar/Install, tidak memakai default Split", () => {
    expect(getBracketKey("Cleaning", "AC VRV Indoor")).toBe("AC VRV Indoor");
    expect(getBracketKey("Maintenance", "AC VRV Outdoor")).toBe("AC VRV Outdoor");
    expect(getBracketKey("Cleaning", "AC VRV Indoor", { serviceBesar: true })).toBe("Jasa Service Besar VRV Indoor");
    expect(getBracketKey("Install", "AC VRV Outdoor")).toBe("Pemasangan AC VRV Outdoor");
    const regular = [{ service: "Cleaning", type: "AC Split 0.5-1PK", price: 999999 }];
    expect(hargaPerUnitFromTipe("Cleaning", "AC VRV Indoor", regular, { Cleaning: { default: 999999 } })).toBe(0);
    expect(hargaPerUnitFromTipe("Cleaning", "AC VRV Indoor", [...regular, { service: "Cleaning", type: "AC VRV Indoor", price: 150000 }])).toBe(150000);
  });
  it("laporan VRV dan campuran ditunda invoice-nya; laporan reguler tidak terpengaruh", () => {
    expect(reportHasVrv([reportUnit(dupoinPreviewUnits[0])])).toBe(true);
    expect(reportHasVrv([{ tipe: "AC Split 1PK" }, reportUnit(dupoinPreviewUnits[6])])).toBe(true);
    expect(reportHasVrv([{ tipe: "AC Split 1PK" }])).toBe(false);
    expect(reportHasVrv(null)).toBe(false);
  });
  it("guard menahan 52 tarif kosong, salah tipe, non-cleaning, nol dan PK hilang", () => {
    const units = dupoinPreviewUnits.map(reportUnit);
    expect(unpricedVrvUnits({ service: "Cleaning", units })).toHaveLength(52);
    expect(unpricedVrvUnits({ service: "Maintenance", units, clientPrices: [price({ ac_type: "split" })] })).toHaveLength(52);
    expect(unpricedVrvUnits({ service: "Cleaning", units, clientPrices: [price({ service_type: "Perbaikan" })] })).toHaveLength(52);
    expect(unpricedVrvUnits({ service: "Cleaning", units, clientPrices: [price({ unit_price: 0 })] })).toHaveLength(52);
    expect(unpricedVrvUnits({ service: "Cleaning", units, clientPrices: [price({ unit_price: Infinity })] })).toHaveLength(52);
    expect(unpricedVrvUnits({ service: "Cleaning", units, priceListData: [{ service: "Cleaning", type: "AC VRV Indoor", price: Infinity }] })).toHaveLength(52);
    expect(unpricedVrvUnits({ service: "Cleaning", units: [{ ...units[0], pk: "" }], clientPrices: [price()] })).toHaveLength(1);
    expect(unpricedVrvUnits({ service: "Survey", units })).toEqual([]);
  });
  it("tarif indoor saja tidak membebaskan 12 outdoor; total simulasi tidak mengulang seluruh paket per unit", () => {
    const units = dupoinPreviewUnits.map(reportUnit);
    expect(unpricedVrvUnits({ service: "Cleaning", units, clientPrices: [price()] })).toHaveLength(12);
    const prices = [price(), price({ ac_type: "vrv_outdoor", unit_price: 500000 })];
    expect(unpricedVrvUnits({ service: "Cleaning", units, clientPrices: prices })).toEqual([]);
    expect(units.reduce((s, u) => s + clientCleaningUnitPrice(prices, u), 0)).toBe(10000000); // harga DEMO, bukan penawaran.
    expect(vrvInvoiceUnitLabel(units[0], "AC VRV Indoor")).toBe("AC VRV Indoor 7.63PK");
  });
  it("penawaran Dupoin: 24 × 450rb + 16 × 300rb + 12 outdoor termasuk = tepat Rp15.600.000", () => {
    const units = dupoinPreviewUnits.map(reportUnit);
    expect(dupoinPrices).toHaveLength(7);
    expect(unpricedVrvUnits({ service: "Cleaning", units, clientPrices: dupoinPrices })).toEqual([]);
    const amounts = units.map(u => clientCleaningUnitPrice(dupoinPrices, u));
    expect(amounts.filter(n => n === 450000)).toHaveLength(24);
    expect(amounts.filter(n => n === 300000)).toHaveLength(16);
    expect(amounts.filter(n => n === 0)).toHaveLength(12);
    expect(amounts.reduce((sum, n) => sum + n, 0)).toBe(15600000);
    // Nol tanpa flag harus tetap menahan invoice (tidak dianggap gratis).
    const unmarked = dupoinPrices.map(p => ({ ...p, included_in_service: false }));
    expect(unpricedVrvUnits({ service: "Cleaning", units, clientPrices: unmarked })).toHaveLength(12);
    for (const u of units.filter(u => u.tipe === "AC VRV Outdoor")) {
      expect(clientCleaningUnitPrice(dupoinPrices, u)).toBe(0);
      expect(unpricedVrvUnits({ service: "Cleaning", units: [u], clientPrices: dupoinPrices })).toEqual([]);
    }
  });
  it("simulasi 200 job: tipe/PK tetap utuh, tarif tidak bocor antar komponen, error tidak jadi nol lunas", () => {
    for (let i = 0; i < 200; i++) {
      const registry = dupoinPreviewUnits[i % 52];
      const u = reportUnit(registry);
      const own = price({ ac_type: registry.ac_type, capacity_pk: registry.capacity_pk, unit_price: 100000 + i });
      const other = price({ ac_type: registry.ac_type === "vrv_indoor" ? "vrv_outdoor" : "vrv_indoor", capacity_pk: registry.capacity_pk, unit_price: 1 });
      expect(unitTipeToCode(u.tipe)).toBe(registry.ac_type);
      expect(unpricedVrvUnits({ service: "Cleaning", units: [u], clientPrices: [other] })).toHaveLength(1);
      expect(unpricedVrvUnits({ service: "Cleaning", units: [u], clientPrices: [other, own] })).toEqual([]);
      expect(clientCleaningUnitPrice([other, own], u)).toBe(100000 + i);
    }
  });
});
