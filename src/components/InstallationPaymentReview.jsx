import { useEffect, useRef, useState } from 'react';
import { cs } from '../theme/cs.js';
import { getLocalDate } from '../lib/dateTime.js';
import { earlierInstallationPaymentRequest, installationPaymentReview, verifiedEarlierPayment } from '../lib/installationPayments.js';

export default function InstallationPaymentReview({ invoice, proof, supabase, fmt, actorName, finalDate, onInvoice, onBlocked, onSaving }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('transfer');
  const [paidAt, setPaidAt] = useState('');
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const savingRef = useRef(false);
  const invoiceId = invoice.id;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: fresh, error: invoiceError } = await supabase.from('invoices')
          .select('id,service,total,paid_amount,remaining_amount,status,withheld_amount,payment_proof_url,labor,pph23,pph23_amount,materials_detail,phone')
          .eq('id', invoiceId).single();
        if (invoiceError) throw invoiceError;
        if (!fresh) throw new Error('Invoice tidak ditemukan.');
        const rows = [];
        for (let from = 0; ; from += 200) {
          const { data, error: historyError } = await supabase.from('invoice_payments')
            .select('id,amount,withheld_amount,method,notes,paid_at,recorded_by_name')
            .eq('invoice_id', invoiceId).order('paid_at', { ascending: true }).order('id', { ascending: true }).range(from, from + 199);
          if (historyError) throw historyError;
          rows.push(...(data || []));
          if (!alive || (data || []).length < 200) break;
        }
        if (alive) { setHistory(rows); onInvoice(fresh); }
      } catch (err) { if (alive) setError(err.message); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [supabase, invoiceId, onInvoice]);

  const review = installationPaymentReview(invoice, proof, history);
  const blocked = loading || saving || !!error || uncertain || !review.eligible;
  useEffect(() => { onBlocked(blocked); }, [blocked, onBlocked]);
  const field = { width: '100%', boxSizing: 'border-box', padding: 8, background: cs.card, color: cs.text, border: `1px solid ${cs.border}`, borderRadius: 6 };
  const request = () => earlierInstallationPaymentRequest({ invoice, proof, history, amount, method, paidAt, finalDate,
    note, acknowledged: ack, today: getLocalDate(), requestId: 'preview', actorName });
  let valid = false;
  try { request(); valid = !blocked; } catch { /* form incomplete */ }

  const save = async () => {
    if (!valid || savingRef.current) return;
    savingRef.current = true; setSaving(true); onSaving(true);
    let committed = false;
    try {
      const payload = { ...request(), p_payment_id: crypto.randomUUID() };
      const { data, error: saveError } = await supabase.rpc('record_invoice_partial_payment_atomic', payload);
      if (saveError) throw saveError;
      if (!verifiedEarlierPayment(data, payload)) throw new Error('Hasil pencatatan belum lengkap.');
      committed = true;
      setHistory(rows => [...rows.filter(row => row.id !== data.payment.id), data.payment]);
      onInvoice(data.invoice);
      setAmount(''); setPaidAt(''); setNote(''); setAck(false);
    } catch (err) {
      // A lost response is not permission to replay cash. Stop and inspect the ledger.
      setUncertain(true);
      setError(`${committed ? 'Pembayaran tersimpan, tetapi tampilan gagal diperbarui.' : 'Hasil pencatatan belum dapat dipastikan.'} ${err.message} Tutup lalu periksa riwayat pembayaran sebelum mencatat lagi.`);
    } finally { savingRef.current = false; setSaving(false); onSaving(false); }
  };

  return <section aria-label="Pembayaran bertahap instalasi" style={{ marginTop: 10, border: `1px solid ${cs.accent}`, borderRadius: 10, padding: 12, fontSize: 12, color: cs.text }}>
    <b>Cocokkan pembayaran paket dan tambahan</b>
    <p>Catat setiap penerimaan terdahulu yang belum masuk riwayat. Bukti terpilih hanya mewakili transfer terakhir. Selisih tidak dicatat sebagai potongan.</p>
    <p style={{ color: cs.yellow }}>Jika pembayaran sudah tercatat pada invoice paket lain, jangan catat ulang di sini. Periksa alokasi pembayaran terlebih dahulu.</p>
    {loading ? <p>Memuat saldo dan riwayat terbaru…</p> : <>
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 5 }}>
        <dt>Total invoice</dt><dd style={{ margin: 0 }}>{fmt(review.total)}</dd>
        <dt>Sudah tercatat</dt><dd style={{ margin: 0 }}>{fmt(review.paid)}</dd>
        <dt>Transfer terakhir (bukti AI)</dt><dd style={{ margin: 0 }}>{fmt(review.cash)}</dd>
        <dt>Sisa tagihan saat ini</dt><dd style={{ margin: 0 }}>{fmt(review.remaining)}</dd>
        <dt>Selisih yang perlu ditelusuri</dt><dd style={{ margin: 0 }}>{fmt(review.gap)}</dd>
      </dl>
      <b>Riwayat pembayaran — periksa agar tidak ganda</b>
      {history.length ? <div style={{ maxHeight: 130, overflowY: 'auto', marginTop: 6 }}>{history.map(row => <div key={row.id} style={{ marginBottom: 6 }}>
        {row.paid_at} · {fmt(row.amount)} · {row.method} · {row.notes || 'Tanpa catatan'}
      </div>)}</div> : <p>Belum ada pembayaran tercatat.</p>}
      {error && <p role="alert" style={{ color: cs.yellow }}>{error}</p>}
      {!review.eligible && <p role="alert" style={{ color: cs.yellow }}>{review.reason}</p>}
      {review.eligible && !error && review.gap === 0 && <p style={{ color: cs.green }}>Sisa tagihan sudah sesuai bukti terakhir. Periksa bukti dan konfirmasi pelunasan di bawah.</p>}
      {review.eligible && !error && review.gap > 0 && <fieldset disabled={saving || uncertain} style={{ border: 0, padding: 0, margin: '12px 0 0', display: 'grid', gap: 9 }}>
        <legend style={{ marginBottom: 8, fontWeight: 700 }}>Tambah satu pembayaran terdahulu</legend>
        <label>Nominal yang benar-benar diterima
          <input type="number" min="1" step="1" value={amount} onChange={e => { setAmount(e.target.value); setAck(false); }} style={field} />
        </label>
        <label>Metode penerimaan
          <select value={method} onChange={e => { setMethod(e.target.value); setAck(false); }} style={field}><option value="transfer">Transfer</option><option value="cash">Tunai</option></select>
        </label>
        <label>Tanggal penerimaan terdahulu
          <input type="date" min="2000-01-01" max={finalDate < getLocalDate() ? finalDate : getLocalDate()} value={paidAt} onChange={e => { setPaidAt(e.target.value); setAck(false); }} style={field} />
        </label>
        <label>Referensi transaksi / bukti penerimaan (minimal 10 karakter)
          <textarea value={note} maxLength={1000} onChange={e => { setNote(e.target.value); setAck(false); }} placeholder="Contoh: DP paket, transfer tanggal …, referensi bank …" style={field} />
        </label>
        <label><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> Saya sudah memeriksa penerimaan ini dan memastikan belum tercatat di riwayat invoice.</label>
        <button type="button" disabled={!valid} onClick={save} style={{ ...field, background: valid ? cs.accent : cs.card, cursor: valid ? 'pointer' : 'not-allowed' }}>
          {saving ? 'Menyimpan…' : 'Catat pembayaran terdahulu saja'}
        </button>
        <span style={{ color: cs.muted }}>Tindakan ini menyimpan pembayaran nyata. Invoice belum dilunasi dan bukti terakhir belum digunakan. Jika selisih tidak dapat dijelaskan, periksa rincian invoice terlebih dahulu.</span>
      </fieldset>}
      <p style={{ color: cs.muted }}>Acuan tanggal bukti terakhir: {finalDate}. Pelunasan terakhir dicatat pada tanggal konfirmasi, mengikuti alur verifikasi bukti WA.</p>
    </>}
  </section>;
}
