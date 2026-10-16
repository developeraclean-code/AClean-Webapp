// Synthetic data only. Same six-item storage/read shape as the reported bug.
export const rawInvoice = {
  id: 'INV-DEMO-ONE3', job_id: 'JOB-DEMO-ONE3', customer: 'Perusahaan Contoh (simulasi)', phone: '628000000001',
  total: 2950000, labor: 2350000, material: 600000, paid_amount: 0, remaining_amount: 2950000, withheld_amount: 0,
  status: 'UNPAID', pph23: false, pph23_amount: 0,
  materials_detail: JSON.stringify([
    { nama: 'Jasa cassette contoh A', jumlah: 1, subtotal: 850000, category: 'LABOR' },
    { nama: 'Jasa cassette contoh B', jumlah: 1, subtotal: 850000, category: 'LABOR' },
    { nama: 'Cleaning contoh A', jumlah: 1, subtotal: 100000, category: 'LABOR' },
    { nama: 'Cleaning contoh B', jumlah: 1, subtotal: 100000, category: 'LABOR' },
    { nama: 'Kapasitor + pasang contoh', jumlah: 1, subtotal: 450000, category: 'LABOR' },
    { nama: 'Material contoh', jumlah: 4, subtotal: 600000, category: 'PART' },
  ], null, 2),
};
// App.parseInvoiceRow performs exactly this conversion on the loaded invoice.
export const sampleInvoice = { ...rawInvoice, materials_detail: JSON.parse(rawInvoice.materials_detail) };
export const sampleProof = {
  id: '30000000-0000-4000-8000-000000009000', sender_name: 'Finance Contoh', phone: '628000000002',
  amount: 2902500, transfer_date: '2026-10-15T00:00:00Z', status: 'PENDING', validation_status: 'PENDING',
  image_url: 'demo-proof.svg', match_source: 'wa_image_ai', invoice_id: null,
};
