import { describe, expect, it } from "vitest";
import {
  QUOTATION_PAYMENT,
  filterQuotationCustomers,
  mergeQuotationCustomers,
  quotationHalfPayment,
  quotationPaymentDetails,
} from "../quotation.js";

const customers = [
  { id: "1", name: "Ibu Dian Melati Mas", phone: "628179527958", area: "Melati Mas" },
  { id: "2", name: "Bapak Budi", phone: "628121111222", area: "BSD" },
];

describe("quotation payment", () => {
  it("menghitung quick option 50% sampai rupiah terdekat", () => {
    expect(quotationHalfPayment(1_000_001)).toBe(500_001);
  });

  it("menghitung DP dan sisa pembayaran tanpa melewati total", () => {
    expect(quotationPaymentDetails({
      method: QUOTATION_PAYMENT.DOWN_PAYMENT,
      downPaymentAmount: 600_000,
      total: 1_500_000,
    })).toEqual({ method: "DOWN_PAYMENT", downPaymentAmount: 600_000, remainingAmount: 900_000 });

    expect(quotationPaymentDetails({
      method: QUOTATION_PAYMENT.DOWN_PAYMENT,
      downPaymentAmount: 2_000_000,
      total: 1_500_000,
    }).downPaymentAmount).toBe(1_500_000);
  });

  it("mengosongkan DP untuk transfer full", () => {
    expect(quotationPaymentDetails({ method: "FULL_TRANSFER", downPaymentAmount: 500_000, total: 1_000_000 }))
      .toEqual({ method: "FULL_TRANSFER", downPaymentAmount: 0, remainingAmount: 1_000_000 });
  });
});

describe("quotation customer suggestion", () => {
  it.each(["0817-9527-958", "+62 817 9527 958", "628179527958"])(
    "menemukan customer dari variasi nomor %s",
    (query) => expect(filterQuotationCustomers(customers, query)[0]?.id).toBe("1"),
  );

  it("mencari nama tanpa peka kapital", () => {
    expect(filterQuotationCustomers(customers, "dian melati")[0]?.id).toBe("1");
  });

  it("menggabungkan hasil lokal/server tanpa duplikat", () => {
    const serverCopy = { ...customers[0], name: "IBU DIAN MELATI MAS" };
    expect(mergeQuotationCustomers(customers, [serverCopy])).toHaveLength(2);
  });
});
