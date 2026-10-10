import { describe, expect, it } from "vitest";
import { dismissedProofsForInvoice, invoiceProofAction, pendingProofsForInvoice } from "../paymentEvidence.js";

const invoice = { id: "INV-1", phone: "081234567890", total: 195000 };
const proof = { id: "S1", status: "PENDING", validation_status: "PENDING", image_url: "/api/foto?key=x.jpg", phone: "6281234567890", amount: 195000 };

describe("pendingProofsForInvoice", () => {
  it("shows an explicit invoice match and an exact unlinked phone/amount match", () => {
    expect(pendingProofsForInvoice([{ ...proof, invoice_id: "INV-1" }, { ...proof, id: "S2", invoice_id: null }], invoice).map(s => s.id)).toEqual(["S1", "S2"]);
  });

  it("does not surface dismissed, paid, another invoice, or different-amount proof as this invoice's candidate", () => {
    const rows = [
      { ...proof, status: "DISMISSED" },
      { ...proof, validation_status: "LINKED" },
      { ...proof, invoice_id: "INV-2" },
      { ...proof, amount: 200000 },
      { ...proof, phone: "6281111111111" },
    ];
    expect(pendingProofsForInvoice(rows, invoice)).toEqual([]);
  });

  it("keeps a previously dismissed proof in a separate explicit review lane", () => {
    expect(dismissedProofsForInvoice([{ ...proof, status: "DISMISSED", invoice_id: "INV-1" }], invoice)).toHaveLength(1);
    expect(dismissedProofsForInvoice([{ ...proof, status: "DISMISSED", validation_status: "REJECTED", invoice_id: "INV-1" }], invoice)).toEqual([]);
  });

  it("prevents a second payment or replacing an already attached proof", () => {
    expect(invoiceProofAction({ status: "UNPAID", payment_proof_url: null })).toBe("settle");
    expect(invoiceProofAction({ status: "PAID", payment_proof_url: null })).toBe("attach_only");
    expect(invoiceProofAction({ status: "PAID", payment_proof_url: "verified-no-proof" })).toBe("attach_only");
    expect(invoiceProofAction({ status: "PAID", payment_proof_url: "verified-manual-no-proof" })).toBe("attach_only");
    expect(invoiceProofAction({ status: "PAID", payment_proof_url: "/api/foto?key=proof.jpg" })).toBe("already_attached");
    expect(invoiceProofAction({ status: "UNPAID", payment_proof_url: "/api/foto?key=proof.jpg" })).toBe("already_attached");
    expect(invoiceProofAction({ status: "CANCELLED", payment_proof_url: null })).toBe("unavailable");
  });
});
