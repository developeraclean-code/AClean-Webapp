export const INTEGRITY_LABELS = {
  invoice_maint_yatim: 'Invoice belum terhubung ke klien maintenance',
  unit_code_dup: 'Kode aset duplikat dalam perusahaan yang sama',
  unit_ids_missing: 'Unit pilihan order tidak ditemukan',
  unit_ids_other_client: 'Unit order berasal dari perusahaan berbeda',
  unit_ids_invalid_json: 'Format daftar unit order tidak valid',
  log_client_mismatch: 'Klien laporan servis berbeda dari pemilik aset',
  log_unit_dangling: 'Laporan servis merujuk aset yang tidak tersedia',
  unit_client_dangling: 'Aset merujuk perusahaan yang tidak tersedia',
  followup_unit_dangling: 'Follow-up merujuk aset yang tidak tersedia',
  followup_log_dangling: 'Follow-up merujuk laporan yang tidak tersedia',
  unit_active_no_interval: 'Interval PM belum ditentukan (informasi)',
  invoice_payment_orphan: 'Pembayaran merujuk invoice yang tidak tersedia',
  inventory_unit_orphan: 'Unit stok tidak memiliki master inventori',
  inventory_negative: 'Stok master negatif',
  inventory_unit_negative: 'Stok unit fisik negatif',
  quotation_payment_overapplied: 'Alokasi DP di luar penerimaan',
};

export function integrityReviewTargets(row) {
  const result = [];
  if (row.invoice_id) result.push({ label: 'Buka invoice', menu: 'invoice', focus: { reference: row.invoice_id } });
  if (row.client_id) result.push({ label: 'Buka perusahaan', menu: 'maintenance', focus: {
    clientId: row.client_id, orderId: row.order_id || null, tab: row.order_id ? 'link' : 'unit', unitCode: row.unit_code || '' } });
  if (row.related_client_id && row.related_client_id !== row.client_id) result.push({ label: 'Buka pemilik aset', menu: 'maintenance',
    focus: { clientId: row.related_client_id, tab: 'unit', unitCode: row.unit_code || '' } });
  if (row.order_id) result.push({ label: 'Buka pekerjaan', menu: 'orders', focus: { reference: row.order_id } });
  if (row.inventory_code) result.push({ label: 'Buka inventori', menu: 'inventory', focus: { reference: row.inventory_code } });
  return result;
}
