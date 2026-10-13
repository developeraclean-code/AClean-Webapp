import { shiftDateStr } from './dateTime.js';

export function scheduleMinutes(value) {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value || '');
  if (!match || +match[1] > 23 || +match[2] > 59) return NaN;
  return +match[1] * 60 + +match[2];
}

// The order belongs to its start date. An end clock earlier than its start
// clock means the following calendar day; equal clocks are never a valid job.
export function scheduleEndDate(date, start, end) {
  const from = scheduleMinutes(start), to = scheduleMinutes(end);
  if (!date || !Number.isFinite(from + to) || from === to) return null;
  return to < from ? shiftDateStr(date, 1) : date;
}

// A shift that crosses midnight remains actionable on its end date.
export function scheduleTouchesDate(order, targetDate) {
  return !!order?.date && !!targetDate && (
    order.date === targetDate ||
    scheduleEndDate(order.date, order.time, order.time_end) === targetDate
  );
}

export function scheduleRange(date, start, end) {
  const from = scheduleMinutes(start), to = scheduleMinutes(end);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(from + to) || from === to) return null;
  const base = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(base)) return null;
  return { start: base + from * 60000, end: base + (to < from ? 1440 + to : to) * 60000 };
}

export function schedulesOverlap(a, b) {
  const left = scheduleRange(a.date, a.time, a.time_end);
  const right = scheduleRange(b.date, b.time, b.time_end);
  return !!left && !!right && left.start < right.end && left.end > right.start;
}
