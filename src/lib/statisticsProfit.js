const money = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/**
 * Satu rumus untuk kartu Statistik dan seluruh export.
 *
 * `expenses` sudah mencakup pembelian material yang benar-benar dicatat pada
 * menu Biaya. Payroll dan komisi berada di tabel terpisah, jadi keduanya wajib
 * ditambahkan agar angka yang disebut "net profit" tidak terlalu tinggi.
 */
export function statisticsProfitBreakdown(financial = {}) {
  const revenue = money(financial.revenue);
  const expenses = money(financial.expenses);
  const payroll = money(financial.payroll);
  const bonuses = money(financial.bonuses);
  const materialPurchases = money(financial.material_purchases);
  const operatingExpenses = financial.operating_expenses == null
    ? Math.max(0, expenses - materialPurchases)
    : money(financial.operating_expenses);

  // Gunakan agregat server bila tersedia, tetapi hitung ulang sebagai fallback
  // agar deployment UI tetap kompatibel sesaat sebelum migrasi DB diterapkan.
  const calculatedCosts = expenses + payroll + bonuses;
  const totalCosts = financial.total_costs == null
    ? calculatedCosts
    : money(financial.total_costs);
  const netProfit = financial.net_profit == null
    ? revenue - totalCosts
    : money(financial.net_profit);
  const marginPct = revenue > 0 ? Math.round((netProfit / revenue) * 10000) / 100 : 0;

  return {
    revenue,
    expenses,
    operatingExpenses,
    materialPurchases,
    payroll,
    bonuses,
    totalCosts,
    netProfit,
    marginPct,
  };
}
