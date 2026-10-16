import { cs } from '../theme/cs.js';
import { paymentWithholdingReview } from '../lib/paymentWithholding.js';

export default function PaymentWithholdingReview({ invoice, suggestion, accepted, onAccepted, note, onNote, paidAt, onPaidAt, disabled, fmt }) {
  const review = paymentWithholdingReview(invoice, suggestion);
  return <section aria-label="Pemeriksaan potongan PPh" style={{ marginTop: 12, padding: 12, border: `1px solid ${cs.yellow}`, borderRadius: 10, color: cs.text, fontSize: 12 }}>
    <b>Transfer berbeda dari sisa tagihan</b>
    <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, margin: '12px 0' }}>
      <dt>Sisa tagihan</dt><dd style={{ margin: 0 }}>{fmt(review.remaining)}</dd>
      <dt>Transfer yang masuk</dt><dd style={{ margin: 0 }}>{fmt(review.cash)}</dd>
      <dt>Selisih / potongan</dt><dd style={{ margin: 0 }}>{fmt(review.deduction)}</dd>
      <dt>Dasar jasa (bukan material)</dt><dd style={{ margin: 0 }}>{fmt(review.base)}</dd>
      <dt>Rasio selisih terhadap jasa</dt><dd style={{ margin: 0 }}>{review.effectiveRate.toLocaleString('id-ID', { maximumFractionDigits: 3 })}%</dd>
    </dl>
    {!review.eligible ? <p role="alert" style={{ color: cs.yellow }}>{review.reason}</p> : <>
      <p style={{ color: cs.muted }}>Acuan 2%: {fmt(review.expectedTax)}. Toleransi admin 2–3% bukan perubahan tarif pajak. Potongan dicatat nonkas sebagai estimasi, belum bukti potong terverifikasi. Total/harga invoice tidak diubah.</p>
      <label style={{ display: 'block', lineHeight: 1.5 }}>
        <input type="checkbox" checked={accepted} disabled={disabled} onChange={e => onAccepted(e.target.checked)} />
        {' '}Saya konfirmasi selisih {fmt(review.deduction)} sebagai potongan PPh estimasi untuk melunasi invoice ini.
      </label>
      <label style={{ display: 'block', marginTop: 10 }}>Tanggal transfer
        <input type="date" value={paidAt} disabled={disabled} onChange={e => onPaidAt(e.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 8, color: cs.text, background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 6 }} />
      </label>
      <label style={{ display: 'block', marginTop: 10 }}>Catatan pemeriksaan (minimal 10 karakter)
        <textarea value={note} maxLength={1000} disabled={disabled} onChange={e => onNote(e.target.value)} placeholder="Contoh: Finance perusahaan membayar setelah potongan PPh; bukti potong menyusul."
          style={{ display: 'block', minHeight: 64, width: '100%', boxSizing: 'border-box', padding: 8, color: cs.text, background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 6 }} />
      </label>
    </>}
  </section>;
}
