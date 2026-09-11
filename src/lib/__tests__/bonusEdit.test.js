import { describe, expect, it } from "vitest";
import { bonusEditChanges, buildBonusEditPayload } from "../bonusEdit.js";

describe("buildBonusEditPayload", () => {
  it("menormalkan total dan anggota tim tanpa mengubah status pembayaran", () => {
    expect(buildBonusEditPayload({
      bonus_type: "manual",
      total_amount: "50000",
      team_members: ["Dedi", " dedi ", "Fikri"],
      note: "  pemasangan 2 AC  ",
      gross_revenue: "1000000",
      material_cost: "200000",
    })).toEqual({
      bonus_type: "manual",
      total_amount: 50000,
      team_members: ["Dedi", "Fikri"],
      note: "pemasangan 2 AC",
      gross_revenue: null,
      material_cost: null,
      material_cost_source: null,
    });
  });

  it("mempertahankan data perhitungan untuk bonus margin", () => {
    expect(buildBonusEditPayload({
      bonus_type: "margin_2jt",
      total_amount: 100000,
      team_members: ["Mulyadi", "Bojim"],
      gross_revenue: "3119000",
      material_cost: "1039000",
      material_cost_source: "auto_edited",
    })).toMatchObject({
      gross_revenue: 3119000,
      material_cost: 1039000,
      material_cost_source: "auto_edited",
    });
  });

  it("menolak nominal nol dan tim kosong", () => {
    expect(() => buildBonusEditPayload({ bonus_type: "manual", total_amount: 0, team_members: ["Dedi"] })).toThrow("lebih dari Rp 0");
    expect(() => buildBonusEditPayload({ bonus_type: "manual", total_amount: 50000, team_members: [] })).toThrow("minimal satu");
  });
});

describe("bonusEditChanges", () => {
  it("mencatat perubahan penting untuk audit", () => {
    const changes = bonusEditChanges(
      { bonus_type: "manual", total_amount: 50000, team_members: ["Dedi"], note: null },
      { bonus_type: "kapasitor", total_amount: 40000, team_members: ["Dedi", "Fikri"], note: "revisi" },
    );
    expect(changes).toEqual(expect.arrayContaining([
      "jenis manual → kapasitor",
      "total 50000 → 40000",
      "tim Dedi → Dedi, Fikri",
      "catatan diubah",
    ]));
  });
});
