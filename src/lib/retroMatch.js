// A match is a candidate for admin review, never a payment confirmation.
import { paymentPhoneVariants, matchPaymentInvoices } from './waPaymentMatch.js';

export async function retroMatchPayment(inv, { addAgentLog, supabase } = {}) {
  if (!supabase || !inv?.id || !paymentPhoneVariants(inv.phone).length) return { matched: false };
  try {
    // Never choose the newest proof merely because its phone matches.
    const { data: fresh, error: freshError } = await supabase.from('invoices').select('*').eq('id', inv.id).single();
    if (freshError) throw freshError;
    if (!fresh || !['UNPAID', 'OVERDUE', 'PARTIAL_PAID'].includes(fresh.status)) return { matched: false };
    const variants = paymentPhoneVariants(fresh.phone);
    const invoices = [], candidates = [];
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    for (let from = 0; ; from += 200) {
      if (from >= 10000) throw new Error('Terlalu banyak invoice untuk pencocokan aman; periksa manual');
      const { data, error } = await supabase.from('invoices')
        .select('id,phone,total,status,paid_amount,remaining_amount')
        .in('phone', variants).in('status', ['UNPAID', 'OVERDUE', 'PARTIAL_PAID'])
        .order('id').range(from, from + 199);
      if (error) throw error;
      invoices.push(...(data || []));
      if ((data || []).length < 200) break;
    }
    for (let from = 0; ; from += 200) {
      if (from >= 10000) throw new Error('Terlalu banyak bukti untuk pencocokan aman; periksa manual');
      const { data, error } = await supabase.from('payment_suggestions')
        .select('id,phone,amount,image_url,invoice_id,status,validation_status')
        .in('phone', variants).is('invoice_id', null).eq('status', 'PENDING')
        .eq('validation_status', 'PENDING').gte('created_at', cutoff)
        .order('id').range(from, from + 199);
      if (error) throw error;
      candidates.push(...(data || []));
      if ((data || []).length < 200) break;
    }
    const matches = candidates.filter(proof => {
      if (!proof.image_url) return false;
      const match = matchPaymentInvoices(invoices, fresh.phone, Number(proof.amount));
      return match.kind === 'single' && match.invoices[0].id === fresh.id;
    });
    if (matches.length !== 1) return { matched: false, ambiguous: matches.length > 1 };
    // Locks invoice -> suggestion and rechecks the match. Cannot attach a proof,
    // confirm it, or write any payment ledger, including after approval races.
    const { data, error } = await supabase.rpc('link_payment_suggestion_for_review', {
      p_invoice_id: fresh.id, p_suggestion_id: matches[0].id,
    });
    if (error) throw error;
    if (!data?.suggestion || data.suggestion.status !== 'PENDING') throw new Error('Hasil pencocokan bukti tidak valid');
    addAgentLog?.('PAYMENT_REVIEW_MATCHED', `Kandidat bukti ${matches[0].id} → ${fresh.id}; menunggu verifikasi admin`, 'INFO');
    return { matched: true, suggestion: data.suggestion };
  } catch (error) {
    const message = error?.message || 'Pencocokan bukti gagal';
    console.warn('[PAYMENT_REVIEW_MATCH]', message);
    addAgentLog?.('PAYMENT_REVIEW_MATCH_FAILED', `${inv.id}: ${message}. Bukti tetap perlu diperiksa manual.`, 'WARNING');
    return { matched: false, error: message };
  }
}
