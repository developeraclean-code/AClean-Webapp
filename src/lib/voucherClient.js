export function voucherEditDraft(invoice, form, jasa, material) {
  return { lines: [
    ...jasa.filter(l => l.nama && Number(l.jumlah)>0).map(({category,...l})=>({...l,keterangan:'jasa'})),
    ...material.filter(l => l.nama && Number(l.jumlah)>0).map(({category,...l})=>({...l,keterangan:['barang','freon','diskon'].includes(String(l.keterangan||'').toLowerCase())?l.keterangan:'barang'})),
  ], manual_discount: Number(form.discount || 0), trade_in: Boolean(form.trade_in), trade_in_amount: Number(form.trade_in_amount || 0),
  pph23: Boolean(form.pph23), pph23_rate: Number(form.pph23_rate || 0.02), customer: form.billing_name ?? invoice.customer,
  address: form.billing_address ?? invoice.address ?? '' };
}
export async function voucherRequest(path, body, apiHeaders, fetchImpl = fetch) {
  let response;
  try { response = await fetchImpl(path, { method: 'POST', headers: await apiHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(25000) }); }
  catch { throw Object.assign(new Error('Hasil simpan belum terkonfirmasi. Gunakan tombol konfirmasi ulang; ID transaksi tetap sama.'), { uncertain: true }); }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw Object.assign(new Error(result?.error || 'Layanan voucher tidak tersedia'), { uncertain: response.status>=500 || !result, status: response.status });
  return result;
}
