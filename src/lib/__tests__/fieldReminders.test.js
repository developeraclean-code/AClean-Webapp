import { describe, expect, it } from "vitest";
import { buildFieldReminders, claimFieldReminder } from "../fieldReminders.js";

describe("field reminders", () => {
  const now = new Date("2026-09-27T09:20:00+07:00");

  it("reminds the assigned employee 40 minutes before the next job", () => {
    const rows = buildFieldReminders({
      orders: [{ id: "NEXT", date: "2026-09-27", time: "10:00", status: "CONFIRMED", customer: "Belfood", helper: "Ari" }],
      reports: [], employeeName: "ari", today: "2026-09-27", now,
    });
    expect(rows).toContainEqual(expect.objectContaining({ type: "upcoming", message: expect.stringContaining("40 menit") }));
  });

  it("does not remind an unassigned employee or completed job", () => {
    const rows = buildFieldReminders({
      orders: [
        { id: "OTHER", date: "2026-09-27", time: "10:00", status: "CONFIRMED", customer: "A", teknisi: "Dedi" },
        { id: "DONE", date: "2026-09-27", time: "10:00", status: "PAID", customer: "B", teknisi: "Ari" },
      ], reports: [], employeeName: "Ari", today: "2026-09-27", now,
    });
    expect(rows.some(row => row.type === "upcoming")).toBe(false);
  });

  it("reminds delayed reports and material reconciliation", () => {
    const rows = buildFieldReminders({
      orders: [{ id: "OLD", date: "2026-09-26", time: "09:00", time_end: "10:00", status: "COMPLETED", customer: "Customer", teknisi: "Ari" }],
      reports: [], employeeName: "Ari", today: "2026-09-27", now, materialsBroughtMap: { OLD: 2 },
    });
    expect(rows.map(row => row.type)).toEqual(expect.arrayContaining(["material", "report"]));
  });

  it("claims the same reminder only once", () => {
    const data = new Map();
    const store = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
    expect(claimFieldReminder({ key: "job:A:today" }, store)).toBe(true);
    expect(claimFieldReminder({ key: "job:A:today" }, store)).toBe(false);
  });
});
