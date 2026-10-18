import { useEffect, useRef, useState } from 'react';
import { cs } from '../theme/cs.js';
import { INTEGRITY_LABELS, integrityReviewTargets } from '../lib/integrityReview.js';

export default function RecoveryStatusPanel({ currentUser, supabase, refreshKey, onNavigate }) {
  const [state, setState] = useState({ loading: true });
  const [detail, setDetail] = useState(null);
  const requestId = useRef(0);
  useEffect(() => {
    setDetail(null);
    if (currentUser?.role !== 'Owner') return;
    let active = true;
    supabase.rpc('get_operational_recovery_status_216').then(({ data, error }) => {
      if (active) setState(error ? { error: error.message } : { data });
    }).catch(error => { if (active) setState({ error: error.message }); });
    return () => { active = false; requestId.current++; };
  }, [currentUser?.role, supabase, refreshKey]);
  const loadDetails = async (check, offset = 0) => {
    if (currentUser?.role !== 'Owner' || !Object.hasOwn(INTEGRITY_LABELS, check)) return;
    const id = ++requestId.current;
    setDetail({ check, offset, loading: true });
    try {
      const { data, error } = await supabase.rpc('get_operational_integrity_details_218', { p_check: check, p_offset: offset, p_limit: 25 });
      if (error) throw new Error(error.message);
      if (data?.check !== check || !Array.isArray(data.rows) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('Respons rincian audit tidak valid');
      if (requestId.current === id) setDetail({ check, offset, data });
    } catch (error) { if (requestId.current === id) setDetail({ check, offset, error: error.message }); }
  };
  if (currentUser?.role !== 'Owner') return null;
  const audit = state.data?.audit, backup = state.data?.backup;
  const staleAudit = !audit?.checked_at || Date.now() - Date.parse(audit.checked_at) > 8 * 86400_000;
  const staleBackup = !backup?.at || Date.now() - Date.parse(backup.at) > 8 * 86400_000;
  const time = value => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  return <section aria-label="Audit dan pemulihan data" style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 14, padding: 16, overflowWrap: 'anywhere' }}>
    <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>🛡️ Audit &amp; Pemulihan Data</h3>
    {state.loading ? <p>Membaca status…</p> : state.error ? <p style={{ color: cs.yellow }}>Status belum dapat dibaca: {state.error}. Pastikan migrasi 216 sudah diterapkan.</p> : <>
      <p style={{ color: staleAudit ? cs.yellow : audit?.critical ? cs.red : cs.text }}>
        Audit: {audit?.checked_at ? time(audit.checked_at) : 'Belum pernah dijalankan'}{staleAudit ? ' · Perlu pemeriksaan jadwal' : ''}
      </p>
      {audit && <p>{audit.critical || 0} jenis kritis · {audit.actionable || 0} jenis perlu diperiksa. Tidak ada perbaikan data otomatis.</p>}
      {audit?.alert && <p style={{ color: audit.alert.status === 'FAILED' ? cs.yellow : cs.muted }}>
        Alert WA Owner: {({ ACCEPTED: 'Diterima provider', FAILED: 'Gagal — audit data tetap tersimpan', PENDING: 'Menunggu pengiriman', SKIPPED: 'Dilewati (toggle OFF)', NOT_REQUIRED: 'Tidak diperlukan' })[audit.alert.status] || 'Belum dapat dipastikan'}
        {audit.alert.error ? ` · ${audit.alert.error}` : ''}
      </p>}
      {(audit?.findings || []).map(f => <div key={f.check} style={{ padding: '6px 0', color: f.severity === 'critical' ? cs.red : f.severity === 'warn' ? cs.yellow : cs.muted }}>
        {f.severity.toUpperCase()} · {INTEGRITY_LABELS[f.check] || f.check}: {f.n}
        {Object.hasOwn(INTEGRITY_LABELS, f.check) && <button onClick={() => loadDetails(f.check)} style={{ marginLeft: 8, cursor: 'pointer', color: cs.accent, background: cs.surface, border: `1px solid ${cs.border}`, padding: '5px 9px', borderRadius: 6 }}>Tinjau data ({f.n})</button>}
      </div>)}
      {detail && <section aria-label="Rincian temuan audit" style={{ padding: 12, marginTop: 12, border: `1px solid ${cs.border}`, borderRadius: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <strong>{INTEGRITY_LABELS[detail.check]}</strong>
          <button onClick={() => { requestId.current++; setDetail(null); }}>Tutup rincian</button>
        </div>
        <p style={{ color: cs.muted, fontSize: 12 }}>Hanya peninjauan. Tidak menghapus, memperbaiki tautan, atau mengubah pembayaran/stok otomatis.</p>
        {detail.loading ? <p>Memuat rincian…</p> : detail.error ? <div role="alert">Rincian belum dapat dibaca: {detail.error}. Pastikan migrasi 218 sudah diterapkan. <button onClick={() => loadDetails(detail.check, detail.offset)}>Coba lagi</button></div> : <>
          <p>{detail.data.total} temuan · halaman {Math.floor(detail.offset / 25) + 1}. Hasil dibaca ulang dari database.</p>
          {!detail.data.rows.length && <p>Tidak ada baris pada halaman ini. Data mungkin sudah berubah; segarkan audit sebelum menyimpulkan bersih.</p>}
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>{detail.data.rows.map(row => <article key={row.id} style={{ borderTop: `1px solid ${cs.border}`, padding: '10px 0', overflowWrap: 'anywhere' }}>
            <strong>{row.client_name || row.customer || row.unit_code || row.id}</strong>
            <div style={{ fontSize: 12, color: cs.muted }}>{[row.invoice_id, row.order_id, row.unit_code, row.date, row.location].filter(Boolean).join(' · ')}</div>
            {row.related_client_name && <div>Perusahaan pemilik aset: {row.related_client_name}</div>}
            {row.count != null && <div>{row.count} aset memakai kode ini</div>}
            {row.value != null && <div>Nilai tercatat: {row.value}{row.received != null ? ` · Penerimaan: ${row.received}` : ''}</div>}
            <div style={{ fontSize: 12 }}>{row.description}</div>
            {onNavigate && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{integrityReviewTargets(row).map(t => <button key={t.menu + ':' + (t.focus.clientId || t.focus.reference)} onClick={() => onNavigate(t.menu, t.focus)}>{t.label} →</button>)}</div>}
          </article>)}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={!detail.offset} onClick={() => loadDetails(detail.check, Math.max(0, detail.offset - 25))}>Sebelumnya</button>
            <button disabled={detail.offset + 25 >= detail.data.total} onClick={() => loadDetails(detail.check, detail.offset + 25)}>Berikutnya</button>
          </div>
        </>}
      </section>}
      <p style={{ color: staleBackup || !backup?.encrypted ? cs.yellow : cs.text }}>
        Backup: {backup?.at ? `${time(backup.at)} · ${backup.tables} tabel` : 'Belum tersedia'}
        {backup?.encrypted ? ' · Terenkripsi & checksum baca ulang lulus' : ' · Belum memakai format terenkripsi baru'}
        {staleBackup ? ' · Perlu pemeriksaan jadwal' : ''}
      </p>
      <small style={{ color: cs.muted }}>Checksum bukan bukti pemulihan penuh. Uji restore dijalankan terpisah di database terisolasi; file foto dan akun Auth tidak tercakup dalam bundle ini.</small>
    </>}
  </section>;
}
