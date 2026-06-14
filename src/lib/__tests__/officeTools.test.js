import { describe, it, expect } from "vitest";
import { toolStatus, summarizeTools, canCheckout, outMovementsForRef, outCountForRef, anyOut, isOut } from "../officeTools.js";

const tool = (id, qty) => ({ id, nama: id, qty });
const mv = (id, toolId, qty, status = "OUT", scope = "order", refId = "O1") =>
  ({ id, tool_id: toolId, qty, status, scope, ref_id: refId, carried_by: "Budi", ref_label: "Cust A" });

describe("isOut", () => {
  it("default OUT", () => { expect(isOut({})).toBe(true); });
  it("RETURNED bukan out", () => { expect(isOut({ status: "RETURNED" })).toBe(false); });
});

describe("toolStatus", () => {
  it("tersedia = total - keluar", () => {
    const s = toolStatus(tool("t1", 3), [mv("m1", "t1", 1), mv("m2", "t1", 1, "RETURNED")]);
    expect(s.total).toBe(3); expect(s.out).toBe(1); expect(s.available).toBe(2);
    expect(s.holders).toHaveLength(1); expect(s.holders[0].carriedBy).toBe("Budi");
  });
  it("tidak minus saat keluar > total (data anomali)", () => {
    const s = toolStatus(tool("t1", 1), [mv("m1", "t1", 2)]);
    expect(s.available).toBe(0);
  });
  it("abaikan movement alat lain", () => {
    const s = toolStatus(tool("t1", 2), [mv("m1", "t2", 1)]);
    expect(s.out).toBe(0); expect(s.available).toBe(2);
  });
});

describe("canCheckout", () => {
  it("boleh jika <= tersedia", () => { expect(canCheckout(tool("t1", 2), [], 2)).toBe(true); });
  it("tolak jika > tersedia", () => { expect(canCheckout(tool("t1", 2), [mv("m1", "t1", 1)], 2)).toBe(false); });
  it("tolak qty 0 / negatif", () => { expect(canCheckout(tool("t1", 2), [], 0)).toBe(false); expect(canCheckout(tool("t1", 2), [], -1)).toBe(false); });
});

describe("outMovementsForRef / outCountForRef", () => {
  const moves = [
    mv("m1", "t1", 1, "OUT", "order", "O1"),
    mv("m2", "t2", 2, "OUT", "order", "O1"),
    mv("m3", "t1", 1, "RETURNED", "order", "O1"),
    mv("m4", "t1", 1, "OUT", "project", "P9"),
  ];
  it("filter per scope+ref, hanya OUT", () => {
    const r = outMovementsForRef(moves, "order", "O1");
    expect(r.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
  it("hitung unit dibawa utk job", () => {
    expect(outCountForRef(moves, "order", "O1")).toBe(3);
    expect(outCountForRef(moves, "project", "P9")).toBe(1);
  });
});

describe("summarizeTools / anyOut", () => {
  it("map per tool id", () => {
    const m = summarizeTools([tool("t1", 2), tool("t2", 1)], [mv("m1", "t1", 1)]);
    expect(m.t1.out).toBe(1); expect(m.t2.out).toBe(0);
  });
  it("anyOut true bila ada keluar", () => {
    expect(anyOut([tool("t1", 2)], [mv("m1", "t1", 1)])).toBe(true);
    expect(anyOut([tool("t1", 2)], [])).toBe(false);
  });
});
