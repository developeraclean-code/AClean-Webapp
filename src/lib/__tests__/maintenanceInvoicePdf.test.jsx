import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { inflateSync } from "node:zlib";
import InvoicePDF from "../../components/InvoicePDF.jsx";
import { buildMaintenanceInvoiceQuote } from "../maintenanceInvoice.js";
import { dupoin, dupoinUnits, dupoinPrices } from "../../../scripts/data/dupoin-maintenance-20261015.mjs";

// Standard Times/WinAnsi PDF text, no image/font downloads or external PDF tooling.
function pdfText(buffer) {
  const streams = [...buffer.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  return streams.flatMap(m => {
    let text;
    try { text = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); }
    catch { return []; } // Other streams are not compressed text content.
    return [...text.matchAll(/<([0-9a-f]+)>/gi)].map(x => Buffer.from(x[1], "hex").toString("latin1"));
  }).join("");
}
describe("maintenance B2B invoice PDF", () => {
  it("renders all 52 asset descriptions, included outdoor Rp0 and correct grand total", async () => {
    const units = dupoinUnits.map((u, i) => ({ ...u, id: `unit-${i}`, client_id: dupoin.client_id }));
    const logs = units.map((u, i) => ({ id: `log-${i}`, unit_id: u.id, service_type: "Cuci Rutin", service_date: "2026-10-15" }));
    const quote = buildMaintenanceInvoiceQuote({ clientId: dupoin.client_id, logs, units, clientPrices: dupoinPrices });
    const buffer = await renderToBuffer(createElement(InvoicePDF, { inv: { ...quote, id: "INV-20261015-FIXTURE", customer: dupoin.name,
      materials_detail: JSON.stringify(quote.line_items), status: "PENDING_APPROVAL", created_at: "2026-10-15T09:00:00Z" }, logoUrl: null }));
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const text = pdfText(buffer);
    expect(text).toContain("15.600.000");
    expect(text.match(/termasuk penawaran/g)).toHaveLength(12);
    expect(text.match(/DUP-27-[A-H]-(?:ID|OD)-\d\d/g)).toHaveLength(52);
    expect(text).not.toContain("Belum ada item");
  }, 20000);
});
