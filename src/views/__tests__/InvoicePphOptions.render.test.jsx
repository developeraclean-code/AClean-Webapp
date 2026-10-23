import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import InvoicePreviewModal from "../InvoicePreviewModal.jsx";
import EditInvoiceModal from "../EditInvoiceModal.jsx";
import { computePph23 } from "../../lib/invoicing.js";

const noop = () => {};
const invoice = {
  id: "INV-PPH-CHOICE",
  customer: "PT Contoh",
  labor: 1000000,
  material: 100000,
  total: 1100000,
  pph23: true,
  pph23_amount: computePph23(1000000, 0.025).amount,
  materials_detail: [],
  status: "UNPAID",
};

describe("pilihan PPh 23 pada invoice", () => {
  it("preview/generate menampilkan dua pilihan dan membaca 2,5% yang tersimpan", () => {
    const html = renderToStaticMarkup(<InvoicePreviewModal
      open selectedInvoice={invoice} invoicesData={[invoice]} setInvoicesData={noop}
      computePph23={computePph23} generateInvoicePDFBlob={noop} fmt={String}
    />);
    expect(html).toContain("PPh 23 2%");
    expect(html).toContain("PPh 23 2,5%");
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });

  it("form edit menjaga pilihan 2,5% dan basis Jasa", () => {
    const html = renderToStaticMarkup(<EditInvoiceModal
      open editInvoiceData={invoice}
      editInvoiceForm={{ pph23: true, pph23_rate: 0.025, discount: 0, trade_in: false }}
      setEditInvoiceForm={noop} editInvoiceItems={[]} setEditInvoiceItems={noop}
      editJasaItems={[{ nama: "Jasa", jumlah: 1, harga_satuan: 1000000, subtotal: 1000000, keterangan: "jasa" }]}
      setEditJasaItems={noop} priceListData={[]} inventoryData={[]} customersData={[]}
      lookupHargaGlobal={noop} parseMD={noop} fmt={String}
    />);
    expect(html).toContain("PPh 23 2%");
    expect(html).toContain("PPh 23 2,5%");
    expect(html).toContain("dari Jasa saja");
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });
});
