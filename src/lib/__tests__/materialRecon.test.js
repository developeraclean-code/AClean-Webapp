import { describe, it, expect } from "vitest";
import {
  reconcileDay,
  sumReportedUsage,
  reconStatus,
  comparableQty,
  classifyMaterial,
  RECON_TOLERANCE,
} from "../materialRecon.js";

const pipa = (qty, code = "SKU022") => ({ material_type: "pipa", inventory_code: code, label: "Pipa AC", qty, satuan: "meter" });
const kabel = (qty) => ({ material_type: "kabel", inventory_code: "KBL01", label: "Kabel", qty, satuan: "meter" });
const freon = (kg, code = "FRN32") => ({ material_type: "freon", inventory_code: code, label: "Freon R32", weight_kg: kg, satuan: "kg" });
const tx = (name, qty, qty_actual = qty, code = "") => ({ type: "usage", inventory_name: name, inventory_code: code, qty: -Math.abs(qty), qty_actual: qty_actual == null ? null : -Math.abs(qty_actual) });

const lineFor = (lines, type) => lines.find(l => l.material_type === type);

describe("classifyMaterial", () => {
  it("mengenali freon/pipa/kabel/lain", () => {
    expect(classifyMaterial("Freon R32")).toBe("freon");
    expect(classifyMaterial("R-410")).toBe("freon");
    expect(classifyMaterial("Pipa AC Hoda 1PK")).toBe("pipa");
    expect(classifyMaterial("Kabel NYM")).toBe("kabel");
    expect(classifyMaterial("Bracket")).toBe("lain");
  });
});

describe("comparableQty", () => {
  it("pipa/kabel pakai qty", () => {
    expect(comparableQty(pipa(50))).toBe(50);
  });
  it("freon pakai weight_kg (number)", () => {
    expect(comparableQty(freon(5.0))).toBe(5.0);
  });
  it("freon weight_kg array dijumlah", () => {
    expect(comparableQty({ material_type: "freon", weight_kg: [{ kg: 3.0 }, { kg: 2.2 }] })).toBe(5.2);
  });
  it("freon fallback ke qty tabung bila tak ada berat", () => {
    expect(comparableQty({ material_type: "freon", qty: 2 })).toBe(2);
  });
});

describe("sumReportedUsage", () => {
  it("menjumlah pemakaian (abs) per code & type", () => {
    const r = sumReportedUsage([tx("Pipa AC", 18, 18, "SKU022"), tx("Kabel NYM", 12, 12, "KBL01")]);
    expect(r.byCode["SKU022"]).toBe(18);
    expect(r.byType.pipa).toBe(18);
    expect(r.byType.kabel).toBe(12);
    expect(r.freonUnknown).toBe(false);
  });
  it("freon qty_actual null → freonUnknown true & tidak dihitung", () => {
    const r = sumReportedUsage([tx("Freon R32", 1, null, "FRN32")]);
    expect(r.freonUnknown).toBe(true);
    expect(r.byType.freon).toBe(0);
  });
  it("freon qty_actual terisi → dihitung", () => {
    const r = sumReportedUsage([tx("Freon R32", 1, 0.6, "FRN32")]);
    expect(r.freonUnknown).toBe(false);
    expect(r.byType.freon).toBe(0.6);
  });
  it("abaikan baris non-usage", () => {
    const r = sumReportedUsage([{ type: "restock", inventory_name: "Pipa AC", qty: 100 }]);
    expect(r.byType.pipa).toBe(0);
  });
});

describe("reconcileDay", () => {
  it("OK ketika selisih dalam toleransi", () => {
    const lines = reconcileDay([pipa(50)], [pipa(31)], sumReportedUsage([tx("Pipa AC", 18, 18, "SKU022")]));
    const l = lineFor(lines, "pipa");
    expect(l.used_implied).toBe(19);      // 50 - 31
    expect(l.used_reported).toBe(18);
    expect(l.selisih).toBe(1);            // == tolerance 1.0 → OK
    expect(l.flag).toBe("OK");
  });

  it("OVER ketika fisik terpakai jauh > dilaporkan (indikasi tak dilaporkan)", () => {
    const lines = reconcileDay([pipa(50)], [pipa(20)], sumReportedUsage([tx("Pipa AC", 18, 18, "SKU022")]));
    const l = lineFor(lines, "pipa");
    expect(l.used_implied).toBe(30);
    expect(l.selisih).toBe(12);
    expect(l.flag).toBe("OVER");
  });

  it("UNDER ketika dilaporkan > fisik terpakai (over-report)", () => {
    const lines = reconcileDay([pipa(50)], [pipa(45)], sumReportedUsage([tx("Pipa AC", 18, 18, "SKU022")]));
    const l = lineFor(lines, "pipa");
    expect(l.used_implied).toBe(5);
    expect(l.selisih).toBe(-13);
    expect(l.flag).toBe("UNDER");
  });

  it("freon: selisih berat dibanding pemakaian dilaporkan (kg)", () => {
    const lines = reconcileDay([freon(5.0)], [freon(4.2)], sumReportedUsage([tx("Freon R32", 1, 0.6, "FRN32")]));
    const l = lineFor(lines, "freon");
    expect(l.used_implied).toBe(0.8);     // 5.0 - 4.2
    expect(l.used_reported).toBe(0.6);
    expect(l.flag).toBe("OK");            // selisih 0.2 <= tol 0.3
  });

  it("freon belum ditimbang (qty_actual null) → MISSING_DATA, bukan false positive", () => {
    const lines = reconcileDay([freon(5.0)], [freon(4.0)], sumReportedUsage([tx("Freon R32", 1, null, "FRN32")]));
    const l = lineFor(lines, "freon");
    expect(l.flag).toBe("MISSING_DATA");
    expect(l.used_reported).toBeNull();
  });

  it("tidak ada pemakaian dilaporkan & ada selisih fisik → OVER", () => {
    const lines = reconcileDay([kabel(30)], [kabel(10)], sumReportedUsage([]));
    const l = lineFor(lines, "kabel");
    expect(l.used_implied).toBe(20);
    expect(l.used_reported).toBe(0);
    expect(l.flag).toBe("OVER");
  });

  it("input kosong → tidak ada baris", () => {
    expect(reconcileDay([], [], sumReportedUsage([]))).toEqual([]);
  });

  it("toleransi bisa di-override", () => {
    const lines = reconcileDay([pipa(50)], [pipa(20)], sumReportedUsage([tx("Pipa AC", 18, 18, "SKU022")]), { pipa: 99 });
    expect(lineFor(lines, "pipa").flag).toBe("OK"); // selisih 12 <= tol 99
  });
});

describe("reconStatus", () => {
  it("FLAGGED bila ada OVER/UNDER", () => {
    expect(reconStatus([{ flag: "OK" }, { flag: "OVER" }])).toBe("FLAGGED");
  });
  it("WARNING bila hanya MISSING_DATA", () => {
    expect(reconStatus([{ flag: "OK" }, { flag: "MISSING_DATA" }])).toBe("WARNING");
  });
  it("OK bila semua OK", () => {
    expect(reconStatus([{ flag: "OK" }])).toBe("OK");
  });
});
