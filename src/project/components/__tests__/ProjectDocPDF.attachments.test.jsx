import React from "react";
import { describe, expect, it } from "vitest";
import { pdf } from "@react-pdf/renderer";
import ProjectDocPDF from "../ProjectDocPDF.jsx";

const PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("ProjectDocPDF attachments", () => {
  it("merender dokumen dan halaman lampiran sebagai satu PDF", async () => {
    const doc = {
      jenis: "Berita Acara Pengerjaan",
      nomor: "BA/AC/2026/09/001",
      tanggal: "2026-09-14",
      kepada: "PIC Customer",
      uraian: "Pekerjaan selesai dan diuji.",
      items: [{ pekerjaan: "Cleaning AC", qty: "2", satuan: "unit", ket: "Baik" }],
      checklist: [{ item: "Uji fungsi", done: true }],
      ttdTeknisi: "Teknisi AClean",
      ttdCustomer: "PIC Customer",
      attachments: Array.from({ length: 5 }, (_, index) => ({
        id: `foto-${index}`,
        url: PIXEL_PNG,
        caption: `Kondisi ${index + 1}`,
      })),
    };
    const blob = await pdf(<ProjectDocPDF doc={doc} project={{ nama: "PT Test", lokasi: "Tangerang" }} />).toBlob();
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);
  }, 15000);
});
