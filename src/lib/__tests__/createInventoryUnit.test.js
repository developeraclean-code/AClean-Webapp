import { describe, expect, it, vi } from "vitest";
import { createInventoryUnit } from "../createInventoryUnit.js";

const unit = {
  inventory_code: "SKU023", unit_label: "Roll 2PK - B2", capacity: 30,
  stock: 30, purchase_date: "2026-09-17", notes: "Pembelian di anugerah",
};

describe("createInventoryUnit", () => {
  it("mengirim ID operasi tetap bersama satu unit fisik", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const result = await createInventoryUnit({ from: () => ({ insert }) }, unit, "unit-123");
    expect(insert).toHaveBeenCalledWith({ ...unit, id: "unit-123" });
    expect(result.id).toBe("unit-123");
  });

  it("retry setelah commit ambigu dianggap sukses hanya untuk ID dan isi yang sama", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { ...unit, id: "unit-123" }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = { from: () => ({ insert, select }) };
    expect((await createInventoryUnit(supabase, unit, "unit-123")).id).toBe("unit-123");
    expect(eq).toHaveBeenCalledWith("id", "unit-123");
  });

  it("tidak menyamakan dua roll berbeda hanya karena label dan nota sama", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: () => ({ insert }) };
    await createInventoryUnit(supabase, unit, "unit-123");
    await createInventoryUnit(supabase, unit, "unit-456");
    expect(insert.mock.calls.map(([payload]) => payload.id)).toEqual(["unit-123", "unit-456"]);
  });

  it("konflik pada ID lain atau isi berbeda tetap menjadi error", async () => {
    const error = { code: "23505", message: "duplicate key" };
    const maybeSingle = vi.fn().mockResolvedValue({ data: { ...unit, stock: 10 }, error: null });
    const supabase = { from: () => ({
      insert: async () => ({ error }),
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }) };
    await expect(createInventoryUnit(supabase, unit, "unit-123")).rejects.toBe(error);
  });
});
