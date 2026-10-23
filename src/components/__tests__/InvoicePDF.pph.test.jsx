import { describe, expect, it } from "vitest";
import { pdf } from "@react-pdf/renderer";
import InvoicePDF from "../InvoicePDF.jsx";
import { computePph23 } from "../../lib/invoicing.js";

function documentText(node) {
  if (Array.isArray(node)) return node.map(documentText).join("");
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (typeof node.type === "function") return documentText(node.type(node.props));
  return documentText(node.props?.children);
}

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
  it("merender invoice tunggal baru dengan PPh 2% tanpa crash", async () => {
    const newInvoice = { ...baseInvoice, pph23_amount: computePph23(baseInvoice.labor).amount };
    expect(documentText(InvoicePDF({ inv: newInvoice, appSettings: {} }))).toContain("PPh 23 (2%) dipotong customer");
    const blob = await pdf(
      <InvoicePDF inv={newInvoice} appSettings={{ pph23_rate: "0.02" }} />
    ).toBlob();
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("invoice lama tetap menampilkan 2,5% sesuai nominal tersimpan", () => {
    expect(documentText(InvoicePDF({ inv: baseInvoice, appSettings: {} }))).toContain("PPh 23 (2,5%) dipotong customer");
  });

  it("invoice baru dengan pilihan 2,5% menampilkan nominal dan tarif sesuai pilihan", () => {
    const selected = { ...baseInvoice, pph23_amount: computePph23(baseInvoice.labor, 0.025).amount };
    const text = documentText(InvoicePDF({ inv: selected, appSettings: {} }));
    expect(text).toContain("PPh 23 (2,5%) dipotong customer");
    expect(text).toContain(`- Rp ${selected.pph23_amount.toLocaleString("id-ID")}`);
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
        appSettings={{ pph23_rate: "0.02" }}
      />
    ).toBlob();
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);
  });
});
