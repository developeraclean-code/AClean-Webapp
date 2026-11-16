// Reconcile real earlier receipts; never reinterpret the gap as tax or cash.
export function isInstallationInvoice(invoice) {
  return /^(install|installation|instalasi)$/i.test(String(invoice?.service || '').trim());
}

export function installationPaymentReview(invoice, proof, history = []) {
  const total = Number(invoice?.total), paid = Number(invoice?.paid_amount || 0), cash = Number(proof?.amount);
  const remaining = total - paid;
  const ledger = history.reduce((sum, row) => sum + Number(row.amount) + Number(row.withheld_amount || 0), 0);
  let reason = '';
  if (!isInstallationInvoice(invoice)) reason = 'Pilihan ini khusus invoice instalasi.';
  else if (![total, paid, cash, ledger].every(Number.isSafeInteger) || total <= 0 || paid < 0 || cash <= 0)
    reason = 'Nominal invoice, bukti atau riwayat belum valid.';
  else if (!['UNPAID', 'OVERDUE', 'PARTIAL_PAID'].includes(invoice.status)) reason = 'Invoice bukan tagihan terbuka.';
  else if (Number(invoice.withheld_amount || 0) > 0) reason = 'Invoice memiliki potongan PPh; periksa melalui riwayat pembayaran.';
  else if (ledger > paid) reason = 'Riwayat pembayaran melebihi saldo tercatat. Periksa sebelum melanjutkan.';
  else if (cash > remaining) reason = 'Bukti terakhir melebihi sisa tagihan. Periksa alokasi pembayarannya.';
  return { eligible: !reason, reason, total, paid, cash, remaining, gap: remaining - cash };
}

export function earlierInstallationPaymentRequest({ invoice, proof, history, amount, method, paidAt, finalDate, note, acknowledged, today, requestId, actorName }) {
  const review = installationPaymentReview(invoice, proof, history);
  if (!review.eligible) throw new Error(review.reason);
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value <= 0 || value > review.gap)
    throw new Error('Isi nominal pembayaran nyata, maksimal selisih sebelum transfer terakhir.');
  if (!['transfer', 'cash'].includes(method) || !/^\d{4}-\d{2}-\d{2}$/.test(paidAt)
    || !Number.isFinite(Date.parse(paidAt)) || new Date(paidAt).toISOString().slice(0, 10) !== paidAt
    || paidAt < '2000-01-01' || paidAt > today || !finalDate || paidAt > finalDate)
    throw new Error('Periksa metode dan tanggal pembayaran terdahulu.');
  if (!requestId || !acknowledged || (note || '').trim().length < 10 || note.trim().length > 1000)
    throw new Error('Periksa riwayat agar tidak ganda dan isi referensi penerimaan minimal 10 karakter.');
  return { p_payment_id: requestId, p_invoice_id: invoice.id, p_amount: value, p_method: method,
    p_paid_at: paidAt, p_notes: `Pembayaran bertahap instalasi: ${note.trim()}`, p_actor_name: actorName || null };
}

export function verifiedEarlierPayment(result, request) {
  const payment = result?.payment, invoice = result?.invoice;
  return invoice?.id === request.p_invoice_id && payment?.id === request.p_payment_id
    && payment.invoice_id === request.p_invoice_id && Number(payment.amount) === request.p_amount
    && payment.method === request.p_method && payment.paid_at === request.p_paid_at && payment.notes === request.p_notes
    && ['PARTIAL_PAID', 'PAID'].includes(invoice.status)
    && Number.isSafeInteger(Number(invoice.paid_amount)) && Number(invoice.paid_amount) >= request.p_amount
    && Number(invoice.remaining_amount) === Number(invoice.total) - Number(invoice.paid_amount);
}
