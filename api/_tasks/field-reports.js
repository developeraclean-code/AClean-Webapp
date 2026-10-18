import { createHash } from 'node:crypto';
import { sb, isCronJobEnabled } from './_shared.js';
import { dispatchWorkspaceMessage, deliverWorkspaceMessage } from '../_wa-workspace.js';
import { FIELD_REPORT_REMINDER_KEY, fieldReportReminderMessage, fieldReportReminderRecipients, reportReminderClock } from '../../src/lib/fieldReportReminder.js';

const ORDER_COLS = 'id,customer,date,time,time_end,status,project_id,teknisi_id,helper_id,teknisi,helper,teknisi2,helper2,teknisi3,helper3,assigned_members';
export function reportReminderSendId(date, phone) {
  const h = createHash('sha256').update(`field-report-reminder:v1:${date}:${phone}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
async function allRows(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await makeQuery().range(from, from + 199);
    if (error || !Array.isArray(data)) throw new Error('Data reminder laporan belum dapat dibaca: ' + (error?.message || 'respons tidak valid'));
    rows.push(...data); if (data.length < 200) return rows;
  }
}
async function enabled(db) {
  const { data, error } = await db.from('app_settings').select('key,value').in('key', [FIELD_REPORT_REMINDER_KEY, 'cron_jobs']);
  if (error || !Array.isArray(data)) throw new Error('Toggle reminder laporan gagal dibaca');
  const settings = Object.fromEntries(data.map(r => [r.key, r.value]));
  let jobs;
  try { jobs = JSON.parse(settings.cron_jobs || '[]'); } catch { throw new Error('Konfigurasi cron reminder tidak valid'); }
  if (!Array.isArray(jobs)) throw new Error('Konfigurasi cron reminder tidak valid');
  return jobs.some(j => j.backendKey === FIELD_REPORT_REMINDER_KEY && j.active === true)
    && isCronJobEnabled(settings, FIELD_REPORT_REMINDER_KEY) && settings[FIELD_REPORT_REMINDER_KEY] === 'true';
}

// Two recipients per invocation. Repeated ticks resume through the durable outbox;
// SENDING/UNCERTAIN/FAILED are never automatically retried (avoid duplicate WA).
export async function taskFieldReportReminder({ db = sb, deliver = payload => deliverWorkspaceMessage(payload, { timeoutMs: 6000 }), now = () => Date.now(), maxRecipients = 2 } = {}) {
  const clock = reportReminderClock(now());
  if (clock.minutes < 1200) return { skipped: true, reason: 'before_20_wib' };
  if (!await enabled(db)) return { skipped: true, reason: 'field_report_reminder_off' };
  const [orders, profiles] = await Promise.all([
    allRows(() => db.from('orders').select(ORDER_COLS).eq('date', clock.date).order('id')),
    allRows(() => db.from('user_profiles').select('id,name,role,active,phone').in('role', ['Teknisi', 'Helper']).order('id')),
  ]);
  const reports = [];
  // Reports can have a different report date; job_id, not report date, owns receipt.
  for (let i = 0; i < orders.length; i += 100) {
    reports.push(...await allRows(() => db.from('service_reports').select('id,job_id,status').in('job_id', orders.slice(i, i + 100).map(o => o.id)).order('id')));
  }
  const plan = fieldReportReminderRecipients(orders, reports, profiles, now());
  const result = { checked: plan.recipients.length, sent: 0, failed: 0, uncertain: 0, replayed: 0, issues: plan.issues.length, has_more: false, items_processed: 0 };
  let attempts = 0;
  for (const recipient of plan.recipients) {
    if (reportReminderClock(now()).date !== clock.date) break;
    const id = reportReminderSendId(clock.date, recipient.phone);
    const existing = await db.from('wa_outbox').select('id,status').eq('id', id).maybeSingle();
    if (existing.error) throw new Error('Audit reminder tidak dapat dibaca');
    if (existing.data) {
      result.replayed++;
      if (existing.data.status === 'FAILED') result.failed++;
      else if (['SENDING', 'UNCERTAIN'].includes(existing.data.status)) result.uncertain++;
      continue;
    }
    if (attempts >= maxRecipients) { result.has_more = true; continue; }
    if (!await enabled(db)) return { ...result, has_more: false, stopped: 'toggle_off' };
    const ids = recipient.jobs.map(j => j.id);
    const [freshOrders, freshReports, freshProfiles] = await Promise.all([
      allRows(() => db.from('orders').select(ORDER_COLS).in('id', ids).order('id')),
      allRows(() => db.from('service_reports').select('id,job_id,status').in('job_id', ids).order('id')),
      allRows(() => db.from('user_profiles').select('id,name,role,active,phone').in('role', ['Teknisi', 'Helper']).order('id')),
    ]);
    const fresh = fieldReportReminderRecipients(freshOrders, freshReports, freshProfiles, now()).recipients.find(r => r.phone === recipient.phone);
    if (!fresh) continue;
    if (!await enabled(db)) return { ...result, has_more: false, stopped: 'toggle_off' };
    const payload = { phone: fresh.phone, kind: 'TEXT', message: fieldReportReminderMessage(fresh, clock.date), customer_id: null, document_id: `field-report-reminder:${clock.date}`, url: null, filename: null };
    attempts++;
    const row = await dispatchWorkspaceMessage(db, id, payload, 'Pengingat Laporan Lapangan', deliver);
    if (row.replayed) { result.replayed++; continue; }
    if (row.status === 'ACCEPTED' && !row.audit_pending) result.sent++;
    else if (row.status === 'FAILED') result.failed++;
    else result.uncertain++;
  }
  result.items_processed = result.sent;
  if (result.failed || result.uncertain || result.issues) result.error = `${result.failed} gagal, ${result.uncertain} belum pasti, ${result.issues} personel perlu diperiksa; jangan kirim ulang tanpa cek audit`;
  return result;
}
