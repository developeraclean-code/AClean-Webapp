import { cs } from '../theme/cs.js';
import { combinedTransferReview } from '../lib/paymentCombinedTransfer.js';

export default function PaymentCombinedTransferReview({ invoice, suggestion, accepted, onAccepted, note, onNote, paidAt, onPaidAt, disabled, fmt }) {
  const review = combinedTransferReview(invoice, suggestion);
  return <section aria-label="Pemeriksaan transfer AC dan instalasi" style={{ marginTop: 12, padding: 12, border: `1px solid ${cs.yellow}`, borderRadius: 10, color: cs.text, fontSize: 12 }}>
    <b>Transfer lebih besar dari tagihan instalasi</b>
    <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, margin: '12px 0' }}>
      <dt>Sisa tagihan invoice</dt><dd style={{ margin: 0 }}>{fmt(review.remaining)}</dd>
      <dt>Nominal pada bukti transfer</dt><dd style={{ margin: 0 }}>{fmt(review.transfer)}</dd>
      <dt>Dialokasikan ke invoice ini</dt><dd style={{ margin: 0 }}>{fmt(review.remaining)}</dd>
      <dt>Kelebihan yang belum dialokasikan</dt><dd style={{ margin: 0 }}>{fmt(review.excess)}</dd>
    </dl>
    {!review.eligible ? <p role="alert" style={{ color: cs.yellow }}>{review.reason}</p> : <>
      <p style={{ color: cs.yellow }}>Pakai hanya jika bukti ini benar membayar unit AC sekaligus instalasi untuk customer ini. Kelebihan tidak menjadi pendapatan invoice instalasi dan harus direkonsiliasi dengan penjualan unit AC secara terpisah. Satu bukti tidak bisa dilampirkan lagi ke invoice lain.</p>
      <label style={{ display: 'block', lineHeight: 1.5 }}>
        <input type="checkbox" checked={accepted} disabled={disabled} onChange={e => onAccepted(e.target.checked)} />
        {' '}Saya telah memeriksa pengirim dan rincian penjualan AC + instalasi, serta menyetujui alokasi {fmt(review.remaining)} untuk melunasi invoice ini.
      </label>
      <label style={{ display: 'block', marginTop: 10 }}>Tanggal transfer
        <input type="date" value={paidAt} disabled={disabled} onChange={e => onPaidAt(e.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 8, color: cs.text, background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 6 }} />
      </label>
      <label style={{ display: 'block', marginTop: 10 }}>Catatan pemeriksaan (minimal 10 karakter; sebutkan penjualan unit AC terkait)
        <textarea value={note} maxLength={1000} disabled={disabled} onChange={e => onNote(e.target.value)} placeholder="Contoh: Transfer mencakup AC unit dan instalasi; invoice penjualan unit AC ..."
          style={{ display: 'block', minHeight: 64, width: '100%', boxSizing: 'border-box', padding: 8, color: cs.text, background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 6 }} />
      </label>
    </>}
  </section>;
}
