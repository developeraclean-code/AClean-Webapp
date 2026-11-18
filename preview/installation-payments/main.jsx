// Synthetic browser fixture. All database calls use an intercepted localhost route.
import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AttachProofModal } from '../../src/views/InvoiceView.jsx';
const seed = { id: 'I1', job_id: 'J1', customer: 'Customer Simulasi', phone: '628000000001', service: 'Install', total: 2135000,
  labor: 600000, material: 1535000, paid_amount: 0, remaining_amount: 2135000, status: 'UNPAID', withheld_amount: 0, materials_detail: [] };
const proof = { id: '30000000-0000-4000-8000-000000000001', amount: 515000, phone: seed.phone, image_url: 'proof-synthetic', transfer_date: '2026-11-16T00:00:00Z', status: 'PENDING', validation_status: 'PENDING' };
const database = {
  from(table) {
    const filters = []; let from = 0, to = 199;
    const run = () => fetch('/__test__/installation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table, filters, from, to }) }).then(r => r.json());
    const query = { select() { return query; }, eq(k,v) { filters.push([k,v]); return query; }, or() { return query; }, not() { return query; }, order() { return query; },
      single() { return run().then(r => ({ ...r, data: r.data?.[0] })); }, range(a,b) { from=a; to=b; return run(); }, limit() { return run(); } };
    return query;
  },
  rpc(name, args) { return fetch('/__test__/installation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) }).then(r => r.json()); },
};
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="white"/><text x="20" y="60">Simulasi transfer Rp515.000</text></svg>');
const fmt = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
function Demo() {
  const [invoice, setInvoice] = useState(seed), [open, setOpen] = useState(true), [notice, setNotice] = useState('');
  const update = useCallback(updater => setInvoice(current => updater([current])[0]), []);
  return <main><h1>Simulasi pelunasan instalasi</h1><p role="status">{notice}</p><pre aria-label="Hasil">{JSON.stringify(invoice)}</pre>
    {open && <AttachProofModal inv={{ ...invoice, initialSuggestionId: proof.id }} fotoSrc={() => image} supabase={database} fmt={fmt}
      setInvoicesData={update} setOrdersData={() => {}} setPaymentSuggestions={() => {}} showNotif={setNotice}
      currentUser={{ name: 'Owner Simulasi', role: 'Owner' }} onClose={() => setOpen(false)}
      markPaid={() => { throw new Error('Fallback dilarang'); }} />}</main>;
}
createRoot(document.getElementById('root')).render(<Demo />);
