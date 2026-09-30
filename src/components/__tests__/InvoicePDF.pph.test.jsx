import { describe, expect, it } from "vitest";
import { pdf } from "@react-pdf/renderer";
import InvoicePDF from "../InvoicePDF.jsx";

const baseInvoice = {
  id: "INV-PPH-TEST",
  job_id: "JOB-PPH-TEST",
  customer: "PT TEST PPH",
  phone: "628111111111",
  address: "Tangerang",
  service: "Cleaning",
  units: [{ id: "U-1" }, { id: "U-2" }],
  labor: 390000,
  material: 250000,
  discount: 0,
  trade_in: false,
  total: 640000,
  pph23: true,
  pph23_amount: 10000,
  status: "UNPAID",
  due: "2026-10-07",
  created_at: "2026-09-30T00:00:00Z",
  materials_detail: [
    { nama: "Cleaning AC", jumlah: 2, satuan: "Unit", harga_satuan: 150000, subtotal: 300000, keterangan: "jasa", category: "LABOR" },
    { nama: "Transport", jumlah: 1, satuan: "Trip", harga_satuan: 90000, subtotal: 90000, keterangan: "jasa", category: "FEE" },
    { nama: "Kapasitor", jumlah: 1, satuan: "Pcs", harga_satuan: 250000, subtotal: 250000, keterangan: "barang", category: "PART" },
  ],
};

describe("InvoicePDF PPh 23", () => {
  it("merender invoice tunggal dengan gross-up PPh tanpa crash", async () => {
    const blob = await pdf(
      <InvoicePDF inv={baseInvoice} appSettings={{ pph23_rate: "0.025" }} />
    ).toBlob();
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("merender invoice gabungan yang berisi PPh dan non-PPh", async () => {
    const regular = {
      ...baseInvoice,
      id: "INV-NON-PPH-TEST",
      job_id: "JOB-NON-PPH-TEST",
      pph23: false,
      pph23_amount: 0,
    };
    const blob = await pdf(
      <InvoicePDF
        invList={[{ inv: baseInvoice }, { inv: regular }]}
        unified
        appSettings={{ pph23_rate: "0.025" }}
      />
    ).toBlob();
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);
  });
});
