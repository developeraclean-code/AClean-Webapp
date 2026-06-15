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
  it("refuses partial match when the phone has multiple customers (multi-lokasi)", () => {
    // 081234567890 dipakai 2 customer → ambigu, jangan menebak (return null)
    expect(findCustomer(customers, "081234567890", "Bapak Dedy")).toBe(null);
  });
  it("allows partial first-name match when the phone has a single customer", () => {
    const single = [{ id: 5, name: "Bapak Dedy Jelita", phone: "081234567890" }];
    expect(findCustomer(single, "081234567890", "Bapak Dedy").id).toBe(5);
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

  describe("multi-lokasi scoping (allCustomers passed)", () => {
    // 1 HP dipakai 2 customer (beda nama/lokasi)
    const allCustomers = [
      { id: 1, name: "Bapak Dedy Jelita", phone: "081234567890", address: "Jelita Residence" },
      { id: 2, name: "Bapak Dedy Aruna", phone: "6281234567890", address: "Aruna Tower" },
    ];
    const multiOrders = [
      { id: "JOB-A", customer: "Bapak Dedy Jelita", phone: "081234567890", date: "2026-04-10", status: "DONE" },
      { id: "JOB-B", customer: "Bapak Dedy Aruna", phone: "081234567890", date: "2026-04-12", status: "DONE" },
    ];
    it("scopes history strictly by name when phone is multi-lokasi", () => {
      const hJelita = buildCustomerHistory(allCustomers[0], multiOrders, [], [], allCustomers);
      expect(hJelita.map(j => j.id)).toEqual(["JOB-A"]);
      const hAruna = buildCustomerHistory(allCustomers[1], multiOrders, [], [], allCustomers);
      expect(hAruna.map(j => j.id)).toEqual(["JOB-B"]);
    });
    it("keeps phone-OR fallback for single-lokasi phone", () => {
      // allCustomers hanya punya 1 customer dengan HP ini → tetap match by phone
      const single = [{ id: 9, name: "Bapak Dedy", phone: "081234567890" }];
      const h = buildCustomerHistory(single[0], orders, laporan, invoices, single);
      expect(h).toHaveLength(2); // JOB-001 (name) + JOB-002 (phone, nama sama)
    });
  });

  describe("link permanen via customer_id (tahan edit phone/nama)", () => {
    const cust = { id: "CUST067", name: "BAPAK EDWIN ALBERA", phone: "6281280588882" };
    it("tetap menarik order via customer_id walau phone customer sudah diedit (beda dari order)", () => {
      // Order masih simpan phone LAMA, customer sudah ganti phone BARU → tanpa customer_id link putus.
      const ords = [
        { id: "JOB-PAID", customer_id: "CUST067", customer: "BAPAK EDWIN ALBERA", phone: "6281111111111", date: "2026-04-07", status: "PAID" },
      ];
      const editedCust = { ...cust, phone: "6289999999999" }; // phone baru, beda dari order
      const h = buildCustomerHistory(editedCust, ords, [], []);
      expect(h.map(j => j.id)).toEqual(["JOB-PAID"]);
    });
    it("tetap menarik order via customer_id walau NAMA customer diedit", () => {
      const ords = [
        { id: "JOB-X", customer_id: "CUST067", customer: "EDWIN LAMA", phone: "6281280588882", date: "2026-04-07", status: "PAID" },
      ];
      const renamed = { ...cust, name: "BAPAK EDWIN ALBERA (BENAR)" };
      const h = buildCustomerHistory(renamed, ords, [], []);
      expect(h.map(j => j.id)).toEqual(["JOB-X"]);
    });
    it("TIDAK mengklaim order milik customer lain via phone/nama saat order itu sudah punya customer_id", () => {
      // Order JOB-OTHER milik CUST999 tapi kebetulan phone sama dengan customer ini.
      const ords = [
        { id: "JOB-OTHER", customer_id: "CUST999", customer: "ORANG LAIN", phone: "6281280588882", date: "2026-04-07", status: "PAID" },
      ];
      const h = buildCustomerHistory(cust, ords, [], []);
      expect(h).toHaveLength(0);
    });
    it("order legacy tanpa customer_id tetap match by phone/nama (backward compat)", () => {
      const ords = [
        { id: "JOB-LEGACY", customer: "BAPAK EDWIN ALBERA", phone: "6281280588882", date: "2026-04-07", status: "PAID" },
      ];
      const h = buildCustomerHistory(cust, ords, [], []);
      expect(h.map(j => j.id)).toEqual(["JOB-LEGACY"]);
    });
  });
});
