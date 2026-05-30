import { describe, it, expect } from "vitest";
import {
  detectContinuationCandidates,
  calcContinuationDayNum,
  VALID_ORDER_STATUSES,
  VALID_ORDER_SERVICES,
} from "../orders.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TODAY = "2026-05-27";

function makeOrder(overrides = {}) {
  return {
    id: "JOB-001",
    phone: "6281234567890",
    date: TODAY,
    status: "CONFIRMED",
    service: "Cleaning",
    units: 1,
    parent_job_id: null,
    is_multi_day: false,
    ...overrides,
  };
}

// ── detectContinuationCandidates ─────────────────────────────────────────────

describe("detectContinuationCandidates", () => {
  it("returns matching open order for same phone", () => {
    const orders = [makeOrder()];
    const result = detectContinuationCandidates(orders, "081234567890", { today: TODAY });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("JOB-001");
  });

  it("matches across phone formats (08 vs 628)", () => {
    const orders = [makeOrder({ phone: "6281234567890" })];
    const result = detectContinuationCandidates(orders, "081234567890", { today: TODAY });
    expect(result).toHaveLength(1);
  });

  it("excludes orders older than cutoffDays", () => {
    const oldDate = "2026-05-23"; // 4 hari sebelum TODAY
    const orders = [makeOrder({ date: oldDate })];
    const result = detectContinuationCandidates(orders, "081234567890", { today: TODAY, cutoffDays: 3 });
    expect(result).toHaveLength(0);
  });

  it("includes order exactly at cutoff boundary", () => {
    const cutoffDate = "2026-05-24"; // tepat H-3
    const orders = [makeOrder({ date: cutoffDate })];
    const result = detectContinuationCandidates(orders, "081234567890", { today: TODAY, cutoffDays: 3 });
    expect(result).toHaveLength(1);
  });

  it("excludes orders with parent_job_id (child/continuation orders)", () => {
    const orders = [makeOrder({ parent_job_id: "JOB-000" })];
    const result = detectContinuationCandidates(orders, "081234567890", { today: TODAY });
    expect(result).toHaveLength(0);
  });

  it("excludes COMPLETED orders", () => {
    const orders = [makeOrder({ status: "COMPLETED" })];
    const result = detectContinuationCandidates(orders, "081234567890", { today: TODAY });
    expect(result).toHaveLength(0);
  });

  it("excludes PAID orders", () => {
    const orders = [makeOrder({ status: "PAID" })];
    const result = detectContinuationCandidates(orders, "081234567890", { today: TODAY });
    expect(result).toHaveLength(0);
  });

  it("excludes CANCELLED orders", () => {
    const orders = [makeOrder({ status: "CANCELLED" })];
    const result = detectContinuationCandidates(orders, "081234567890", { today: TODAY });
    expect(result).toHaveLength(0);
  });

  it("includes all OPEN_STATUSES", () => {
    const openStatuses = [
      "PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "WORKING",
      "REPORT_SUBMITTED", "INVOICE_CREATED", "INVOICE_APPROVED",
    ];
    for (const status of openStatuses) {
      const orders = [makeOrder({ status })];
      const result = detectContinuationCandidates(orders, "081234567890", { today: TODAY });
      expect(result, `status ${status} harus terdeteksi`).toHaveLength(1);
    }
  });

  it("excludes different phone numbers", () => {
    const orders = [makeOrder({ phone: "6289999999999" })];
    const result = detectContinuationCandidates(orders, "081234567890", { today: TODAY });
    expect(result).toHaveLength(0);
  });

  it("returns empty for phone shorter than 8 digits", () => {
    const orders = [makeOrder()];
    expect(detectContinuationCandidates(orders, "0812", { today: TODAY })).toHaveLength(0);
    expect(detectContinuationCandidates(orders, "", { today: TODAY })).toHaveLength(0);
    expect(detectContinuationCandidates(orders, null, { today: TODAY })).toHaveLength(0);
  });

  it("returns empty for empty ordersData", () => {
    expect(detectContinuationCandidates([], "081234567890", { today: TODAY })).toHaveLength(0);
    expect(detectContinuationCandidates(null, "081234567890", { today: TODAY })).toHaveLength(0);
  });

  it("sorts results newest-first", () => {
    const orders = [
      makeOrder({ id: "JOB-OLD", date: "2026-05-25" }),
      makeOrder({ id: "JOB-NEW", date: "2026-05-27" }),
      makeOrder({ id: "JOB-MID", date: "2026-05-26" }),
    ];
    const result = detectContinuationCandidates(orders, "081234567890", { today: TODAY });
    expect(result.map(o => o.id)).toEqual(["JOB-NEW", "JOB-MID", "JOB-OLD"]);
  });

  it("returns multiple candidates for same phone with multiple open jobs", () => {
    const orders = [
      makeOrder({ id: "JOB-A", phone: "6281234567890" }),
      makeOrder({ id: "JOB-B", phone: "6281234567890", service: "Install" }),
    ];
    const result = detectContinuationCandidates(orders, "081234567890", { today: TODAY });
    expect(result).toHaveLength(2);
  });
});

// ── calcContinuationDayNum ────────────────────────────────────────────────────

describe("calcContinuationDayNum", () => {
  it("returns 2 for a standalone parent with no children", () => {
    const orders = [makeOrder({ id: "JOB-001" })];
    expect(calcContinuationDayNum(orders, "JOB-001")).toBe(2);
  });

  it("returns 3 when parent already has 1 multi-day child", () => {
    const orders = [
      makeOrder({ id: "JOB-001" }),
      makeOrder({ id: "JOB-002", parent_job_id: "JOB-001", is_multi_day: true }),
    ];
    expect(calcContinuationDayNum(orders, "JOB-001")).toBe(3);
  });

  it("returns 4 when parent already has 2 multi-day children", () => {
    const orders = [
      makeOrder({ id: "JOB-001" }),
      makeOrder({ id: "JOB-002", parent_job_id: "JOB-001", is_multi_day: true }),
      makeOrder({ id: "JOB-003", parent_job_id: "JOB-001", is_multi_day: true }),
    ];
    expect(calcContinuationDayNum(orders, "JOB-001")).toBe(4);
  });

  it("ignores non-multi-day children (e.g. Complain→Repair)", () => {
    const orders = [
      makeOrder({ id: "JOB-001" }),
      makeOrder({ id: "JOB-REPAIR", parent_job_id: "JOB-001", is_multi_day: false }),
    ];
    // Non-multi-day child tidak dihitung
    expect(calcContinuationDayNum(orders, "JOB-001")).toBe(2);
  });

  it("returns 2 as fallback when parentId is null", () => {
    expect(calcContinuationDayNum([], null)).toBe(2);
    expect(calcContinuationDayNum([], undefined)).toBe(2);
  });
});

// ── VALID_ORDER_STATUSES ──────────────────────────────────────────────────────

describe("VALID_ORDER_STATUSES — sync dengan DB constraint", () => {
  const DB_STATUSES = [
    "PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "WORKING",
    "REPORT_SUBMITTED", "INVOICE_CREATED", "INVOICE_APPROVED",
    "COMPLETED", "PAID", "CANCELLED", "OVERDUE", "CONTINUED",
  ];

  it("mencakup semua status yang diizinkan DB", () => {
    for (const s of DB_STATUSES) {
      expect(VALID_ORDER_STATUSES, `"${s}" harus ada di VALID_ORDER_STATUSES`).toContain(s);
    }
  });

  it("tidak ada status selain yang diizinkan DB (IN_PROGRESS legacy tidak valid)", () => {
    expect(VALID_ORDER_STATUSES).not.toContain("IN_PROGRESS");
  });

  it("CONTINUED tersedia (multi-day parent update)", () => {
    expect(VALID_ORDER_STATUSES).toContain("CONTINUED");
  });
});

// ── VALID_ORDER_SERVICES ──────────────────────────────────────────────────────

describe("VALID_ORDER_SERVICES — sync dengan DB constraint", () => {
  const DB_SERVICES = ["Cleaning", "Install", "Repair", "Complain", "Survey", "Project"];

  it("mencakup semua service yang diizinkan DB", () => {
    for (const s of DB_SERVICES) {
      expect(VALID_ORDER_SERVICES, `"${s}" harus ada di VALID_ORDER_SERVICES`).toContain(s);
    }
  });

  it("Maintenance TIDAK ada (sengaja dikecualikan, tidak valid di DB)", () => {
    expect(VALID_ORDER_SERVICES).not.toContain("Maintenance");
  });
});
