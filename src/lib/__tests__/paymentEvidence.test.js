import { describe, expect, it } from "vitest";
import { dismissedProofsForInvoice, pendingProofsForInvoice } from "../paymentEvidence.js";

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
});
