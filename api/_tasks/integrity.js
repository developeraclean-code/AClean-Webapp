import { sb, isCronJobEnabled, OWNER_PHONE } from './_shared.js';
import { sendOpsOwnerAlert } from '../_ops-alert.js';
import { strictCronEnabled } from '../_cron-toggle.js';

export async function taskDataIntegrityAudit({ db = sb, ownerPhone = OWNER_PHONE, alert = sendOpsOwnerAlert, now = Date.now } = {}) {
  const input = await db.from('app_settings').select('key,value').in('key', ['data_integrity_audit_enabled', 'cron_jobs']);
  if (input.error || !Array.isArray(input.data)) throw new Error('Pengaturan audit gagal dibaca');
  const settings = Object.fromEntries(input.data.map(r => [r.key, r.value]));
  if (!isCronJobEnabled(settings, 'data_integrity_audit_enabled') || !strictCronEnabled(settings, 'data_integrity_audit_enabled')) return { skipped: true, reason: 'data_integrity_audit_off' };
  const result = await db.rpc('audit_operational_integrity_216').abortSignal(AbortSignal.timeout(4500));
  if (result.error || !Array.isArray(result.data)) throw new Error('Audit integritas gagal: ' + (result.error?.message || 'respons tidak valid'));
  const findings = result.data;
  if (findings.some(f => !f.check || !['info','warn','critical'].includes(f.severity) || !Number.isFinite(f.n))) throw new Error('Format temuan audit tidak valid');
  const actionable = findings.filter(f => f.n > 0 && f.severity !== 'info'), critical = actionable.filter(f => f.severity === 'critical').length;
  const snapshot = { checked_at: new Date(now()).toISOString(), findings, actionable: actionable.length, critical, read_only: true };
  const stored = await db.from('app_settings').upsert({ key: 'data_integrity_snapshot', value: JSON.stringify(snapshot) }, { onConflict: 'key' });
  if (stored.error) throw new Error('Hasil audit tidak dapat disimpan: ' + stored.error.message);
  if (actionable.length) {
    const date = new Date(now() + 7 * 3600_000).toISOString().slice(0, 10);
    await alert(db, { key: 'integrity:' + date, phone: ownerPhone, toggleKey: 'data_integrity_audit_enabled', message: `🧭 *AUDIT INTEGRITAS DATA ACLEAN*\n${critical} jenis critical, ${actionable.length - critical} jenis peringatan.\n\n`
      + actionable.slice(0, 15).map(f => `${f.severity === 'critical' ? '🔴' : '⚠️'} ${f.check}: ${f.n}`).join('\n')
      + '\n\nTemuan hanya dicatat, tidak diperbaiki otomatis. Periksa snapshot audit di Monitoring atau minta penelusuran Admin/Owner.' });
  }
  return { checked: true, anomalies: actionable.length, critical, clean: !actionable.length, items_processed: findings.length };
}
