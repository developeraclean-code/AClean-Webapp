import { describe, expect, it } from "vitest";
import { canReviewSettlement, isUsablePaymentProof, settlementBalance } from "../invoiceSettlementReview.js";

const invoice = {
  id: "INV-20261023-AB12", status: "UNPAID", total: 390000, paid_amount: 0,
  remaining_amount: 390000, payment_proof_url: "/api/foto?key=payment-proof",
};

describe("manual invoice settlement review", () => {
  it("requires explicit review and exact invoice ID for a transfer", () => {
    const form = { invoice, method: "transfer", reason: "", acknowledged: true, typedInvoiceId: invoice.id };
    expect(canReviewSettlement(form)).toBe(true);
    expect(canReviewSettlement({ ...form, acknowledged: false })).toBe(false);
    expect(canReviewSettlement({ ...form, typedInvoiceId: "INV-OTHER" })).toBe(false);
    expect(canReviewSettlement({ ...form, invoice: { ...invoice, payment_proof_url: null } })).toBe(false);
  });

  it("rejects placeholders as transfer evidence", () => {
    expect(isUsablePaymentProof("verified-no-proof")).toBe(false);
    expect(isUsablePaymentProof("purged-90d")).toBe(false);
    expect(isUsablePaymentProof("/api/foto?key=payment-proof")).toBe(true);
  });

  it("permits cash only with a meaningful reason and an outstanding balance", () => {
    const form = { invoice: { ...invoice, payment_proof_url: null }, method: "cash", reason: "Diterima kasir 23 Oktober", acknowledged: true, typedInvoiceId: invoice.id };
    expect(canReviewSettlement(form)).toBe(true);
    expect(canReviewSettlement({ ...form, reason: "cash" })).toBe(false);
    expect(canReviewSettlement({ ...form, invoice })).toBe(false);
    expect(canReviewSettlement({ ...form, invoice: { ...form.invoice, status: "PAID" } })).toBe(false);
    expect(canReviewSettlement({ ...form, invoice: { ...form.invoice, remaining_amount: 0 } })).toBe(false);
  });

  it("shows the remaining balance for partial payments", () => {
    expect(settlementBalance({ total: 390000, paid_amount: 100000 })).toBe(290000);
    expect(settlementBalance({ total: 390000, paid_amount: 100000, remaining_amount: 290000 })).toBe(290000);
  });
});
