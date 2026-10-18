import { fieldReportAssignedNames } from './fieldReportWorkflow.js';
import { normalizePhone } from './phone.js';
import { scheduleEndDate, scheduleMinutes } from './scheduleTime.js';

export const FIELD_REPORT_REMINDER_KEY = 'field_report_reminder_enabled';
const REPORTABLE = new Set(['CONFIRMED', 'DISPATCHED', 'ON_SITE', 'WORKING', 'IN_PROGRESS', 'CONTINUED', 'COMPLETED']);
const RECEIVED = new Set(['SUBMITTED', 'VERIFIED']);
const clean = value => String(value || '').replace(/[\r\n*`]/g, ' ').trim();

export function reportReminderClock(now = Date.now()) {
  const local = new Date(Number(now) + 7 * 3600_000).toISOString();
  return { date: local.slice(0, 10), minutes: Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)) };
}

export function missingDailyReports(orders, reports, now = Date.now()) {
  const clock = reportReminderClock(now);
  if (clock.minutes < 20 * 60) return [];
  const received = new Set(reports.filter(r => RECEIVED.has(r.status)).map(r => r.job_id));
  const returned = new Set(reports.filter(r => ['REVISION', 'REJECTED', 'DRAFT', 'PENDING'].includes(r.status)).map(r => r.job_id));
  return orders.filter(order => {
    const actionable = REPORTABLE.has(order.status) || order.status === 'REPORT_SUBMITTED' && returned.has(order.id);
    if (order.date !== clock.date || order.project_id || !actionable || received.has(order.id)) return false;
    // No false warning for a night job that has not ended, including overnight jobs.
    if (order.time_end) {
      const end = scheduleMinutes(order.time_end);
      if (!Number.isFinite(end) || scheduleEndDate(order.date, order.time, order.time_end) !== clock.date || end > clock.minutes) return false;
    } else if (scheduleMinutes(order.time) >= clock.minutes) return false;
    return true;
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function fieldReportReminderRecipients(orders, reports, profiles, now = Date.now()) {
  const missing = missingDailyReports(orders, reports, now), recipients = new Map(), issues = [];
  const active = profiles.filter(p => p.active === true && ['Teknisi', 'Helper'].includes(p.role));
  for (const order of missing) {
    const names = fieldReportAssignedNames(null, order);
    const selected = new Map();
    for (const id of [order.teknisi_id, order.helper_id].filter(Boolean)) {
      const profile = active.find(p => p.id === id);
      if (profile) selected.set(profile.id, profile);
    }
    for (const name of names) {
      const matches = active.filter(p => String(p.name || '').trim().toLowerCase() === name.toLowerCase());
      if (matches.length === 1) selected.set(matches[0].id, matches[0]);
      else if (!matches.length && profiles.some(p => p.active === false && String(p.name || '').trim().toLowerCase() === name.toLowerCase())) continue;
      else if (matches.length !== 1 && ![...selected.values()].some(p => String(p.name || '').trim().toLowerCase() === name.toLowerCase())) {
        issues.push({ job_id: order.id, reason: matches.length ? 'Nama personel ambigu' : 'Personel aktif tidak ditemukan' });
      }
    }
    for (const profile of selected.values()) {
      const phone = normalizePhone(profile.phone);
      if (!/^\d{8,15}$/.test(phone)) { issues.push({ job_id: order.id, reason: 'Nomor WA personel tidak valid' }); continue; }
      if (!recipients.has(phone)) recipients.set(phone, { phone, names: [], jobs: [] });
      const recipient = recipients.get(phone);
      if (!recipient.names.includes(profile.name)) recipient.names.push(profile.name);
      if (!recipient.jobs.some(job => job.id === order.id)) recipient.jobs.push(order);
    }
  }
  return { recipients: [...recipients.values()].sort((a, b) => a.phone.localeCompare(b.phone)), issues };
}

export function fieldReportReminderMessage(recipient, date) {
  const lines = recipient.jobs.slice(0, 15).map((job, i) => `${i + 1}. ${clean(job.customer).slice(0, 90)} · ${clean(job.id).slice(0, 100)}`);
  if (recipient.jobs.length > 15) lines.push(`Dan ${recipient.jobs.length - 15} pekerjaan lainnya; periksa Laporan Saya.`);
  const names = recipient.names.slice(0, 3).map(name => clean(name).slice(0, 40)).join(' / ') + (recipient.names.length > 3 ? ' dan tim' : '');
  return `📝 *PENGINGAT LAPORAN PEKERJAAN*\n${date} · setelah 20.00 WIB\n\nHalo ${names}, laporan untuk pekerjaan berikut belum diterima atau masih perlu diperbaiki:\n\n${lines.join('\n')}\n\nMohon kirim/perbaiki melalui menu *Laporan Saya*. Cukup satu anggota tim mengirim satu laporan per job. Bila sudah dikirim setelah pengingat ini dibuat, abaikan pesan ini.\n\nIni hanya pengingat; verifikasi laporan tetap dilakukan Admin/Owner melalui modul.\n- Auto Reply by ARA -`;
}
