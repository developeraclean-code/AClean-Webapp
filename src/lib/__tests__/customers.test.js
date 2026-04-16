import { describe, it, expect } from "vitest";
import { sameCustomer, findCustomer, buildCustomerHistory } from "../customers.js";

describe("sameCustomer", () => {
  it("matches phone + name (case-insensitive, trim)", () => {
    const c = { name: "Bapak Dedy Jelita", phone: "081234567890" };
    expect(sameCustomer(c, "6281234567890", "bapak dedy jelita")).toBe(true);
    expect(sameCustomer(c, "081234567890", "  Bapak Dedy Jelita  ")).toBe(true);
  });
  it("rejects same phone but different full name", () => {
    const c = { name: "Bapak Dedy Jelita", phone: "081234567890" };
    expect(sameCustomer(c, "081234567890", "Bapak Dedy Aruna")).toBe(false);
  });
  it("rejects when falsy inputs", () => {
    const c = { name: "X", phone: "081" };
    expect(sameCustomer(null, "081", "X")).toBe(false);
    expect(sameCustomer(c, "", "X")).toBe(false);
    expect(sameCustomer(c, "081", "")).toBe(false);
  });
});

describe("findCustomer", () => {
  const customers = [
    { id: 1, name: "Bapak Dedy Jelita", phone: "081234567890" },
    { id: 2, name: "Bapak Dedy Aruna", phone: "081234567890" },
    { id: 3, name: "Ibu Sari", phone: "085555555555" },
  ];
  it("finds exact phone+name match", () => {
    expect(findCustomer(customers, "081234567890", "Bapak Dedy Jelita").id).toBe(1);
    expect(findCustomer(customers, "081234567890", "Bapak Dedy Aruna").id).toBe(2);
  });
  it("falls back to partial first-name match on same phone", () => {
    const r = findCustomer(customers, "081234567890", "Bapak Dedy");
    expect([1, 2]).toContain(r.id);
  });
  it("finds by phone only", () => {
    expect(findCustomer(customers, "085555555555", "").id).toBe(3);
  });
  it("finds by name only", () => {
    expect(findCustomer(customers, "", "Ibu Sari").id).toBe(3);
  });
  it("returns null when nothing matches", () => {
    expect(findCustomer(customers, "089999999999", "Unknown")).toBe(null);
    expect(findCustomer(customers, "", "")).toBe(null);
  });
});

describe("buildCustomerHistory", () => {
  const customer = { id: 1, name: "Bapak Dedy", phone: "081234567890" };
  const orders = [
    { id: "JOB-001", customer: "Bapak Dedy", phone: "081234567890", date: "2026-04-10", service: "Cleaning", type: "Split 1PK", units: 1, status: "DONE" },
    { id: "JOB-002", customer: "Bapak Dedy", phone: "6281234567890", date: "2026-04-12", service: "Install", type: "Split 2PK", units: 1, status: "DONE" },
    { id: "JOB-003", customer: "Ibu Sari", phone: "085555555555", date: "2026-04-13", service: "Cleaning", type: "Split 1PK", units: 1, status: "DONE" },
  ];
  const laporan = [
    { id: "LAP-1", job_id: "JOB-001", units: [{ tipe: "Split 1PK" }], materials: [], total_freon: 0 },
  ];
  const invoices = [
    { id: "INV-1", job_id: "JOB-001", total: 85000, status: "PAID" },
  ];
  it("filters by name or phone, sorts by date desc", () => {
    const h = buildCustomerHistory(customer, orders, laporan, invoices);
    expect(h).toHaveLength(2);
    expect(h[0].id).toBe("JOB-002");
    expect(h[1].id).toBe("JOB-001");
  });
  it("merges invoice + laporan onto matched order", () => {
    const h = buildCustomerHistory(customer, orders, laporan, invoices);
    const job1 = h.find(j => j.id === "JOB-001");
    expect(job1.invoice_id).toBe("INV-1");
    expect(job1.invoice_total).toBe(85000);
    expect(job1.invoice_status).toBe("PAID");
    expect(job1.laporan_id).toBe("LAP-1");
    expect(job1.unit_detail).toEqual([{ tipe: "Split 1PK" }]);
  });
  it("returns empty for null customer", () => {
    expect(buildCustomerHistory(null, orders, laporan, invoices)).toEqual([]);
  });
});
