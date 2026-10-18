import { createHash } from 'node:crypto';
import { dispatchWorkspaceMessage, deliverWorkspaceMessage } from './_wa-workspace.js';
import { normalizePhone } from '../src/lib/phone.js';
import { strictCronEnabled } from './_cron-toggle.js';

export function resolveOpsOwnerTarget(profiles, { ownerId, fallbackPhone } = {}) {
  const active = profiles.filter(p => p.role === 'Owner' && p.active === true);
  const selected = ownerId ? active.filter(p => p.id === ownerId)
    : active.filter(p => normalizePhone(p.phone) === normalizePhone(fallbackPhone));
  if (selected.length !== 1) throw new Error('Tujuan alert tidak cocok dengan satu Owner aktif; periksa konfigurasi alert operasional');
  const phone = normalizePhone(selected[0].phone);
  if (!/^\d{8,15}$/.test(phone)) throw new Error('Nomor Owner belum valid');
  return phone;
}

export async function sendOpsOwnerAlert(db, { key, phone, message, toggleKey }, deliver = payload => deliverWorkspaceMessage(payload, { timeoutMs: 5500 })) {
  if (!['infra_usage_alert_enabled','data_integrity_audit_enabled'].includes(toggleKey)) throw new Error('Toggle alert tidak valid');
  const config = await db.from('app_settings').select('key,value').in('key', ['cron_jobs', toggleKey, 'ops_alert_owner_id']);
  if (config.error || !Array.isArray(config.data)) throw new Error('Pengaturan alert tidak dapat diperiksa ulang');
  if (!strictCronEnabled(Object.fromEntries(config.data.map(r => [r.key,r.value])), toggleKey)) return { status: 'SKIPPED', reason: 'toggle_off' };
  const profiles = await db.from('user_profiles').select('id,phone,role,active').eq('role', 'Owner').eq('active', true);
  if (profiles.error || !Array.isArray(profiles.data)) throw new Error('Profil tujuan alert tidak dapat diverifikasi');
  const target = resolveOpsOwnerTarget(profiles.data, { ownerId: config.data.find(r => r.key === 'ops_alert_owner_id')?.value,
    fallbackPhone: phone });
  const hash = createHash('sha256').update('ops-alert:v1:' + key + ':' + target).digest('hex');
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const row = await dispatchWorkspaceMessage(db, id, { phone: target, kind: 'TEXT', message,
    document_id: 'ops-alert:' + key, customer_id: null, url: null, filename: null }, 'Monitor Operasional', deliver);
  if (row.status !== 'ACCEPTED' || row.audit_pending) throw new Error('Alert Owner gagal/belum pasti; periksa outbox sebelum mengirim ulang');
  return { status: row.status, replayed: row.replayed === true };
}
