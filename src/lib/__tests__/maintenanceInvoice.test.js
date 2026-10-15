import { describe, expect, it } from "vitest";
import { buildMaintenanceInvoiceQuote, maintenanceLogInvoiceLine } from "../maintenanceInvoice.js";
import { checkInvoiceConsistency } from "../invoicing.js";
import { dupoin, dupoinPrices, dupoinUnits } from "../../../scripts/data/dupoin-maintenance-20261015.mjs";

const fixtureId = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const units = dupoinUnits.map((u, i) => ({ ...u, id: fixtureId(i + 1), client_id: dupoin.client_id }));
const logs = units.map((u, i) => ({ id: fixtureId(i + 101), client_id: dupoin.client_id, unit_id: u.id, service_type: "Cuci Rutin", service_date: "2026-10-15", cost: null, invoiced: false }));
const quote = (overrides = {}) => buildMaintenanceInvoiceQuote({ clientId: dupoin.client_id, logs, units, clientPrices: dupoinPrices, ...overrides });
const split = { id: "unit", unit_code: "S1", client_id: "client", ac_type: "split", capacity_pk: 1 };
const log = { id: "log", unit_id: "unit", client_id: "client", service_type: "Cuci", service_date: "2026-10-15", cost: null };
const rate = (ac_type, unit_price, capacity_pk = null) => ({ ac_type, unit_price, capacity_pk, service_type: "Cuci Rutin" });

describe("maintenance B2B — one price book, canonical invoice lines", () => {
  it("Dupoin: 52 lines, 40 billed indoor + 12 explicitly included outdoor = Rp15.600.000", () => {
    const q = quote();
    expect(q.total).toBe(15600000); expect(q.count).toBe(52);
    expect(q.line_items.filter(l => l.included_in_service)).toHaveLength(12);
    expect(q.line_items.filter(l => l.harga_satuan === 450000)).toHaveLength(24);
    expect(q.line_items.filter(l => l.harga_satuan === 300000)).toHaveLength(16);
    expect(q.line_items.filter(l => l.included_in_service).every(l => l.subtotal === 0 && /termasuk penawaran/.test(l.nama))).toBe(true);
    expect(checkInvoiceConsistency({ ...q, materials_detail: q.line_items }).ok).toBe(true);
  });
  it("separate 30+22 logs keep the same total; reversed selection gives the same quote key", () => {
    expect(quote({ logs: logs.slice(0, 30) }).total + quote({ logs: logs.slice(30) }).total).toBe(15600000);
    expect(quote({ logs: [...logs].reverse() }).quote_key).toBe(quote().quote_key);
  });
  it("200 jobs do not repeat a combined invoice total or add transport to outdoor Rp0", () => {
    const bulk = Array.from({ length: 200 }, (_, i) => ({ ...logs[i % 52], id: fixtureId(1000 + i) }));
    const q = quote({ logs: bulk });
    expect(q.count).toBe(200);
    expect(q.total).toBe(bulk.reduce((sum, l) => sum + quote({ logs: [l] }).total, 0));
    expect(q.line_items.some(l => /transport/i.test(l.nama))).toBe(false);
  });
  it("contract strict PK wins over flat rate and a manually entered historical cleaning cost", () => {
    const line = maintenanceLogInvoiceLine({ ...log, cost: 999999 }, split, [rate("split", 95000), rate("split", 88000, 1)]);
    expect(line.harga_satuan).toBe(88000); expect(line.price_source).toBe("maintenance_client_prices");
  });
  it("global fallback distinguishes cassette, ducted, standing and split", () => {
    for (const [type, bracket, price] of [["cassette", "AC Cassette 3PK", 250000], ["ducted", "AC Split Duct 3PK", 300000], ["standing", "AC Floor Standing 3PK", 260000], ["split", "AC Split 1.5-2.5PK", 100000]]) {
      expect(maintenanceLogInvoiceLine(log, { ...split, ac_type: type, capacity_pk: 3 }, [], [{ service: "Cleaning", type: bracket, price }]).harga_satuan).toBe(price);
    }
  });
  it.each(["vrv_indoor", "vrv_outdoor"])("%s never falls back to regular Split/Duct or a manual cleaning cost", type => {
    expect(() => maintenanceLogInvoiceLine({ ...log, cost: 100000 }, { ...split, ac_type: type, capacity_pk: 7.63 }, [], [{ service: "Cleaning", type: "AC Split Duct 4PK", price: 400000 }])).toThrow(/belum diatur/);
  });
  it("explicit global VRV tariff is allowed; indoor price never prices outdoor", () => {
    const u = { ...split, ac_type: "vrv_outdoor", capacity_pk: 34.2 };
    expect(() => maintenanceLogInvoiceLine(log, u, [rate("vrv_indoor", 450000)], [])).toThrow(/belum diatur/);
    expect(maintenanceLogInvoiceLine(log, u, [], [{ service: "Cleaning", type: "AC VRV Outdoor", price: 550000 }]).harga_satuan).toBe(550000);
  });
  it("legacy zero without included flag is not a free service", () => {
    expect(() => maintenanceLogInvoiceLine(log, split, [rate("split", 0)], [])).toThrow(/belum diatur/);
  });
  it.each([null, "", 0, "NaN", "Infinity"])("VRV missing/invalid capacity %s is blocked", capacity_pk => {
    expect(() => maintenanceLogInvoiceLine(log, { ...split, ac_type: "vrv_indoor", capacity_pk }, dupoinPrices)).toThrow(/belum valid/);
  });
  it.each(["Perbaikan", "Isi Freon", "Pasang", "Cek"])("%s uses explicit actual cost, not a cleaning tariff", service_type => {
    expect(maintenanceLogInvoiceLine({ ...log, service_type, cost: 120000 }, split, [rate("split", 95000)]).harga_satuan).toBe(120000);
    expect(() => maintenanceLogInvoiceLine({ ...log, service_type, cost: null }, split, [rate("split", 95000)])).toThrow(/biaya aktual/);
  });
  it.each([-1, 0.5, "NaN", "Infinity", 15600001])("invalid discount %s is rejected", discount => {
    expect(() => quote({ discount })).toThrow(/Diskon/);
  });
  it("discount is consistent with canonical items and changes invalidate the preview key", () => {
    const q = quote({ discount: 600000 });
    expect(q.total).toBe(15000000);
    expect(checkInvoiceConsistency({ ...q, materials_detail: q.line_items }).ok).toBe(true);
    expect(q.quote_key).not.toBe(quote().quote_key);
  });
  it("unavailable price book or a foreign/missing asset never becomes a zero invoice", () => {
    expect(() => quote({ clientPrices: null })).toThrow(/belum berhasil dimuat/);
    expect(() => maintenanceLogInvoiceLine(log, null, [])).toThrow(/Aset/);
    expect(() => maintenanceLogInvoiceLine(log, { ...split, client_id: "foreign" }, [])).toThrow(/bukan milik/);
  });
});
