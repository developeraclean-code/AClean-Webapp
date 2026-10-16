// An admin's settlement tolerance, NOT a change to the statutory PPh rate or
// the existing gross-up invoice calculation. No automatic matching/approval.
import { samePhone } from './phone.js';

export function withholdingSnapshot(invoice) {
  return {
    total: Number(invoice.total || 0), labor: Number(invoice.labor || 0),
    paid_amount: Number(invoice.paid_amount || 0), withheld_amount: Number(invoice.withheld_amount || 0),
    pph23: !!invoice.pph23, pph23_amount: Number(invoice.pph23_amount || 0),
    status: invoice.status, phone: invoice.phone || '',
    materials_detail: invoice.materials_detail ?? null,
  };
}

export function paymentWithholdingReview(invoice, suggestion) {
  const total = Number(invoice?.total), paid = Number(invoice?.paid_amount || 0);
  const cash = Number(suggestion?.amount), base = Number(invoice?.labor);
  const remaining = total - paid, deduction = remaining - cash;
  const valid = [total, paid, cash, base, deduction].every(Number.isSafeInteger)
    && total > 0 && paid >= 0 && cash > 0 && base > 0 && base <= total;
  const grossUp = !!invoice?.pph23 || Number(invoice?.pph23_amount || 0) > 0;
  let reason = '';
  if (!valid) reason = 'Nominal atau dasar jasa belum valid; periksa invoice/bukti terlebih dahulu.';
  else if (!['UNPAID', 'OVERDUE', 'PARTIAL_PAID'].includes(invoice.status)) reason = 'Invoice bukan tagihan terbuka.';
  else if (grossUp) reason = 'Invoice sudah memakai PPh gross-up: totalnya adalah transfer neto. Jangan potong PPh kedua kali.';
  else if (Number(invoice.withheld_amount || 0) > 0) reason = 'Potongan PPh sudah pernah dicatat pada invoice ini.';
  else if (deduction < Math.round(base * 0.02) || deduction > Math.round(base * 0.03) || deduction <= 0)
    reason = 'Selisih di luar toleransi 2–3% dari jasa. Gunakan Catat Pembayaran untuk cicilan atau periksa rincian invoice.';
  return { eligible: !reason, reason, cash, base, remaining, deduction,
    expectedTax: Math.round(base * 0.02), effectiveRate: base > 0 ? deduction / base * 100 : 0,
    differentPhone: !samePhone(invoice?.phone, suggestion?.phone) };
}

export async function confirmInvoiceWaWithholding({ supabase, invoice, suggestion, requestId, paidAt, note, reviewAcknowledged }) {
  const review = paymentWithholdingReview(invoice, suggestion);
  if (!review.eligible) throw new Error(review.reason);
  if (!suggestion?.id || !suggestion.image_url || !requestId || !reviewAcknowledged || (note || '').trim().length < 10)
    throw new Error('Periksa bukti, konfirmasi pengirim dan potongan, lalu isi catatan minimal 10 karakter.');
  const { data, error } = await supabase.rpc('confirm_invoice_wa_withholding_atomic', {
    p_request_id: requestId, p_invoice_id: invoice.id, p_suggestion_id: suggestion.id,
    p_expected_proof_url: suggestion.image_url, p_expected_invoice: withholdingSnapshot(invoice),
    p_paid_at: paidAt, p_note: note.trim(), p_review_ack: true,
  });
  if (error) throw new Error(error.code === 'PGRST202'
    ? 'Migrasi 212 belum terpasang. Pembayaran tidak dijalankan melalui jalur cadangan.' : error.message);
  if (data?.invoice?.id !== invoice.id || data.invoice.status !== 'PAID'
    || data.invoice.payment_proof_url !== suggestion.image_url
    || Number(data.invoice.withheld_amount) !== review.deduction
    || Number(data.payment?.amount) !== review.cash || Number(data.payment?.withheld_amount) !== review.deduction
    || data.suggestion?.id !== suggestion.id || data.suggestion.invoice_id !== invoice.id
    || data.suggestion.status !== 'CONFIRMED' || data.suggestion.validation_status !== 'LINKED' || !Array.isArray(data.orders))
    throw new Error('Hasil pelunasan belum lengkap; muat ulang dan periksa riwayat sebelum mencoba lagi.');
  return data;
}

export function invoiceCashReceived(invoice) {
  if (invoice?.cash_amount != null) return Number(invoice.cash_amount) || 0;
  const settled = invoice?.status === 'PAID' ? Number(invoice.total || 0)
    : invoice?.status === 'PARTIAL_PAID' ? Number(invoice.paid_amount || 0) : 0;
  return Math.max(0, settled - Number(invoice?.withheld_amount || 0));
}
