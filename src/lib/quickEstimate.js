export const QUICK_ESTIMATE_PRICES = Object.freeze({
  installLabor: 400_000,
  installLaborLarge: 450_000,
  removeSmall: 150_000,
  removeLarge: 200_000,
  reinstall: 400_000,
  vacuum: 50_000,
  bracket: 150_000,
  ductTape: 20_000,
  cable15: 35_000,
  cable25: 45_000,
  pipe1: 150_000,
  pipe2: 170_000,
  pipe25: 240_000,
  pipe3: 280_000,
  pipeService: 200_000,
  flexibleDrain: 25_000,
  armaflex: 150_000,
  pipeInsulation: 50_000,
  freonSmall: 500_000,
  freonLarge: 1_000_000,
  vacuumFreonSmall: 650_000,
  vacuumFreonLarge: 1_150_000,
});

export const QUICK_ESTIMATE_TERMS = Object.freeze([
  "Ini estimasi awal, bukan penawaran final. Harga pasti ditentukan setelah teknisi survei kondisi lokasi, termasuk jarak pipa, jalur kabel, dan tinggi bangunan.",
  "Harga estimasi hanya jasa dan material instalasi; unit AC tidak termasuk.",
  "Panjang pipa dan kabel mengikuti kebutuhan aktual di lokasi. Default pipa 4 meter per unit dan kabel otomatis 1 meter lebih panjang; keduanya dapat diubah atau ditiadakan bila instalasi existing dipakai kembali.",
  "Penagihan material disesuaikan dengan pemakaian aktual. Pekerjaan tidak mencakup perapian tembok atau plafon dan pengecatan bekas pekerjaan.",
  "Garansi pekerjaan instalasi: 30 hari. Jasa vacuum wajib pada pemasangan/bongkar-pasang untuk mengeluarkan udara dan uap air dari jalur pipa.",
]);

export const PIPE_REPLACEMENT_ITEMS = Object.freeze([
  { id: "pipe1", label: "Pipa Hoda 1 PK", unit: "m", price: QUICK_ESTIMATE_PRICES.pipe1 },
  { id: "pipe2", label: "Pipa Hoda 2 PK", unit: "m", price: QUICK_ESTIMATE_PRICES.pipe2 },
  { id: "pipe25", label: "Pipa Hoda 2,5 PK", unit: "m", price: QUICK_ESTIMATE_PRICES.pipe25 },
  { id: "pipe3", label: "Pipa Hoda 3 PK", unit: "m", price: QUICK_ESTIMATE_PRICES.pipe3 },
  { id: "cable15", label: "Kabel 3×1,5", unit: "m", price: QUICK_ESTIMATE_PRICES.cable15 },
  { id: "cable25", label: "Kabel 3×2,5", unit: "m", price: QUICK_ESTIMATE_PRICES.cable25 },
  { id: "ductGlue", label: "Duct Tape Lem", unit: "pcs", price: QUICK_ESTIMATE_PRICES.ductTape },
  { id: "ductNoGlue", label: "Duct Tape Non Lem", unit: "pcs", price: QUICK_ESTIMATE_PRICES.ductTape },
  { id: "flexDrain", label: "Selang Flexibel Drain", unit: "m", price: QUICK_ESTIMATE_PRICES.flexibleDrain },
  { id: "bracket", label: "Breket Outdoor + Dinabolt", unit: "set", price: QUICK_ESTIMATE_PRICES.bracket },
  { id: "armaflex", label: "Armaflex (Armaplex)", unit: "pcs", price: QUICK_ESTIMATE_PRICES.armaflex },
  { id: "pipeInsulation", label: "Insulasi Paralon", unit: "m", price: QUICK_ESTIMATE_PRICES.pipeInsulation },
]);

const amount = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value) || 0) : 0;
const unitCount = value => Math.max(1, Math.trunc(amount(value)) || 1);

// Public calculator + get_website_pricing snapshot verified 2026-11-28.
export function installTier(pk) {
  const large = Number(pk) >= 1.5;
  return {
    labor: large ? QUICK_ESTIMATE_PRICES.installLaborLarge : QUICK_ESTIMATE_PRICES.installLabor,
    removal: large ? QUICK_ESTIMATE_PRICES.removeLarge : QUICK_ESTIMATE_PRICES.removeSmall,
    pipe: Number(pk) === 2.5 ? QUICK_ESTIMATE_PRICES.pipe25 : large ? QUICK_ESTIMATE_PRICES.pipe2 : QUICK_ESTIMATE_PRICES.pipe1,
    cable: large ? QUICK_ESTIMATE_PRICES.cable25 : QUICK_ESTIMATE_PRICES.cable15,
    freon: Number(pk) === 2.5 ? QUICK_ESTIMATE_PRICES.freonLarge : QUICK_ESTIMATE_PRICES.freonSmall,
    flush: Number(pk) === 2.5 ? QUICK_ESTIMATE_PRICES.vacuumFreonLarge : QUICK_ESTIMATE_PRICES.vacuumFreonSmall,
  };
}

export function calculateInstallEstimate({ groups, workType }) {
  const rows = [];
  const add = (label, qty, unit, price) => {
    const quantity = amount(qty);
    if (quantity > 0) rows.push({ label, qty: quantity, unit, unitPrice: price, total: quantity * price });
  };

  (groups || []).forEach((group) => {
    const qty = unitCount(group.qty);
    const pkLabel = `${group.pk} PK`;
    const tier = installTier(group.pk);
    if (workType === "new") add(`Jasa Pasang AC Baru · ${pkLabel}`, qty, "unit", tier.labor);
    else {
      add(`Jasa Bongkar Unit AC · ${pkLabel}`, qty, "unit", tier.removal);
      add(`Jasa Pasang Kembali (Indoor + Outdoor) · ${pkLabel}`, qty, "unit", QUICK_ESTIMATE_PRICES.reinstall);
    }
    const pipeMeters = amount(group.pipeMeters);
    const cableMeters = amount(group.cableMeters);
    const pipeRate = tier.pipe;
    if (group.usePipe && pipeMeters > 0) add(`Pipa AC · ${pkLabel}`, pipeMeters * qty, "m", pipeRate);
    if (group.useCable && cableMeters > 0) add(`Kabel Listrik · ${pkLabel}`, cableMeters * qty, "m", tier.cable);
    if (group.vacuum) add(`Jasa Vacum · ${pkLabel}`, qty, "unit", QUICK_ESTIMATE_PRICES.vacuum);
    if (group.bracket) add(`Breket Outdoor + Dinabolt · ${pkLabel}`, qty, "set", QUICK_ESTIMATE_PRICES.bracket);
    if (group.ductTape) add(`Duct Tape · ${pkLabel}`, qty, "pcs", QUICK_ESTIMATE_PRICES.ductTape);
    if ((group.freon === "topup" || group.freonTopup)) add(`Penambahan Freon · ${pkLabel}`, qty, "unit", tier.freon);
    if ((group.freon === "flush" || group.freonFlush)) add(`Kuras Vacum Freon · ${pkLabel}`, qty, "unit", tier.flush);
  });
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return { rows, total, units: (groups || []).reduce((sum, group) => sum + unitCount(group.qty), 0) };
}

export function manualEstimateItemError(item) {
  if (!String(item.label || "").trim()) return "Isi nama item.";
  if (String(item.qty ?? "").trim() === "" || !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0) return "Jumlah harus lebih dari 0.";
  if (!String(item.unit || "").trim()) return "Isi satuan item.";
  if (String(item.unitPrice ?? "").trim() === "" || !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0) return "Isi harga satuan 0 atau lebih.";
  if (!Number.isFinite(Number(item.qty) * Number(item.unitPrice))) return "Subtotal terlalu besar.";
  return "";
}

export function calculateManualEstimate(items = []) {
  const rows = items.filter(item => !manualEstimateItemError(item)).map(item => {
    const qty = Number(item.qty);
    const unitPrice = Number(item.unitPrice);
    return { label: item.label.trim(), qty, unit: item.unit.trim(), unitPrice, total: qty * unitPrice };
  });
  return { rows, total: rows.reduce((sum, row) => sum + row.total, 0) };
}

export function calculatePipeReplacementEstimate({ units, selected = {}, manualItems = [] }) {
  const rows = [{ label: "Jasa Instalasi Pipa AC", qty: unitCount(units), unit: "unit", unitPrice: QUICK_ESTIMATE_PRICES.pipeService, total: unitCount(units) * QUICK_ESTIMATE_PRICES.pipeService }];
  PIPE_REPLACEMENT_ITEMS.forEach(item => {
    const qty = amount(selected[item.id]?.qty);
    if (selected[item.id]?.enabled && qty > 0) rows.push({ label: item.label, qty, unit: item.unit, unitPrice: item.price, total: qty * item.price });
  });
  rows.push(...calculateManualEstimate(manualItems).rows);
  const freon = Array.isArray(selected.freon) ? selected.freon : [selected.freon];
  const freonOptions = {
    smallTopup: { label: "Penambahan Freon · AC 0,5–1,5 PK", price: QUICK_ESTIMATE_PRICES.freonSmall },
    smallFlush: { label: "Kuras Vacum Freon · AC 0,5–1,5 PK", price: QUICK_ESTIMATE_PRICES.vacuumFreonSmall },
    largeTopup: { label: "Penambahan Freon · AC 2–2,5 PK", price: QUICK_ESTIMATE_PRICES.freonLarge },
    largeFlush: { label: "Kuras Vacum Freon · AC 2–2,5 PK", price: QUICK_ESTIMATE_PRICES.vacuumFreonLarge },
  };
  for (const key of new Set(freon)) if (freonOptions[key]) rows.push({ label: freonOptions[key].label, qty: 1, unit: "unit", unitPrice: freonOptions[key].price, total: freonOptions[key].price });
  return { rows, total: rows.reduce((sum, row) => sum + row.total, 0), units: unitCount(units) };
}
