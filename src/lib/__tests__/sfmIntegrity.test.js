import { describe, expect, it } from "vitest";
import {
  applySafeIntegrityRepairs,
  auditOperationalIntegrity,
  canTransitionOrderStatus,
  createSyntheticOperationalState,
  simulateAtomicLifecycleBatch,
  simulateOperationalIntegrity,
} from "../sfmIntegrity.js";

describe("SFM state transition guard", () => {
  it("menerima alur normal dan menolak lompatan/rollback berbahaya", () => {
    expect(canTransitionOrderStatus("CONFIRMED", "DISPATCHED")).toBe(true);
    expect(canTransitionOrderStatus("DISPATCHED", "REPORT_SUBMITTED")).toBe(true);
    expect(canTransitionOrderStatus("PAID", "WORKING")).toBe(false);
    expect(canTransitionOrderStatus("PAID", "WORKING", { privilegedReversal: true })).toBe(true);
  });
});

describe("SFM integrity audit & safe self-repair", () => {
  it("100 pekerjaan sehat menghasilkan nol temuan", () => {
    const audit = auditOperationalIntegrity(createSyntheticOperationalState(100));
    expect(audit.scanned.orders).toBe(100);
    expect(audit.issues).toEqual([]);
  });

  it("simulasi 100 pekerjaan memperbaiki semua kasus deterministik", () => {
    const result = simulateOperationalIntegrity(100);
    expect(result.totalJobs).toBe(100);
    expect(result.before.repairable).toBeGreaterThan(0);
    expect(result.applied.length).toBe(result.before.repairable);
    expect(result.after.repairable).toBe(0);
    expect(result.after.manualReview).toBeGreaterThan(0);
    expect(result.idempotent).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(90);
  });

  it("tidak mengarang payment untuk invoice PAID tanpa ledger", () => {
    const state = createSyntheticOperationalState(1);
    state.invoicePayments = [];
    const audit = auditOperationalIntegrity(state);
    expect(audit.issues.some(row => row.type === "PAID_WITHOUT_LEDGER" && !row.repairable)).toBe(true);
    const repaired = applySafeIntegrityRepairs(state, audit);
    expect(repaired.state.invoicePayments).toEqual([]);
  });

  it("self-repair kedua idempotent", () => {
    const state = createSyntheticOperationalState(10);
    state.orders[0].status = "INVOICE_APPROVED";
    const firstAudit = auditOperationalIntegrity(state);
    const first = applySafeIntegrityRepairs(state, firstAudit);
    const secondAudit = auditOperationalIntegrity(first.state);
    const second = applySafeIntegrityRepairs(first.state, secondAudit);
    expect(first.applied.length).toBeGreaterThan(0);
    expect(second.applied).toEqual([]);
  });

  it("menjalankan lifecycle 100 job dan rollback setiap kegagalan terkontrol", () => {
    const result = simulateAtomicLifecycleBatch(100);
    expect(result.totalJobs).toBe(100);
    expect(result.forcedFailures).toBeGreaterThan(0);
    expect(result.verifiedRollbacks).toBe(result.forcedFailures);
    expect(result.allRollbacksVerified).toBe(true);
    expect(result.audit.issues).toEqual([]);
    expect(result.state.orders).toHaveLength(100);
    expect(result.state.reports).toHaveLength(80);
    expect(result.state.invoices).toHaveLength(70);
    expect(result.state.invoicePayments).toHaveLength(50);
  });
});
