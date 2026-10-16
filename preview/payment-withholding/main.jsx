import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AttachProofModal } from '../../src/views/InvoiceView.jsx';
import { paymentWithholdingReview } from '../../src/lib/paymentWithholding.js';
import { sampleInvoice, sampleProof } from './fixture.js';

const isolatedDatabase = new URLSearchParams(location.search).get('database') === 'isolated';
const fmt = n => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
const demoImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="white"/><text x="24" y="45" font-size="22" fill="#143253">BUKTI SIMULASI</text><text x="24" y="90" font-size="25">Rp 2.902.500</text><text x="24" y="130" font-size="16">Finance perusahaan contoh</text><text x="24" y="180" font-size="16">Bukan bukti bayar asli</text></svg>');

function Demo() {
 const [invoice, setInvoice] = useState(sampleInvoice), [proof, setProof] = useState(sampleProof), [open, setOpen] = useState(true);
 const [notice, setNotice] = useState('Belum ada pembayaran simulasi'), [calls, setCalls] = useState(0), [failure, setFailure] = useState(false);
 const database = {
   from(table) {
     if (table !== 'payment_suggestions') throw new Error('Preview tidak mengakses database lain');
     let status = 'PENDING';
     return { select() { return this; }, eq(k,v) { if (k === 'status') status=v; return this; }, or() { return this; }, not() { return this; }, order() { return this; },
       async range() { return { data: status === 'PENDING' ? [proof] : [] }; }, async limit() { return { data: [] }; } };
   },
   async rpc(name, args) {
     setCalls(n => n + 1);
     if (failure) return { error: { code: 'PGRST202' } };
     if (name !== 'confirm_invoice_wa_withholding_atomic' || !args.p_review_ack) throw new Error('Preview menolak jalur pembayaran lain');
     // Only the browser smoke test intercepts this local-only path and connects
     // it to an isolated PGlite database running the real migration/RPC.
     if (isolatedDatabase) {
       const response = await fetch('/__test__/payment-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) });
       return response.json();
     }
     const review = paymentWithholdingReview(invoice, proof);
     if (!review.eligible) throw new Error(review.reason);
     return { data: { invoice: { ...invoice, status: 'PAID', paid_amount: invoice.total, remaining_amount: 0, withheld_amount: review.deduction, payment_proof_url: proof.image_url },
       payment: { amount: review.cash, withheld_amount: review.deduction }, suggestion: { ...proof, invoice_id: invoice.id, status: 'CONFIRMED', validation_status: 'LINKED' }, orders: [] } };
   },
 };
 return <main><h1>Pembayaran dari Finance + Potongan PPh</h1>
   <p>Preview lokal · data sintetis · tidak memakai API AI, WhatsApp atau Supabase.</p>
   <p>Tagihan {fmt(invoice.total)} · jasa {fmt(invoice.labor)} · material {fmt(invoice.material)}</p>
   <p>Transfer {fmt(proof.amount)} dari nomor finance berbeda.</p>
   <button className="demo" onClick={() => setOpen(true)}>Periksa pembayaran</button>
   <button className="demo" onClick={() => { setInvoice(sampleInvoice); setProof(sampleProof); setFailure(false); setCalls(0); setOpen(true); }}>Reset simulasi</button>
   <button className="demo" onClick={() => { setInvoice(sampleInvoice); setProof({ ...sampleProof, amount: 2800000 }); setOpen(true); }}>Uji selisih di luar toleransi</button>
   <button className="demo" onClick={() => { setInvoice({ ...sampleInvoice, pph23: true }); setOpen(true); }}>Uji invoice gross-up</button>
   <button className="demo" onClick={() => { setFailure(true); setOpen(true); }}>Uji migrasi belum terpasang</button>
   <p role="status">{notice}</p><pre aria-label="Hasil simulasi">{JSON.stringify({ status: invoice.status, kas: invoice.status === 'PAID' ? proof.amount : 0, potonganNonkas: invoice.withheld_amount, apiSimulasi: calls, produksiDiubah: false }, null, 2)}</pre>
   {open && <AttachProofModal key={`${invoice.id}:${invoice.pph23}:${proof.amount}`} inv={{ ...invoice, initialSuggestionId: proof.id }} fotoSrc={() => demoImage} apiHeaders={async () => { throw new Error('Network dinonaktifkan untuk preview'); }}
     supabase={database} markPaid={() => { throw new Error('Tidak boleh pembayaran fallback'); }} setInvoicesData={updater => setInvoice(current => updater([current])[0])}
     setOrdersData={() => {}} setPaymentSuggestions={() => {}} showNotif={setNotice} currentUser={{ name: 'Owner Simulasi', role: 'Owner' }} fmt={fmt} onClose={() => setOpen(false)} />}
 </main>;
}
createRoot(document.getElementById('root')).render(<Demo />);
