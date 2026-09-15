import { describe, expect, it } from "vitest";
import { normalizeCustomerServiceReport } from "../customerServiceReport.js";

describe("normalizeCustomerServiceReport", () => {
  it("normalizes current JSONB report fields", () => {
    const result = normalizeCustomerServiceReport({
      id: "REP-1",
      units: [{ unit_no: 1 }],
      materials_used: [{ nama: "Freon", jumlah: 1, satuan: "kg" }],
      foto_urls: ["https://r2/photo-1.jpg"],
      status: "VERIFIED",
    });

    expect(result.units).toEqual([{ unit_no: 1 }]);
    expect(result.materials).toHaveLength(1);
    expect(result.foto_urls).toEqual(["https://r2/photo-1.jpg"]);
    expect(result._detailLoaded).toBe(true);
  });

  it("falls back to legacy JSON text and foto metadata", () => {
    const result = normalizeCustomerServiceReport({
      id: "REP-LEGACY",
      units_json: JSON.stringify([{ unit_no: 2 }]),
      materials_json: JSON.stringify([{ nama: "Kapasitor", jumlah: 1, satuan: "pcs" }]),
      fotos: [{ url: "https://r2/legacy.jpg", label: "Sesudah" }],
      catatan: "Unit normal",
    });

    expect(result.units[0].unit_no).toBe(2);
    expect(result.materials[0].nama).toBe("Kapasitor");
    expect(result.foto_urls).toEqual(["https://r2/legacy.jpg"]);
    expect(result.catatan_global).toBe("Unit normal");
    expect(result.status).toBe("SUBMITTED");
  });

  it("does not throw on damaged legacy JSON", () => {
    expect(normalizeCustomerServiceReport({ units_json: "{broken", materials_json: "null" }))
      .toEqual(expect.objectContaining({ units: [], materials: [], foto_urls: [] }));
    expect(normalizeCustomerServiceReport(null)).toBeNull();
  });
});
