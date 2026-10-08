import { normalizePhone, samePhone } from './phone.js';
import { invoiceBalance } from './waWorkspace.js';

export function paymentPhoneVariants(phone) {
  const p = normalizePhone(phone);
  return /^\d{8,15}$/.test(p) ? [...new Set(p.startsWith('628')
    ? [p, `+${p}`, `0${p.slice(2)}`, p.slice(2)] : [p, `+${p}`])] : [];
}

// Suggest only a UNIQUE exact combination. Never assume newest = correct.
// Bound the subset search; large or ambiguous sets require manual selection.
export function matchPaymentInvoices(invoices, phone, amount) {
  const candidates = invoices.filter(i => samePhone(i.phone, phone) && invoiceBalance(i) > 0);
  const target = Number(amount);
  if (!Number.isSafeInteger(target) || target <= 0) return { kind: 'manual', invoices: [], candidates };
  const eligible = candidates.filter(i => invoiceBalance(i) <= target);
  if (eligible.length > 18) return { kind: 'manual', invoices: [], candidates };
  const matches = [];
  function search(index, left, chosen) {
    if (matches.length > 1) return;
    if (left === 0) { matches.push(chosen); return; }
    for (let n = index; n < eligible.length; n++) {
      const balance = invoiceBalance(eligible[n]);
      if (balance <= left) search(n + 1, left - balance, [...chosen, eligible[n]]);
    }
  }
  search(0, target, []);
  if (matches.length !== 1) return { kind: matches.length ? 'ambiguous' : 'manual', invoices: [], candidates };
  return { kind: matches[0].length > 1 ? 'multi' : 'single', invoices: matches[0], candidates };
}
