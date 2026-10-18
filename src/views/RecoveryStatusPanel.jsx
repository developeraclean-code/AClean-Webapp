import { useEffect, useState } from 'react';
import { cs } from '../theme/cs.js';

export default function RecoveryStatusPanel({ currentUser, supabase, refreshKey }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    if (currentUser?.role !== 'Owner') return;
    let active = true;
    supabase.rpc('get_operational_recovery_status_216').then(({ data, error }) => {
      if (active) setState(error ? { error: error.message } : { data });
    }).catch(error => { if (active) setState({ error: error.message }); });
    return () => { active = false; };
  }, [currentUser?.role, supabase, refreshKey]);
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
      {(audit?.findings || []).map(f => <div key={f.check} style={{ padding: '6px 0', color: f.severity === 'critical' ? cs.red : f.severity === 'warn' ? cs.yellow : cs.muted }}>
        {f.severity.toUpperCase()} · {f.check}: {f.n}{f.sample ? ` · Contoh ID: ${f.sample}` : ''}
      </div>)}
      <p style={{ color: staleBackup || !backup?.encrypted ? cs.yellow : cs.text }}>
        Backup: {backup?.at ? `${time(backup.at)} · ${backup.tables} tabel` : 'Belum tersedia'}
        {backup?.encrypted ? ' · Terenkripsi & checksum baca ulang lulus' : ' · Belum memakai format terenkripsi baru'}
        {staleBackup ? ' · Perlu pemeriksaan jadwal' : ''}
      </p>
      <small style={{ color: cs.muted }}>Checksum bukan bukti pemulihan penuh. Uji restore dijalankan terpisah di database terisolasi; file foto dan akun Auth tidak tercakup dalam bundle ini.</small>
    </>}
  </section>;
}
