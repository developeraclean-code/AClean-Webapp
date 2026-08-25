import { describe, it, expect } from "vitest";
import { buildReversalRow, reversalByUnit } from "../materialDeduct.js";

const tx = {
  inventory_code: "SKU022", inventory_name: "Pipa 1/4", order_id: "JOB-A",
  unit_id: "u1", unit_label: "Roll A", qty: -20, qty_actual: -20,
  teknisi_name: "Hamdan", customer_name: "IBU CASSY", job_date: "2026-08-25",
};

describe("buildReversalRow", () => {
  it("membalik tanda qty jadi positif (stok kembali)", () => {
    const r = buildReversalRow(tx, { oleh: "Dedy", alasan: "salah ukur" });
    expect(r.qty).toBe(20);
    expect(r.qty_actual).toBe(20);
    expect(r.type).toBe("adjustment");
  });
  it("mempertahankan job, unit, dan teknisi asalnya", () => {
    const r = buildReversalRow(tx, { oleh: "Dedy" });
    expect(r).toMatchObject({ order_id: "JOB-A", unit_id: "u1", teknisi_name: "Hamdan", customer_name: "IBU CASSY" });
  });
  it("mencatat siapa & alasannya di notes", () => {
    const r = buildReversalRow(tx, { oleh: "Dedy", alasan: "salah ukur" });
    expect(r.notes).toContain("Dedy");
    expect(r.notes).toContain("salah ukur");
  });
  it("qty nol atau input kosong tidak menghasilkan baris", () => {
    expect(buildReversalRow({ ...tx, qty: 0 })).toBe(null);
    expect(buildReversalRow(null)).toBe(null);
  });
  it("qty_actual kosong jatuh ke qty", () => {
    expect(buildReversalRow({ ...tx, qty_actual: null }).qty_actual).toBe(20);
  });
});

describe("reversalByUnit", () => {
  it("menjumlahkan per unit fisik", () => {
    expect(reversalByUnit([
      { unit_id: "u1", qty: -20 },
      { unit_id: "u1", qty: -10 },
      { unit_id: "u2", qty: -1.5 },
    ])).toEqual({ u1: 30, u2: 1.5 });
  });
  it("baris tanpa unit diabaikan (material non-tracked)", () => {
    expect(reversalByUnit([{ unit_id: null, qty: -5 }])).toEqual({});
  });
  it("aman untuk input kosong", () => {
    expect(reversalByUnit(null)).toEqual({});
  });
});
