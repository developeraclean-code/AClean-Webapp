// Result contract shared by logging and bounded cleanup continuations.
export function cronResultError(result) {
  if (!result || result.skipped === true) return null;
  if (result.error || result.ok === false || Number(result.errors) > 0) {
    return String(result.error || result.failures?.map(f => `${f.task}: ${f.error}`).join('; ') || `${Number(result.errors) || 1} pekerjaan gagal`);
  }
  return null;
}

export function cronItemsProcessed(result) {
  if (!result || result.skipped) return 0;
  if (Number.isFinite(result.items_processed)) return result.items_processed;
  if (Number.isFinite(result.purged)) return result.purged;
  if (result.deleted && typeof result.deleted === 'object' && !Array.isArray(result.deleted)) {
    return Object.values(result.deleted).reduce((n, v) => n + (Number(v) || 0), 0);
  }
  if (Number.isFinite(result.deleted)) return result.deleted;
  return ['msgsDeleted', 'convsDeleted', 'dispatch_logs', 'payment_suggestions']
    .reduce((n, key) => n + (Number(result[key]) || 0), 0);
}

export function pendingCronTasks(due, runs, now = Date.now()) {
  const latest = new Map();
  for (const run of runs) {
    if (!latest.has(run.task_name) || new Date(run.started_at) > new Date(latest.get(run.task_name).started_at)) latest.set(run.task_name, run);
  }
  return due.filter(task => {
    if (!task.cleanup && runs.some(r => r.task_name === task.t && ['SUCCESS', 'SKIPPED'].includes(r.status))) return false;
    const run = latest.get(task.t);
    if (!run) return true;
    if (run.status === 'RUNNING' && new Date(run.started_at).getTime() > now - 20 * 60_000) return false;
    if (run.status === 'SKIPPED') return false;
    if (run.status === 'SUCCESS') return task.cleanup === true && run.metadata?.has_more === true;
    return true;
  }).sort((a, b) => {
    // A completed batch must not starve tasks that have not run yet.
    const rank = t => latest.get(t.t)?.metadata?.has_more === true ? 1 : 0;
    return rank(a) - rank(b);
  });
}
