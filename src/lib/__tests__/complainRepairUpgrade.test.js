import { describe, expect, it } from "vitest";
import { COMPLAIN_REPAIR_MARKER, isComplainWarrantyFlow, preserveComplainRepairNotes, upgradeComplainToRepair } from "../complainRepairUpgrade.js";

function database(initial = {}) {
  const rows = {
    orders: [{ id: "WA-1", service: "Complain", status: "DISPATCHED", notes: "Cek bocor", updated_at: "2026-10-15T01:00:00Z" }],
    service_reports: [], invoices: [], ...initial,
  };
  const calls = { insert: 0, update: 0 };
  const from = table => {
    const filters = [];
    let action = "select";
    let patch;
    const match = row => filters.every(([kind, key, value]) =>
      kind === "eq" ? row[key] === value : kind === "neq" ? row[key] !== value : value.includes(row[key]));
    const execute = single => {
      if (action === "insert") { calls.insert++; throw new Error("Upgrade tidak boleh membuat job baru"); }
      if (action === "update") {
        calls.update++;
        const found = rows[table].find(match);
        if (!found) return { data: single ? null : [], error: null };
        Object.assign(found, patch, { updated_at: "2026-10-15T01:01:00Z" });
        return { data: single ? { ...found } : [{ ...found }], error: null };
      }
      const found = rows[table].filter(match).map(row => ({ ...row }));
      return { data: single ? (found[0] || null) : found, error: null };
    };
    const query = {
      select: () => query,
      update: value => { action = "update"; patch = value; return query; },
      insert: () => { action = "insert"; return query; },
      eq: (key, value) => { filters.push(["eq", key, value]); return query; },
      neq: (key, value) => { filters.push(["neq", key, value]); return query; },
      in: (key, value) => { filters.push(["in", key, value]); return query; },
      limit: () => query,
      maybeSingle: async () => execute(true),
      then: (resolve, reject) => Promise.resolve(execute(false)).then(resolve, reject),
    };
    return query;
  };
  return { rows, calls, supabase: { from } };
}

describe("upgrade Complain → Repair pada job yang sama", () => {
  it("dua klik bersamaan menghasilkan satu ID dan satu perubahan saja", async () => {
    const db = database();
    const [first, second] = await Promise.all([
      upgradeComplainToRepair(db.supabase, db.rows.orders[0], "Aris"),
      upgradeComplainToRepair(db.supabase, db.rows.orders[0], "Aris"),
    ]);
    expect([first.status, second.status].sort()).toEqual(["already-upgraded", "upgraded"]);
    expect(db.rows.orders).toHaveLength(1);
    expect(db.rows.orders[0]).toMatchObject({ id: "WA-1", service: "Repair", last_changed_by: "Aris" });
    expect(db.rows.orders[0].notes).toContain("Cek bocor");
    expect(db.rows.orders[0].notes).toContain(COMPLAIN_REPAIR_MARKER);
    expect(db.calls.insert).toBe(0);
    expect(isComplainWarrantyFlow(db.rows.orders[0])).toBe(true);
  });

  it("menahan order lama yang sudah punya child Repair", async () => {
    const db = database({ orders: [
      { id: "WA-1", service: "Complain", status: "DISPATCHED", updated_at: "2026-10-15T01:00:00Z" },
      { id: "JOB-CHILD", parent_job_id: "WA-1", service: "Repair", status: "CONFIRMED" },
    ] });
    const result = await upgradeComplainToRepair(db.supabase, db.rows.orders[0], "Aris");
    expect(result.status).toBe("blocked");
    expect(db.rows.orders[0].service).toBe("Complain");
    expect(db.calls.update).toBe(0);
  });

  it("menahan perubahan layanan setelah laporan atau invoice ada", async () => {
    const db = database({ service_reports: [{ id: "LPR-1", job_id: "WA-1" }] });
    const result = await upgradeComplainToRepair(db.supabase, db.rows.orders[0], "Aris");
    expect(result.status).toBe("blocked");
    expect(db.calls.update).toBe(0);
  });

  it("catatan yang diedit admin tetap menyimpan penanda asal Complain", () => {
    const order = { service: "Repair", notes: COMPLAIN_REPAIR_MARKER };
    expect(preserveComplainRepairNotes(order, "Customer minta dicek ulang"))
      .toBe(`Customer minta dicek ulang\n${COMPLAIN_REPAIR_MARKER}`);
  });
});
