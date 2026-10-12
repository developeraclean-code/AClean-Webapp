import { describe, it, expect } from 'vitest';
import { scheduleEndDate, scheduleRange, schedulesOverlap } from '../scheduleTime.js';

describe('jadwal malam lintas tanggal', () => {
  const night = { date: '2026-10-12', time: '23:00', time_end: '04:00' };
  it('menandai tanggal selesai esok dan durasi lima jam', () => {
    expect(scheduleEndDate(night.date, night.time, night.time_end)).toBe('2026-10-13');
    const range = scheduleRange(night.date, night.time, night.time_end);
    expect(range.end - range.start).toBe(5 * 3600000);
  });
  it('mendeteksi bentrok sesudah tengah malam, tetapi bukan sesudah 04:00', () => {
    expect(schedulesOverlap(night, { date: '2026-10-13', time: '01:00', time_end: '02:00' })).toBe(true);
    expect(schedulesOverlap(night, { date: '2026-10-13', time: '04:00', time_end: '05:00' })).toBe(false);
    expect(schedulesOverlap(night, { date: '2026-10-12', time: '18:00', time_end: '23:00' })).toBe(false);
  });
  it('menolak jam sama dan waktu tak valid', () => {
    expect(scheduleRange('2026-10-12', '23:00', '23:00')).toBeNull();
    expect(scheduleRange('2026-10-12', '25:00', '04:00')).toBeNull();
  });
});
