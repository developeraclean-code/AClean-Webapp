import { describe, it, expect } from "vitest";
import { computeUsed, buildMovementRows, reconcileMovement, movementStatus } from "../materialMovement.js";

const bawa = (cat, code, qty, label = "") => ({ category: cat, inventory_code: code, type_label: label, qty });

describe("computeUsed", () => {
  it("bawa - pulang", () => { expect(computeUsed(50, 30)).toBe(20); });
  it("pulang belum diisi → null", () => { expect(computeUsed(50, null)).toBeNull(); expect(computeUsed(50, "")).toBeNull(); });
  it("pulang 0 → semua terpakai", () => { expect(computeUsed(50, 0)).toBe(50); });
});

describe("buildMovementRows", () => {
  it("gabung bawa & pulang per category+code, hitung used", () => {
    const rows = buildMovementRows(
      [bawa("pipa", "SKU022", 50, "1PK"), bawa("kabel", "SKU026", 40, "3x2,5")],
      [bawa("pipa", "SKU022", 30), bawa("kabel", "SKU026", 25)]
    );
    const pipa = rows.find(r => r.inventory_code === "SKU022");
    expect(pipa.qty_bawa).toBe(50);
    expect(pipa.qty_pulang).toBe(30);
    expect(pipa.qty_used).toBe(20);
  });
  it("hanya bawa (pulang belum) → used null", () => {
    const rows = buildMovementRows([bawa("pipa", "SKU022", 50, "1PK")], []);
    expect(rows[0].qty_used).toBeNull();
  });
});

describe("reconcileMovement", () => {
  it("OK dalam toleransi", () => {
    const rows = buildMovementRows([bawa("pipa", "SKU022", 50)], [bawa("pipa", "SKU022", 31)]);
    const [l] = reconcileMovement(rows, { SKU022: 18 });
    expect(l.used).toBe(19); expect(l.reported).toBe(18); expect(l.selisih).toBe(1); expect(l.flag).toBe("OK");
  });
  it("OVER (pakai fisik > dilaporkan)", () => {
    const rows = buildMovementRows([bawa("pipa", "SKU022", 50)], [bawa("pipa", "SKU022", 20)]);
    const [l] = reconcileMovement(rows, { SKU022: 18 });
    expect(l.used).toBe(30); expect(l.selisih).toBe(12); expect(l.flag).toBe("OVER");
  });
  it("UNDER (dilaporkan > fisik)", () => {
    const rows = buildMovementRows([bawa("pipa", "SKU022", 50)], [bawa("pipa", "SKU022", 45)]);
    const [l] = reconcileMovement(rows, { SKU022: 18 });
    expect(l.flag).toBe("UNDER");
  });
  it("PENDING_PULANG bila pulang belum diisi", () => {
    const rows = buildMovementRows([bawa("pipa", "SKU022", 50)], []);
    const [l] = reconcileMovement(rows, { SKU022: 0 });
    expect(l.flag).toBe("PENDING_PULANG"); expect(l.selisih).toBeNull();
  });
  it("tanpa laporan → reported 0, selisih = used", () => {
    const rows = buildMovementRows([bawa("kabel", "SKU026", 30)], [bawa("kabel", "SKU026", 10)]);
    const [l] = reconcileMovement(rows, {});
    expect(l.reported).toBe(0); expect(l.used).toBe(20); expect(l.flag).toBe("OVER");
  });
});

describe("movementStatus", () => {
  it("FLAGGED bila ada OVER/UNDER", () => { expect(movementStatus([{ flag: "OK" }, { flag: "OVER" }])).toBe("FLAGGED"); });
  it("PENDING bila ada PENDING_PULANG (tanpa flag)", () => { expect(movementStatus([{ flag: "OK" }, { flag: "PENDING_PULANG" }])).toBe("PENDING"); });
  it("OK bila semua OK", () => { expect(movementStatus([{ flag: "OK" }])).toBe("OK"); });
});
