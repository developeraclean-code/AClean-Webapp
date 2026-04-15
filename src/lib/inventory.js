// Freon items: decimal stock (0.5kg granular), non-freon integer.
export const isFreonItem = (item) => {
  if (!item) return false;
  const n = String(item.name || "").toLowerCase();
  const u = String(item.unit || "").toLowerCase();
  return n.includes("freon") || n.includes("r-22") || n.includes("r-32") || n.includes("r-410")
    || n.includes("r22") || n.includes("r32") || n.includes("r410") || u === "kg";
};

export const displayStock = (item) => {
  const s = Number(item?.stock ?? 0);
  return isFreonItem(item) ? s.toFixed(1) : String(Math.floor(s));
};

// 0 → OUT, ≤1 → CRITICAL, ≤reorder → WARNING, else OK
export const computeStockStatus = (stock, reorder = 5) => {
  const s = Number(stock) || 0;
  if (s === 0) return "OUT";
  if (s <= 1) return "CRITICAL";
  if (s <= (Number(reorder) || 5)) return "WARNING";
  return "OK";
};
