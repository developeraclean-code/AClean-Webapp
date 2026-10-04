import { describe, expect, it, vi } from "vitest";
import { createWaOrderDraft, createWaPlanningForm, customerRecords, fetchWaHistory, invoiceBalance, matchesConversation, paymentReminder } from "../waWorkspace.js";

const customers = [
  { id: "a", name: "Bapak Andi Rumah", phone: "081234567890", address: "Rumah" },
  { id: "b", name: "Bapak Andi Kantor", phone: "6281234567890", address: "Kantor" },
];

describe("WhatsApp customer context", () => {
  it("requires a location for shared phone numbers and respects permanent customer IDs", () => {
    const rows = [
      { id: 1, customer_id: "a", customer: "Nama lama", phone: "000" },
      { id: 2, customer_id: "b", customer: customers[0].name, phone: customers[0].phone },
      { id: 3, customer: customers[1].name, phone: customers[0].phone },
      { id: 4, customer: customers[0].name, phone: customers[0].phone },
    ];
    expect(customerRecords(rows, null, customers[0].phone, customers)).toEqual([]);
    expect(customerRecords(rows, customers[0], customers[0].phone, customers).map(r => r.id)).toEqual([1, 4]);
  });
  it("finds normalized phones, customer names, and message previews", () => {
    const conv = { name: "Andi", phone: "6281234567890", last_message: "Bisa hari Senin?" };
    expect(matchesConversation(conv, customers, "+62 812-3456-7890")).toBe(true);
    expect(matchesConversation(conv, customers, "kantor")).toBe(true);
    expect(matchesConversation(conv, customers, "senin")).toBe(true);
    expect(matchesConversation(conv, customers, "tidak ditemukan")).toBe(false);
  });
  it("prefills reorder without copying an old schedule, crew, payment, or maintenance units", () => {
    const draft = createWaOrderDraft({ phone: customers[0].phone }, customers[0], {
      id: "JOB-OLD", service: "Repair", units: 3, date: "2026-01-01", teknisi: "Tim lama",
      maintenance_client_id: "old", maintenance_unit_ids: ["unit-lama"], status: "PAID",
    });
    expect(draft).toMatchObject({ customer: customers[0].name, phone: "6281234567890", service: "Repair", units: 3, date: "", teknisi: "", maintenance_client_id: "", maintenance_unit_ids: [] });
    expect(draft.status).toBeUndefined();
    expect(draft.notes).toContain("JOB-OLD");
  });
  it("keeps the selected date and customer location but defers all personnel and confirmation", () => {
    const draft = createWaOrderDraft({ phone: customers[1].phone }, customers[1]);
    const form = createWaPlanningForm({ ...draft, date: "2099-10-10", time: "10:30", teknisi: "Tim Rian", helper: "Lama", teknisi2: "Lama 2", team_slot: "Team 01", status: "DISPATCHED" }, () => "11:30");
    expect(form).toMatchObject({ customer_id: "b", address: "Kantor", date: "2099-10-10", time: "10:30", time_end: "11:30", status: "PENDING", team_slot: "Team 01", teknisi: "", helper: "" });
    expect(form.teknisi2).toBeUndefined();
    expect(form.notes).toContain("Referensi slot: Tim Rian");
    expect(createWaPlanningForm(draft, () => "10:00").date).toBe("");
  });
});

describe("WhatsApp payment reminders", () => {
  it("uses the outstanding amount and excludes paid/unapproved/cancelled invoices", () => {
    expect(invoiceBalance({ status: "PARTIAL_PAID", total: "500000", paid_amount: "200000" })).toBe(300000);
    expect(invoiceBalance({ status: "PARTIAL_PAID", total: 500000, remaining_amount: 0 })).toBe(0);
    for (const status of ["PAID", "PENDING_APPROVAL", "CANCELLED"]) expect(invoiceBalance({ status, total: 500000 })).toBe(0);
    expect(invoiceBalance({ status: "UNPAID", total: 500000 })).toBe(500000);
    expect(invoiceBalance({ status: "PARTIAL_PAID", total: 50, paid_amount: 100 })).toBe(0);
  });
  it("composes a partial-payment reminder from invoice data", () => {
    const draft = paymentReminder("Andi", { id: "INV-1", status: "PARTIAL_PAID", total: 500000, paid_amount: 200000 });
    expect(draft).toContain("300.000");
    expect(draft).not.toContain("500.000");
    expect(draft).toContain("INV-1");
  });
});

describe("WhatsApp history reads", () => {
  const mockDb = results => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn() };
    results.forEach(r => query.limit.mockResolvedValueOnce(r));
    return { from: vi.fn(() => query), query };
  };
  it("requests the newest messages, then displays them oldest to newest", async () => {
    const db = mockDb([{ data: [{ id: 102 }, { id: 101 }] }]);
    expect(await fetchWaHistory(db, "62812", 100)).toEqual([{ id: 101 }, { id: 102 }]);
    expect(db.query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(db.query.limit).toHaveBeenCalledWith(100);
  });
  it("supports older schemas without image_url and surfaces database errors", async () => {
    const db = mockDb([{ error: { code: "42703" } }, { data: [{ id: 1 }] }]);
    expect(await fetchWaHistory(db, "62812")).toEqual([{ id: 1 }]);
    expect(db.query.select.mock.calls[1][0]).not.toContain("image_url");
    await expect(fetchWaHistory(mockDb([{ error: { message: "Access denied" } }]), "62812")).rejects.toThrow("Access denied");
  });
});
