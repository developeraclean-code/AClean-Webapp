import { describe, expect, it } from "vitest";
import {
  buildExpenseCreateMeta,
  expenseAllocationStatus,
  expenseSimilarityKey,
  needsExpenseApproval,
  validateExpenseForm,
} from "../expensePolicy.js";

describe("expense policy", () => {
  it("requires approval only for Admin expense >= 500k", () => {
    expect(needsExpenseApproval("Admin", 499999)).toBe(false);
    expect(needsExpenseApproval("Admin", 500000)).toBe(true);
    expect(needsExpenseApproval("Owner", 900000)).toBe(false);
    expect(needsExpenseApproval("Finance", 900000)).toBe(false);
  });

  it("builds auditable metadata for manual entries", () => {
    expect(buildExpenseCreateMeta({ role: "Admin", amount: 500000, category: "material_purchase", userId: "u1" })).toEqual({
      approval_status: "PENDING_APPROVAL",
      created_by_user_id: "u1",
      source: "manual",
      allocation_status: "UNRESOLVED",
    });
  });

  it("classifies material allocation without forcing stock", () => {
    expect(expenseAllocationStatus({ category: "petty_cash" })).toBe("NOT_REQUIRED");
    expect(expenseAllocationStatus({ category: "material_purchase", order_id: "JOB-1" })).toBe("JOB");
    expect(expenseAllocationStatus({ category: "material_purchase", allocation_status: "NON_STOCK" })).toBe("NON_STOCK");
    expect(expenseAllocationStatus({ category: "material_purchase" })).toBe("UNRESOLVED");
  });

  it("rejects invalid amount and missing required context", () => {
    expect(validateExpenseForm({ category: "petty_cash", subcategory: "Parkir", amount: -1, date: "2026-09-13" }).amount).toBeTruthy();
    expect(validateExpenseForm({ category: "petty_cash", subcategory: "Bonus", amount: 10000, date: "2026-09-13" }).teknisi_name).toBeTruthy();
    expect(validateExpenseForm({ category: "material_purchase", subcategory: "Kabel", amount: 10000, date: "2026-09-13" }).item_name).toBeTruthy();
  });

  it("uses business similarity only as a review key", () => {
    const a = { date: "2026-09-13", amount: 10000, category: "petty_cash", subcategory: "Parkir", teknisi_name: "Aji" };
    const b = { ...a, teknisi_name: " aji " };
    expect(expenseSimilarityKey(a)).toBe(expenseSimilarityKey(b));
  });
});
