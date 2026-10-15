export async function confirmInvoiceWaProof({ supabase, invoiceId, suggestion, requestId, reviewAcknowledged = false, actorName = null }) {
  if (!invoiceId || !suggestion?.id || !suggestion.image_url || !requestId) throw new Error('Pilih bukti WA dan invoice yang lengkap');
  const { data, error } = await supabase.rpc('confirm_invoice_wa_proof_atomic', {
    p_request_id: requestId, p_invoice_id: invoiceId, p_suggestion_id: suggestion.id,
    p_expected_proof_url: suggestion.image_url, p_review_ack: reviewAcknowledged, p_actor_name: actorName,
  });
  if (error) throw new Error(error.code === 'PGRST202' ? 'Migrasi 206 belum terpasang; pembayaran tidak dijalankan melalui jalur cadangan' : error.message);
  if (data?.invoice?.id !== invoiceId || data.invoice.status !== 'PAID'
    || data.invoice.payment_proof_url !== suggestion.image_url || data.suggestion?.id !== suggestion.id
    || data.suggestion.status !== 'CONFIRMED' || data.suggestion.validation_status !== 'LINKED'
    || data.suggestion.invoice_id !== invoiceId || !Array.isArray(data.orders)) {
    throw new Error('Hasil verifikasi belum lengkap; muat ulang dan periksa riwayat sebelum mencoba lagi');
  }
  return data;
}
