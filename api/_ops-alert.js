import { createHash } from 'node:crypto';
import { dispatchWorkspaceMessage, deliverWorkspaceMessage } from './_wa-workspace.js';
import { normalizePhone } from '../src/lib/phone.js';
import { strictCronEnabled } from './_cron-toggle.js';

export async function sendOpsOwnerAlert(db, { key, phone, message, toggleKey }, deliver = payload => deliverWorkspaceMessage(payload, { timeoutMs: 5500 })) {
  if (!['infra_usage_alert_enabled','data_integrity_audit_enabled'].includes(toggleKey)) throw new Error('Toggle alert tidak valid');
  const config = await db.from('app_settings').select('key,value').in('key', ['cron_jobs', toggleKey]);
  if (config.error || !Array.isArray(config.data)) throw new Error('Pengaturan alert tidak dapat diperiksa ulang');
  if (!strictCronEnabled(Object.fromEntries(config.data.map(r => [r.key,r.value])), toggleKey)) return { status: 'SKIPPED', reason: 'toggle_off' };
  const target = normalizePhone(phone);
  if (!/^\d{8,15}$/.test(target)) throw new Error('Nomor Owner belum valid');
  const profiles = await db.from('user_profiles').select('phone').eq('role', 'Owner').eq('active', true);
  if (profiles.error || !profiles.data?.some(p => normalizePhone(p.phone) === target)) throw new Error('Tujuan alert tidak cocok dengan Owner aktif');
  const hash = createHash('sha256').update('ops-alert:v1:' + key + ':' + target).digest('hex');
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const row = await dispatchWorkspaceMessage(db, id, { phone: target, kind: 'TEXT', message,
    document_id: 'ops-alert:' + key, customer_id: null, url: null, filename: null }, 'Monitor Operasional', deliver);
  if (row.status !== 'ACCEPTED' || row.audit_pending) throw new Error('Alert Owner gagal/belum pasti; periksa outbox sebelum mengirim ulang');
  return { status: row.status, replayed: row.replayed === true };
}
