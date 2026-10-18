import { describe, expect, it, vi } from 'vitest';
import { fieldReportReminderMessage, fieldReportReminderRecipients, missingDailyReports, reportReminderClock } from '../fieldReportReminder.js';
vi.mock('../../../api/_tasks/_shared.js', () => ({ sb: {}, isCronJobEnabled: (settings, key) => !JSON.parse(settings.cron_jobs || '[]').some(j => j.backendKey === key && j.active === false) }));
import { reportReminderSendId, taskFieldReportReminder } from '../../../api/_tasks/field-reports.js';

const at = time => Date.parse(`2026-10-18T${time}:00+07:00`);
const profiles = [
  { id: 'T1', name: 'Teknisi Satu', role: 'Teknisi', active: true, phone: '081200000001' },
  { id: 'H1', name: 'Helper Satu', role: 'Helper', active: true, phone: '628120000002' },
];
const job = (id = 'J1', extra = {}) => ({ id, customer: 'Customer Simulasi', status: 'CONFIRMED', date: '2026-10-18', time: '09:00:00', time_end: '11:00:00', teknisi: 'Teknisi Satu', helper: 'Helper Satu', ...extra });

function memoryDb(options = {}) {
  const outbox = new Map(), calls = [];
  const data = { orders: [job()], service_reports: [], user_profiles: structuredClone(profiles), ...options.data };
  let settingsReads = 0;
  const db = {
    from(table) {
      if (!['orders', 'service_reports', 'user_profiles', 'app_settings', 'wa_outbox'].includes(table)) throw new Error('Unexpected mutation/table: ' + table);
      const q = { filters: [], single: false, select() { return q; }, order() { return q; },
        eq(k, v) { q.filters.push(r => r[k] === v); return q; }, in(k, values) { q.filters.push(r => values.includes(r[k])); return q; },
        range(from, to) { q.bounds = [from, to]; return q; }, maybeSingle() { q.single = true; return q; },
        then(resolve, reject) {
          calls.push({ table });
          if (table === options.failTable) return Promise.resolve({ error: { message: 'offline' } }).then(resolve, reject);
          options.onRead?.(table, data, calls);
          let rows;
          if (table === 'app_settings') {
            settingsReads++;
            rows = [{ key: 'field_report_reminder_enabled', value: options.standalone ?? 'true' }, { key: 'cron_jobs', value: options.cronValue ?? JSON.stringify([{ backendKey: 'field_report_reminder_enabled', active: options.canonical !== false && !(options.killAfter && settingsReads >= options.killAfter) }]) }];
          } else rows = table === 'wa_outbox' ? [...outbox.values()] : data[table];
          rows = rows.filter(r => q.filters.every(f => f(r)));
          if (q.bounds) rows = rows.slice(q.bounds[0], q.bounds[1] + 1);
          return Promise.resolve({ data: q.single ? rows[0] || null : rows, error: null }).then(resolve, reject);
        },
      }; return q;
    },
    async rpc(name, p) {
      calls.push({ rpc: name });
      if (name === 'claim_wa_send') {
        if (outbox.has(p.p_id)) return { data: { claimed: false, row: outbox.get(p.p_id) } };
        const row = { id: p.p_id, status: 'SENDING', ...p.p_payload }; outbox.set(p.p_id, row);
        return { data: { claimed: true, row } };
      }
      if (name === 'finish_wa_send') {
        if (options.failFinish) return { error: { message: 'audit unavailable' } };
        const row = outbox.get(p.p_id); Object.assign(row, { status: p.p_status }); return { data: row };
      }
      throw new Error('Unexpected RPC: ' + name);
    },
  }; return { db, outbox, calls, data };
}

describe('20:00 WIB staff report reminders', () => {
  it('uses WIB and never runs before 20:00 or targets another day', async () => {
    expect(reportReminderClock(at('20:00'))).toEqual({ date: '2026-10-18', minutes: 1200 });
    const { db, calls } = memoryDb(), deliver = vi.fn();
    expect(await taskFieldReportReminder({ db, deliver, now: () => at('19:59') })).toMatchObject({ skipped: true });
    expect(calls).toHaveLength(0); expect(deliver).not.toHaveBeenCalled();
    expect(missingDailyReports([job('OLD', { date: '2026-10-17' })], [], at('20:00'))).toEqual([]);
  });
  it.each([{ standalone: 'false' }, { standalone: '' }, { canonical: false }, { cronValue: '[]' }])('fails closed when either toggle is off: %j', async options => {
    const { db } = memoryDb(options), deliver = vi.fn();
    expect(await taskFieldReportReminder({ db, deliver, now: () => at('20:00') })).toMatchObject({ skipped: true }); expect(deliver).not.toHaveBeenCalled();
  });
  it.each(['{', 'null', '{}'])('does not send with malformed cron configuration: %s', async cronValue => {
    const { db } = memoryDb({ cronValue }), deliver = vi.fn();
    await expect(taskFieldReportReminder({ db, deliver, now: () => at('20:00') })).rejects.toThrow('tidak valid'); expect(deliver).not.toHaveBeenCalled();
  });
  it.each(['SUBMITTED', 'VERIFIED'])('one %s report covers every member, not only its author', status => {
    expect(fieldReportReminderRecipients([job()], [{ job_id: 'J1', status }], profiles, at('20:00')).recipients).toEqual([]);
  });
  it.each(['REVISION', 'REJECTED', 'DRAFT', 'PENDING'])('reminds unfinished reports without verifying them: %s', status => {
    expect(fieldReportReminderRecipients([job()], [{ job_id: 'J1', status }], profiles, at('20:00')).recipients).toHaveLength(2);
  });
  it.each(['PENDING', 'CANCELLED', 'RESCHEDULED', 'PAID', 'INVOICE_APPROVED', 'REPORT_SUBMITTED'])('does not nag %s work', status => {
    expect(missingDailyReports([job('J1', { status })], [], at('20:00'))).toEqual([]);
  });
  it('does remind a report explicitly returned for revision even if the order still says REPORT_SUBMITTED', () => {
    expect(fieldReportReminderRecipients([job('J1', { status: 'REPORT_SUBMITTED' })], [{ job_id: 'J1', status: 'REVISION' }], profiles, at('20:00')).recipients).toHaveLength(2);
  });
  it('excludes project reports and unfinished night/overnight work', () => {
    const rows = [job('PROJECT', { project_id: 'P1' }), job('NIGHT', { time: '19:00', time_end: '22:00' }), job('OVERNIGHT', { time: '23:00', time_end: '04:00' })];
    expect(missingDailyReports(rows, [], at('20:00'))).toEqual([]);
    expect(missingDailyReports(rows, [], at('22:01')).map(r => r.id)).toEqual(['NIGHT']);
  });
  it('collects all assigned slots, excludes former employees and deduplicates a shared phone', () => {
    const extra = [
      { id: 'H2', name: 'Helper Dua', role: 'Helper', active: true, phone: '081200000001' },
      { id: 'OLD', name: 'Sudah Keluar', role: 'Teknisi', active: false, phone: '081299999999' },
    ];
    const plan = fieldReportReminderRecipients([job('A', { helper2: 'Helper Dua', assigned_members: ['Teknisi Satu', 'Sudah Keluar'] }), job('B')], [], [...profiles, ...extra], at('20:00'));
    expect(plan.recipients).toHaveLength(2); expect(plan.issues).toEqual([]);
    expect(plan.recipients.every(r => r.jobs.length === 2)).toBe(true);
    expect(fieldReportReminderMessage(plan.recipients[0], '2026-10-18')).toContain('A');
    expect(fieldReportReminderMessage(plan.recipients[0], '2026-10-18')).toContain('- Auto Reply by ARA -');
  });
  it('does not choose an arbitrary profile when names are ambiguous', () => {
    const plan = fieldReportReminderRecipients([job('A', { helper: null })], [], [profiles[0], { ...profiles[0], id: 'T2', phone: '081288888888' }], at('20:00'));
    expect(plan.recipients).toHaveLength(0); expect(plan.issues[0].reason).toContain('ambigu');
  });
  it('sends once to each in-charge staff, never to the customer phone, across 200 concurrent retries', async () => {
    const { db, outbox, calls } = memoryDb({ data: { orders: [job('J1', { phone: '628777777777' }), job('J2')] } });
    const deliver = vi.fn(async () => ({ status: 'ACCEPTED' }));
    await Promise.all(Array.from({ length: 200 }, () => taskFieldReportReminder({ db, deliver, now: () => at('20:00') })));
    expect(deliver).toHaveBeenCalledTimes(2); expect(outbox.size).toBe(2);
    expect(deliver.mock.calls.map(([p]) => p.phone).sort()).toEqual(['6281200000001', '628120000002']);
    expect(calls.filter(c => c.rpc).every(c => ['claim_wa_send', 'finish_wa_send'].includes(c.rpc))).toBe(true);
  });
  it('simulates 200 jobs, paginates and resumes bounded batches without repeated staff reminders', async () => {
    const { db, outbox } = memoryDb({ data: { orders: Array.from({ length: 200 }, (_, i) => job('SIM-' + i)) } });
    const deliver = vi.fn(async () => ({ status: 'ACCEPTED' }));
    const first = await taskFieldReportReminder({ db, deliver, now: () => at('20:00'), maxRecipients: 1 });
    expect(first).toMatchObject({ sent: 1, has_more: true });
    const second = await taskFieldReportReminder({ db, deliver, now: () => at('20:05'), maxRecipients: 1 });
    expect(second).toMatchObject({ sent: 1, replayed: 1, has_more: false });
    expect(outbox.size).toBe(2); expect(deliver.mock.calls.every(([p]) => p.message.length <= 4096)).toBe(true);
  });
  it.each(['orders', 'service_reports', 'user_profiles', 'app_settings', 'wa_outbox'])('stops visibly on %s read failure before sending', async failTable => {
    const { db } = memoryDb({ failTable }), deliver = vi.fn();
    await expect(taskFieldReportReminder({ db, deliver, now: () => at('20:00') })).rejects.toThrow(); expect(deliver).not.toHaveBeenCalled();
  });
  it('rechecks receipt by job ID even when the report date differs', async () => {
    const { db } = memoryDb({ data: { service_reports: [{ id: 'R1', job_id: 'J1', status: 'SUBMITTED', date: '2026-10-17' }] } }), deliver = vi.fn();
    expect(await taskFieldReportReminder({ db, deliver, now: () => at('20:00') })).toMatchObject({ sent: 0 }); expect(deliver).not.toHaveBeenCalled();
  });
  it('rechecks live report submissions and the kill switch immediately before sending', async () => {
    let reads = 0;
    const { db } = memoryDb({ onRead: (table, data) => { if (table === 'service_reports' && ++reads >= 2) data.service_reports = [{ id: 'R', job_id: 'J1', status: 'SUBMITTED' }]; } });
    const deliver = vi.fn(); await taskFieldReportReminder({ db, deliver, now: () => at('20:00') }); expect(deliver).not.toHaveBeenCalled();
    const killed = memoryDb({ killAfter: 3 }); await taskFieldReportReminder({ db: killed.db, deliver, now: () => at('20:00') }); expect(deliver).not.toHaveBeenCalled();
  });
  it.each(['FAILED', 'UNCERTAIN'])('does not automatically resend a %s gateway result', async status => {
    const { db } = memoryDb(), deliver = vi.fn(async () => ({ status }));
    const first = await taskFieldReportReminder({ db, deliver, now: () => at('20:00') }); expect(first.error).toBeTruthy();
    await taskFieldReportReminder({ db, deliver, now: () => at('20:05') }); expect(deliver).toHaveBeenCalledTimes(2);
  });
  it('does not resend if the provider accepted but final audit failed', async () => {
    const { db } = memoryDb({ failFinish: true }), deliver = vi.fn(async () => ({ status: 'ACCEPTED' }));
    const first = await taskFieldReportReminder({ db, deliver, now: () => at('20:00') }); expect(first).toMatchObject({ sent: 0, uncertain: 2 });
    await taskFieldReportReminder({ db, deliver, now: () => at('20:05') }); expect(deliver).toHaveBeenCalledTimes(2);
  });
  it('uses a stable, valid daily UUID; a different day gets its own reminder', () => {
    expect(reportReminderSendId('2026-10-18', '628120000001')).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-a[\da-f]{3}-[\da-f]{12}$/);
    expect(reportReminderSendId('2026-10-18', '628120000001')).not.toBe(reportReminderSendId('2026-10-19', '628120000001'));
  });
});
