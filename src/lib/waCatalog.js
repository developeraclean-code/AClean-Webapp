export const catalogPrice = (item, priceList = [], acPrices = []) => {
  if (!item) return null;
  if (item.price_source === "fixed") return item.fixed_price == null ? null : Number(item.fixed_price);
  if (item.price_source === "price_list") {
    const row = priceList.find(value => String(value.id) === String(item.source_id) && value.is_active !== false);
    return row && row.price != null ? Number(row.price) : null;
  }
  if (item.price_source === "ac_unit" || item.price_source === "ac_installed") {
    const row = acPrices.find(value => String(value.id) === String(item.source_id) && value.is_active !== false);
    const raw = row && (item.price_source === "ac_unit" ? row.harga_unit : row.harga_inc_pasang);
    return raw == null ? null : Number(raw);
  }
  return item.price_source === "none" ? undefined : null;
};

export const catalogCaption = (item, price, intro = "") => {
  const lines = [String(intro || "").trim(), item.title.trim(), String(item.description || "").trim()];
  if (price !== undefined && price !== null) lines.push(`Harga: Rp ${Number(price).toLocaleString("id-ID")}`);
  return lines.filter(Boolean).join("\n\n");
};
