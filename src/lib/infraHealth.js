// Shared by the API and UI: legacy/stale/incomplete quota snapshots are not green.
export function normalizeInfraSnapshot(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const age = now - Date.parse(raw.measured_at);
  const stale = !Number.isFinite(age) || age > 36 * 3600_000 || age < -5 * 60_000;
  const db = raw.supabase_database || {}, r2 = raw.r2_storage || {};
  const incomplete = stale || db.error || r2.error || r2.scanning || !valid(db.percent) || !valid(r2.percent);
  const warn = Number(raw.warn_percent) || 70, critical = Math.max(warn, Number(raw.critical_percent) || 85);
  const values = [db.percent, r2.percent].filter(valid);
  const level = values.some(n => n >= critical) ? 'critical' : values.some(n => n >= warn) ? 'warning' : incomplete ? 'unknown' : 'ok';
  return { ...raw, level, stale, incomplete: !!incomplete };
}
