import { describe, expect, it } from "vitest";
import { pdf } from "@react-pdf/renderer";
import QuotationPDF from "../QuotationPDF.jsx";
import { computePph23 } from "../../lib/invoicing.js";

const quotation = {
  id: "QUO-PPH-TEST",
  customer: "PT TEST PPH",
  phone: "628111111111",
  created_at: "2026-10-13T00:00:00Z",
  valid_until: "2026-10-27",
  status: "DRAFT",
  items: [{ item_type: "jasa", description: "Jasa Cleaning", qty: 1, satuan: "Unit", unit_price: 1000000, subtotal: 1000000 }],
  labor: 1000000,
  total: 1000000,
  pph23: true,
  pph23_amount: computePph23(1000000).amount,
};

function documentText(node) {
  if (Array.isArray(node)) return node.map(documentText).join("");
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  return documentText(node.props?.children);
}

describe("QuotationPDF PPh 23", () => {
  it("mencetak tarif 2% sesuai nominal quotation baru", async () => {
    const element = <QuotationPDF quo={quotation} appSettings={{}} />;
    expect(documentText(QuotationPDF({ quo: quotation, appSettings: {} }))).toContain("PPh 23 (2%) dipotong customer");
    const blob = await pdf(element).toBlob();
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("quotation lama tetap menampilkan tarif 2,5% dari nominal tersimpan", () => {
    const old = { ...quotation, pph23_amount: computePph23(1000000, 0.025).amount };
    expect(documentText(QuotationPDF({ quo: old, appSettings: {} }))).toContain("PPh 23 (2,5%) dipotong customer");
  });

  it("DPP tetap dijumlahkan numerik saat nominal dari database berupa string", () => {
    const stored = { ...quotation, labor: "1000000", pph23_amount: "20408" };
    expect(documentText(QuotationPDF({ quo: stored, appSettings: {} }))).toContain("Nilai Jasa (DPP)Rp 1.020.408");
  });
});
