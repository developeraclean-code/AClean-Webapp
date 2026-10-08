import { paymentPhoneVariants } from './waPaymentMatch.js';
import { fotoUrl } from './fotoUrl.js';

export function waMediaUrl(value) {
  const url = String(value || '').trim();
  if (/^https?:\/\//i.test(url) || /^\/api\/foto\?key=[^\s]+$/.test(url)) return fotoUrl(url);
  return null;
}

// On open / manual refresh only. Independent of the global latest-20 poll.
export async function fetchWaPaymentContext(db, phone) {
  const variants = paymentPhoneVariants(phone);
  if (!variants.length) return { suggestions: [], invoices: [] };
  async function rows(table, columns) {
    const result = [];
    for (let from = 0; ; from += 200) {
      let query = db.from(table).select(columns).in('phone', variants);
      query = table === 'payment_suggestions' ? query.eq('status', 'PENDING')
        : query.in('status', ['UNPAID', 'OVERDUE', 'PARTIAL_PAID']);
      const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(from, from + 199);
      if (error) throw new Error(error.message || 'Bukti dan invoice gagal dimuat');
      result.push(...(data || []));
      if ((data || []).length < 200) return result;
    }
  }
  const [suggestions, invoices] = await Promise.all([
    rows('payment_suggestions', '*'),
    rows('invoices', 'id,job_id,customer,phone,status,total,paid_amount,remaining_amount,created_at'),
  ]);
  return { suggestions, invoices };
}
