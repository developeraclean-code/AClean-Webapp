import { describe, expect, it } from "vitest";
import { statisticsProfitBreakdown } from "../statisticsProfit.js";

describe("statisticsProfitBreakdown", () => {
  it("mengurangi expense, payroll, dan komisi dari seluruh revenue", () => {
    expect(statisticsProfitBreakdown({
      revenue: 10_000_000,
      expenses: 2_000_000,
      payroll: 3_000_000,
      bonuses: 500_000,
      material_purchases: 1_250_000,
    })).toEqual({
      revenue: 10_000_000,
      expenses: 2_000_000,
      operatingExpenses: 750_000,
      materialPurchases: 1_250_000,
      payroll: 3_000_000,
      bonuses: 500_000,
      totalCosts: 5_500_000,
      netProfit: 4_500_000,
      marginPct: 45,
    });
  });

  it("memakai angka otoritatif dari snapshot server", () => {
    const result = statisticsProfitBreakdown({
      revenue: 1_000_000,
      expenses: 100_000,
      payroll: 100_000,
      bonuses: 50_000,
      total_costs: 300_000,
      net_profit: 700_000,
    });
    expect(result.totalCosts).toBe(300_000);
    expect(result.netProfit).toBe(700_000);
    expect(result.marginPct).toBe(70);
  });

  it("aman terhadap nilai null atau bukan angka", () => {
    expect(statisticsProfitBreakdown({ revenue: null, expenses: "invalid" })).toMatchObject({
      revenue: 0,
      totalCosts: 0,
      netProfit: 0,
      marginPct: 0,
    });
  });
});
