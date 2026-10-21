import { samePhone } from './phone.js';
// One request = one database transaction. Never fall back to separate writes or
// mark the UI PAID before a validated server result. Keep the same request on retry.
export function groupInvoiceBalance(invoice) {
  return Math.max(0, Number(invoice.total || 0) - Number(invoice.paid_amount || 0));
}

export function groupPaymentProof(suggestions, phone, invoices) {
  const due=invoices.reduce((sum,i)=>sum+groupInvoiceBalance(i),0);
  const matching=(suggestions || []).filter(s=>samePhone(s.phone,phone) && s.image_url
    && s.status==='PENDING' && s.validation_status==='PENDING' && Number(s.amount)===due);
  return matching.length===1 ? matching[0] : null;
}

export function groupInvoiceSnapshot(invoice) {
  return {
    total: Number(invoice.total || 0), paid_amount: Number(invoice.paid_amount || 0),
    remaining_amount: invoice.remaining_amount == null ? null : Number(invoice.remaining_amount),
    withheld_amount: Number(invoice.withheld_amount || 0), status: invoice.status,
    phone: invoice.phone || '', customer: invoice.customer || '', job_id: invoice.job_id ?? null,
  };
}

export function createGroupPaymentRequest({ invoices, invoiceIds, totalReceived, customerPhone,
  proofUrl, method, suggestionId = null, reviewAcknowledged, requestId = globalThis.crypto.randomUUID(),
  paidAt = new Date().toISOString() }) {
  const ids = [...invoiceIds].sort();
  if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
    throw new Error('Pilih 1–20 invoice berbeda.');
  const selected = ids.map(id => invoices.find(i => i.id === id));
  if (selected.some(i => !i || !['UNPAID', 'OVERDUE', 'PARTIAL_PAID'].includes(i.status)))
    throw new Error('Invoice berubah/tidak lengkap; muat ulang sebelum membayar.');
  const amount = Number(totalReceived), due = selected.reduce((s, i) => s + groupInvoiceBalance(i), 0);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > due)
    throw new Error('Nominal harus rupiah utuh, positif dan tidak melebihi sisa tagihan.');
  if (!reviewAcknowledged) throw new Error('Periksa bukti, pengirim, nominal dan pilihan invoice sebelum konfirmasi.');
  return {
    p_request_id: requestId, p_invoice_ids: ids, p_total_received: amount, p_paid_at: paidAt,
    p_method: method, p_customer_phone: customerPhone,
    p_expected: Object.fromEntries(selected.map(i => [i.id, groupInvoiceSnapshot(i)])),
    p_payment_proof_url: (proofUrl || '').trim() || null,
    p_suggestion_id: suggestionId, p_review_ack: true,
  };
}

export function groupPaymentError(error) {
  if (['PGRST202', '42883'].includes(error?.code))
    return 'Migrasi 220 pembayaran gabungan belum tersedia. Tidak memakai jalur penyimpanan lama.';
  if (error?.code === '23502' && /invoice_id.*payments|payments.*invoice_id/i.test(error.message || ''))
    return 'Skema pembayaran grup belum sinkron (migrasi 221). Pembayaran ditolak tanpa mengubah invoice; ulangi dengan ID permintaan yang sama setelah diperbaiki.';
  if (['40001','P0001','42501','23505','23503','23514','55P03'].includes(error?.code))
    return error.message || 'Pembayaran ditolak; periksa invoice dan riwayat.';
  return 'Hasil pembayaran belum dapat dipastikan. Jangan buat pembayaran baru. Periksa riwayat atau ulangi permintaan yang sama dengan ID tetap.';
}

export async function handleGroupPayment(supabase, request) {
  let response;
  try { response = await supabase.rpc('record_group_payment_atomic', request).abortSignal(AbortSignal.timeout(15_000)); }
  catch (error) { throw new Error(groupPaymentError(error)); }
  const { data, error } = response;
  if (error) throw new Error(groupPaymentError(error));
  const ids = request.p_invoice_ids;
  const rows = data?.invoices;
  const allocation = data?.payment?.allocation_detail;
  const sum = Object.values(allocation || {}).reduce((total, amount) => total + Number(amount), 0);
  const valid = data?.payment?.id != null && Number(data.payment.amount) === request.p_total_received
    && Object.entries(allocation || {}).every(([id, amount]) => ids.includes(id)
      && Number.isSafeInteger(Number(amount)) && Number(amount)>0
      && Number(amount)<=request.p_expected[id].total-request.p_expected[id].paid_amount)
    && sum === request.p_total_received && Array.isArray(rows) && rows.length === ids.length
    && new Set(rows.map(i => i.id)).size === ids.length && rows.every(i => ids.includes(i.id)
      && Number(i.total)===request.p_expected[i.id].total
      && (Number(allocation?.[i.id] || 0) === 0 || (['PAID','PARTIAL_PAID'].includes(i.status)
        && Number(i.paid_amount) === request.p_expected[i.id].paid_amount + Number(allocation[i.id])
        && Number(i.remaining_amount) === Number(i.total) - Number(i.paid_amount))))
    && Array.isArray(data.orders)
    && (!request.p_suggestion_id || (data.suggestion?.id === request.p_suggestion_id
      && String(data.suggestion.group_payment_id) === String(data.payment.id)
      && data.suggestion.status === 'CONFIRMED' && data.suggestion.validation_status === 'LINKED'));
  if (!valid) throw new Error(groupPaymentError());
  return data;
}
