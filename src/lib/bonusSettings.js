import { DEFAULT_BONUS_CATEGORIES } from '../constants/bonus.js';

const defaultById = new Map(DEFAULT_BONUS_CATEGORIES.map(category => [category.id, category]));
export const isMarginBonus = category => String(category?.id || '').startsWith('margin');

export function marginBonusLabel(threshold) {
  const value = Number(threshold);
  const text = value >= 1000000
    ? `${(value / 1000000).toLocaleString('id-ID', { maximumFractionDigits: 6 })}jt`
    : `Rp${value.toLocaleString('id-ID')}`;
  return `Margin >${text}`;
}

export function normalizeBonusCategories(categories = []) {
  return categories.map(category => {
    if (!isMarginBonus(category)) return { ...category };
    // JSON setting lama belum punya threshold; isi batas baru tanpa mengubah ID/nominal.
    const threshold = category.threshold == null
      ? defaultById.get(category.id)?.threshold
      : Number(category.threshold);
    return {
      ...category,
      threshold,
      label: Number.isFinite(threshold) && threshold > 0 ? marginBonusLabel(threshold) : category.label,
    };
  });
}

export function marginBonusTiers(categories = DEFAULT_BONUS_CATEGORIES) {
  return normalizeBonusCategories(categories)
    .filter(category => isMarginBonus(category) && Number.isSafeInteger(category.threshold) &&
      category.threshold > 0 && Number.isFinite(Number(category.amount)) && Number(category.amount) > 0)
    .sort((a, b) => a.threshold - b.threshold);
}

export function marginBonusForProfit(profit, categories = DEFAULT_BONUS_CATEGORIES) {
  if (profit == null || profit === '' || !Number.isFinite(Number(profit))) return null;
  return marginBonusTiers(categories).reverse().find(category => Number(profit) > category.threshold) || null;
}

const keywords = value => (Array.isArray(value) ? value : String(value || '').split(','))
  .map(keyword => String(keyword || '').trim().toLowerCase()).filter(Boolean);
const slugify = label => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `bonus_${Date.now()}`;

export function buildBonusSettingsPayload(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Minimal 1 kategori bonus');
  const seenIds = new Set();
  let previousMarginThreshold = 0;
  return rows.map(row => {
    const label = String(row.label || '').trim();
    if (!label) throw new Error('Ada kategori tanpa label — isi atau hapus dulu');
    const id = String(row.id || '').trim() || slugify(label);
    if (seenIds.has(id)) throw new Error(`ID duplikat: ${id} — pakai label/ID unik`);
    seenIds.add(id);
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Nominal ${label} harus berupa angka ≥ Rp 0`);
    const result = {
      id, label, amount,
      detection_keywords: keywords(row.detection_keywords),
      exclude_keywords: keywords(row.exclude_keywords),
    };
    if (isMarginBonus({ id })) {
      const threshold = Number(row.threshold);
      if (!Number.isSafeInteger(threshold) || threshold <= 0) throw new Error(`Isi batas margin ${label} dengan rupiah bulat lebih dari 0`);
      if (threshold <= previousMarginThreshold) throw new Error('Batas margin harus meningkat dari tingkat pertama ke berikutnya');
      previousMarginThreshold = threshold;
      result.threshold = threshold;
      result.label = marginBonusLabel(threshold);
    }
    return result;
  });
}
