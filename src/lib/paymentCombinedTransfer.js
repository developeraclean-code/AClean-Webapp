import { withholdingSnapshot } from './paymentWithholding.js';

// A WA proof may cover an AC unit plus installation while this invoice covers
// installation alone. Only the outstanding invoice amount enters its ledger.
export function combinedTransferReview(invoice, suggestion) {
  const total = Number(invoice?.total);
  const paid = Number(invoice?.paid_amount || 0);
  const transfer = Number(suggestion?.amount);
  const remaining = total - paid;
  const excess = transfer - remaining;
  let reason = '';
  if (![total, paid, transfer, remaining, excess].every(Number.isSafeInteger) || total <= 0 || paid < 0 || remaining <= 0 || transfer <= 0)
    reason = 'Nominal invoice atau bukti tidak valid; periksa kembali.';
  else if (!['UNPAID', 'OVERDUE', 'PARTIAL_PAID'].includes(invoice?.status))
    reason = 'Invoice bukan tagihan terbuka.';
  else if (excess <= 0)
    reason = 'Jalur ini hanya untuk transfer yang lebih besar dari sisa tagihan.';
  return { eligible: !reason, reason, remaining, transfer, excess };
}

export async function confirmInvoiceWaCombinedTransfer({ supabase, invoice, suggestion, requestId, paidAt, note, reviewAcknowledged }) {
  const review = combinedTransferReview(invoice, suggestion);
  if (!review.eligible) throw new Error(review.reason);
  if (!suggestion?.id || !suggestion.image_url || !requestId || !reviewAcknowledged || !paidAt || (note || '').trim().length < 10)
    throw new Error('Periksa bukti dan rincian AC + instalasi, lalu isi catatan minimal 10 karakter.');
  const { data, error } = await supabase.rpc('confirm_invoice_wa_combined_transfer_atomic', {
    p_request_id: requestId, p_invoice_id: invoice.id, p_suggestion_id: suggestion.id,
    p_expected_proof_url: suggestion.image_url, p_expected_invoice: withholdingSnapshot(invoice),
    p_paid_at: paidAt, p_note: note.trim(), p_review_ack: true,
  });
  if (error) throw new Error(error.code === 'PGRST202'
    ? 'Migrasi 229 belum terpasang; pembayaran tidak dijalankan melalui jalur cadangan.' : error.message);
  if (data?.invoice?.id !== invoice.id || data.invoice.status !== 'PAID'
    || data.invoice.payment_proof_url !== suggestion.image_url
    || Number(data.payment?.amount) !== review.remaining
    || Number(data.payment?.withheld_amount || 0) !== 0
    || Number(data.payment?.combined_transfer_detail?.transfer_amount) !== review.transfer
    || Number(data.payment?.combined_transfer_detail?.unallocated_amount) !== review.excess
    || data.suggestion?.id !== suggestion.id || data.suggestion.invoice_id !== invoice.id
    || data.suggestion.status !== 'CONFIRMED' || data.suggestion.validation_status !== 'LINKED' || !Array.isArray(data.orders))
    throw new Error('Hasil alokasi transfer belum lengkap; muat ulang dan periksa riwayat sebelum mencoba lagi.');
  return data;
}
