import { describe, expect, it } from "vitest";
import { buildFieldOrderSnapshot, findFieldOrderConflicts, hasFieldOrderConflict } from "../fieldConflict.js";

describe("field order conflict", () => {
  it("ignores status/audit changes but catches operational edits", () => {
    const snapshot = buildFieldOrderSnapshot({ id: "J1", customer: "A", units: 2, teknisi: "Dedi", status: "CONFIRMED" });
    expect(hasFieldOrderConflict(snapshot, { ...snapshot, status: "DISPATCHED", updated_at: "later" })).toBe(false);
    expect(findFieldOrderConflicts(snapshot, { ...snapshot, units: 3 })).toEqual(["units"]);
    expect(findFieldOrderConflicts(snapshot, { ...snapshot, teknisi: "Putra" })).toEqual(["teknisi"]);
  });
});
