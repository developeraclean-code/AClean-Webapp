import { cs } from '../theme/cs.js';

export default function FieldReportReminderSettings({ currentUser, enabled, onToggle }) {
  if (currentUser?.role !== 'Owner') return null;
  return <section style={{ background: cs.card, border: '1px solid ' + cs.border, borderRadius: 14, padding: 20 }}>
    <h3 style={{ color: cs.text, fontSize: 14, margin: '0 0 8px' }}>📝 Pengingat Laporan Tim</h3>
    <div style={{ color: cs.muted, fontSize: 12 }}>Setelah 20.00 WIB · maksimal satu WA per nomor teknisi/helper per hari</div>
    <p style={{ color: cs.muted, fontSize: 12, lineHeight: 1.6 }}>
      Mengingatkan pekerjaan hari ini yang laporannya belum dikirim atau masih perlu revisi.
      Satu anggota tim cukup mengirim satu laporan per job. Pekerjaan malam yang belum selesai,
      order pending/batal, dan personel nonaktif tidak diingatkan. Tidak mengubah invoice atau memverifikasi laporan.
    </p>
    <button type="button" role="switch" aria-label="Pengingat laporan tim setelah 20.00" aria-checked={enabled}
      onClick={() => onToggle(!enabled)} style={{ background: enabled ? cs.green + '22' : cs.surface,
        border: '1px solid ' + cs.border, borderRadius: 8, color: cs.text, padding: '10px 16px', cursor: 'pointer', maxWidth: '100%' }}>
      {enabled ? 'ON — Matikan pengingat' : 'OFF — Aktifkan pengingat'}
    </button>
    <div style={{ color: cs.muted, fontSize: 11, marginTop: 12 }}>
      Verifikasi otomatis 48 jam dan auto-return material telah dihentikan. Verifikasi tetap manual;
      pencatatan material melalui Admin. Status gagal/belum pasti dapat diperiksa di Monitoring dan audit pengiriman WA.
    </div>
  </section>;
}
