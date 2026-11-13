import { normalizePhone } from './phone.js';
import { BILLING_CATEGORY, lineCategory, normalizeLines, summarize, computePph23, PPH23_RATE, PPH23_RATE_ALT } from './invoicing.js';

export const VOUCHER_POLICY_VERSION = '241-best-jasa';
export const voucherTodayWib = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const amount = (value, field) => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 1e12 || !Number.isInteger(n)) throw new Error(`${field} tidak valid`);
  return n;
};

// Shared preview/server normalization. The server always repeats this; client totals are not trusted.
export function normalizeVoucherEdit(invoice, input) {
  if (!invoice?.id || !Array.isArray(input?.lines) || !input.lines.length || input.lines.length > 200) throw new Error('Rincian invoice wajib tersedia (maksimum 200 baris)');
  const lines = normalizeLines(input.lines.map(line => {
    const qty = Number(line.jumlah), price = Number(line.harga_satuan);
    if (typeof line.nama !== 'string' || !line.nama.trim() || !Number.isFinite(qty) || qty <= 0 || qty > 1e6 || !Number.isFinite(price) || Math.abs(price) > 1e12 || !Number.isInteger(price)) throw new Error('Jumlah/harga item tidak valid');
    const product = qty * price;
    const subtotal = Math.sign(product) * Math.round(Math.abs(product));
    if (!Number.isSafeInteger(subtotal) || Math.abs(subtotal) > 1e12) throw new Error('Subtotal item tidak valid');
    if (line.subtotal != null && (!Number.isFinite(Number(line.subtotal)) || Math.abs(Number(line.subtotal) - subtotal) > 1)) throw new Error('Subtotal tidak sesuai jumlah × harga');
    const row = { ...line, nama: line.nama.trim().slice(0, 240), jumlah: qty, harga_satuan: price, subtotal };
    if (subtotal < 0 && lineCategory(row) !== BILLING_CATEGORY.DISCOUNT) throw new Error('Nilai negatif hanya untuk potongan');
    return row;
  }));
  const summary = summarize(lines);
  const manual = amount(input.manual_discount, 'Diskon manual');
  const trade = input.trade_in ? amount(input.trade_in_amount, 'Trade-in') : 0;
  if (manual + trade + summary.lineDiscount > summary.grossTotal) throw new Error('Potongan melebihi nilai invoice');
  const rate = Number(input.pph23_rate ?? 0.02);
  if (![PPH23_RATE, PPH23_RATE_ALT].includes(rate)) throw new Error('Tarif PPh 23 tidak valid');
  if (input.pph23 && summary.labor <= 0) throw new Error('PPh 23 memerlukan nilai jasa');
  const customer = String(input.customer ?? invoice.customer ?? '').trim();
  if (!customer || customer.length > 240) throw new Error('Nama tagihan tidak valid');
  return {
    policy_version: VOUCHER_POLICY_VERSION, lines,
    labor: amount(summary.labor, 'Jasa'), material: amount(summary.material, 'Material'),
    line_discount: amount(summary.lineDiscount, 'Potongan baris'), manual_discount: manual,
    trade_in: Boolean(input.trade_in), trade_in_amount: trade,
    pph23: Boolean(input.pph23), pph23_rate: rate,
    pph23_amount: input.pph23 ? computePph23(summary.labor, rate).amount : 0,
    customer, address: String(input.address ?? invoice.address ?? '').slice(0, 2000),
  };
}

export function calculateVoucherBenefit(voucher, edit, { alreadyRedeemed = false } = {}) {
  const value = Number(voucher.value ?? (voucher.type === 'free_service' ? 1 : 0));
  const eligible = edit.lines.filter(line => lineCategory(line) === BILLING_CATEGORY.LABOR && line.subtotal > 0);
  // Existing line reductions/trade-in reduce eligible labor first, so a voucher
  // cannot turn an already-waived service into a material discount.
  const eligibleNet=Math.max(0,eligible.reduce((n,l)=>n+l.subtotal,0)-edit.line_discount-edit.trade_in_amount);
  let benefit = 0;
  if (voucher.type === 'discount_pct') {
    if (!(value > 0 && value <= 100)) throw new Error('Persentase voucher tidak valid');
    benefit = Math.round(eligibleNet * value / 100);
  } else if (voucher.type === 'free_unit') {
    if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('Jumlah unit voucher tidak valid');
    let remaining = value;
    for (const line of eligible.filter(l => /cleaning|cuci|pembersihan/i.test(l.nama)).sort((a,b) => a.harga_satuan - b.harga_satuan)) {
      const qty = Math.min(remaining, Math.floor(line.jumlah));
      benefit += qty * line.harga_satuan; remaining -= qty;
      if (!remaining) break;
    }
    benefit = Math.round(benefit);
  } else if (voucher.type === 'free_service') benefit = eligibleNet;
  else throw new Error('Jenis voucher tidak didukung');
  const available = Math.max(0, edit.labor + edit.material - edit.line_discount - edit.trade_in_amount);
  benefit = Math.min(benefit, eligibleNet, available);
  const discount = Math.max(edit.manual_discount, benefit);
  const incremental = discount - edit.manual_discount;
  if (!alreadyRedeemed && incremental <= 0) throw new Error('Voucher tidak menambah potongan. Simpan tanpa voucher agar voucher tetap tersedia.');
  return { benefit, discount, voucher_discount: incremental, manual_discount: edit.manual_discount,
    total: available - discount, policy_version: VOUCHER_POLICY_VERSION };
}

export function voucherPhone(phone) {
  const value = normalizePhone(phone);
  if (!/^\d{8,15}$/.test(value)) throw new Error('Nomor pelanggan tidak valid');
  return value;
}
