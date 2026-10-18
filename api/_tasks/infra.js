import { sb, isCronJobEnabled, OWNER_PHONE } from './_shared.js';
import { getR2BucketUsage } from '../_r2-upload.js';
import { sendOpsOwnerAlert } from '../_ops-alert.js';
import { strictCronEnabled } from '../_cron-toggle.js';

const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
export async function taskInfraUsageAlert({ db = sb, measureR2 = getR2BucketUsage, ownerPhone = OWNER_PHONE,
  alert = sendOpsOwnerAlert, now = Date.now } = {}) {
  const input = await db.from('app_settings').select('key,value').in('key', ['infra_usage_alert_enabled', 'cron_jobs',
    'infra_usage_warn_percent', 'infra_usage_critical_percent', 'infra_usage_last_alert', 'infra_usage_scan_checkpoint']);
  if (input.error || !Array.isArray(input.data)) throw new Error('Pengaturan alarm kuota tidak dapat dibaca');
  const settings = Object.fromEntries(input.data.map(r => [r.key, r.value]));
  if (!isCronJobEnabled(settings, 'infra_usage_alert_enabled') || !strictCronEnabled(settings, 'infra_usage_alert_enabled')) return { skipped: true, reason: 'infra_usage_alert_off' };
  const date = new Date(now() + 7 * 3600_000).toISOString().slice(0, 10);
  const saved = parse(settings.infra_usage_scan_checkpoint);
  const checkpoint = saved.date === date && typeof saved.continuationToken === 'string'
    && ['bytes','objects','requests'].every(k => Number.isSafeInteger(saved[k]) && saved[k] >= 0) ? saved : {};
  const [database, r2] = await Promise.all([
    db.rpc('get_infra_database_size').abortSignal(AbortSignal.timeout(3000)),
    measureR2({ checkpoint, resumable: true, maxPages: 2, requestTimeoutMs: 2500, totalTimeoutMs: 4000 }),
  ]);
  const warn = Math.max(1, Number(settings.infra_usage_warn_percent) || 70), critical = Math.max(warn, Number(settings.infra_usage_critical_percent) || 85);
  const bytes = Number(database.data?.bytes), dbBytes = !database.error && Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
  const complete = r2.ok && r2.complete !== false;
  const r2Bytes = complete ? r2.bytes : null;
  const percent = (n, limit) => n == null ? null : Math.round(n / limit * 1000) / 10;
  const dbPercent = percent(dbBytes, 500 * 1024 ** 2), r2Percent = percent(r2Bytes, 10 * 1024 ** 3);
  const values = [dbPercent, r2Percent];
  const level = values.some(v => v != null && v >= critical) ? 'critical' : values.some(v => v != null && v >= warn) ? 'warning' : values.some(v => v == null) ? 'unknown' : 'ok';
  const snapshot = { measured_at: new Date(now()).toISOString(), level, warn_percent: warn, critical_percent: critical,
    supabase_database: { bytes: dbBytes, percent: dbPercent, limit_bytes: 500 * 1024 ** 2, error: database.error?.message || null },
    r2_storage: { bytes: r2Bytes, percent: r2Percent, limit_bytes: 10 * 1024 ** 3, objects: complete ? r2.objects : null,
      scanning: r2.ok && !complete, scanned_objects: r2.objects || 0, requests: r2.requests || 0, error: r2.ok ? null : r2.err },
    external_dashboards: { supabase_egress: 'unavailable', vercel_usage: 'unavailable' } };
  const writes = [{ key: 'infra_usage_snapshot', value: JSON.stringify(snapshot) }];
  if (r2.ok) writes.push({ key: 'infra_usage_scan_checkpoint', value: complete ? '{}' : JSON.stringify({ date,
    continuationToken: r2.continuationToken, bytes: r2.bytes, objects: r2.objects, requests: r2.requests }) });
  const persisted = await db.from('app_settings').upsert(writes, { onConflict: 'key' });
  if (persisted.error) throw new Error('Snapshot kuota gagal disimpan: ' + persisted.error.message);
  let alerted = false;
  const previous = parse(settings.infra_usage_last_alert);
  if (['warning', 'critical'].includes(level) && (previous.level !== level || now() - Date.parse(previous.at) >= 7 * 86400_000 || !previous.at)) {
    const sent = await alert(db, { key: 'infra:' + date + ':' + level, phone: ownerPhone, toggleKey: 'infra_usage_alert_enabled',
      message: `🚨 *ALARM KUOTA ACLEAN*\nSupabase DB: ${dbPercent ?? 'belum tersedia'}%\nR2: ${r2Percent ?? 'belum selesai dipindai'}%\nBatas warning ${warn}% / kritis ${critical}%. Periksa Monitoring.` });
    if (sent?.status === 'SKIPPED') return { checked: true, has_more: !complete, alerted: false, level, stopped: 'toggle_off' };
    const recorded = await db.from('app_settings').upsert({ key: 'infra_usage_last_alert', value: JSON.stringify({ level, at: new Date(now()).toISOString() }) }, { onConflict: 'key' });
    if (recorded.error) throw new Error('Alert diterima provider; pencatatan status gagal');
    alerted = true;
  } else if (level === 'ok' && previous.level && previous.level !== 'ok') {
    const recovered = await db.from('app_settings').upsert({ key: 'infra_usage_last_alert', value: JSON.stringify({ level: 'ok', at: new Date(now()).toISOString() }) }, { onConflict: 'key' });
    if (recovered.error) throw new Error('Status pemulihan kuota gagal disimpan');
  }
  return { checked: true, has_more: !complete, alerted, level, scan_complete: complete,
    ...(database.error || !r2.ok ? { error: database.error?.message || r2.err || 'Pengukuran kuota belum lengkap' } : {}) };
}
