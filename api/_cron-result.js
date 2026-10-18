// Result contract shared by logging and bounded cleanup continuations.
// Leave room for database logging, the outer result and the HTTP response.
export function cronTaskBudget(startedAt, requestedMs, now = Date.now()) {
  const available = 32_000 - (now - startedAt) - 5_000;
  return available >= 2_500 ? Math.min(requestedMs, available) : 0;
}

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
  if (Number.isFinite(result.retried)) return result.retried;
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
  const relevant = runs.filter(run => {
    const task = due.find(t => t.t === run.task_name);
    return task && (!task.dueSince || new Date(run.started_at).getTime() >= task.dueSince);
  });
  for (const run of relevant) {
    if (!latest.has(run.task_name) || new Date(run.started_at) > new Date(latest.get(run.task_name).started_at)) latest.set(run.task_name, run);
  }
  return due.filter(task => {
    if (!task.cleanup && !task.continuable && !task.repeatable && relevant.some(r => r.task_name === task.t && ['SUCCESS', 'SKIPPED'].includes(r.status))) return false;
    const run = latest.get(task.t);
    if (!run) return true;
    if (run.status === 'RUNNING' && new Date(run.started_at).getTime() > now - 20 * 60_000) return false;
    if (run.status === 'SKIPPED') return task.repeatable === true;
    if (run.status === 'SUCCESS') return task.repeatable === true || (task.cleanup === true || task.continuable === true) && run.metadata?.has_more === true;
    if (['FAILED', 'TIMEOUT'].includes(run.status) && new Date(run.started_at).getTime() > now - 5 * 60_000) return false;
    return true;
  }).sort((a, b) => {
    // A completed batch must not starve tasks that have not run yet.
    const rank = t => !latest.has(t.t) ? 0 : ['FAILED', 'TIMEOUT'].includes(latest.get(t.t).status) ? 2 : 1;
    return rank(a) - rank(b) || (a.priority ?? 10) - (b.priority ?? 10)
      || new Date(latest.get(a.t)?.started_at || 0) - new Date(latest.get(b.t)?.started_at || 0);
  });
}

export function dueCronTasks(schedule, now = Date.now(), cleanupOnly = false) {
  const wib = new Date(now + 7 * 3600_000), hour = wib.getUTCHours();
  const midnight = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()) - 7 * 3600_000;
  return schedule.flatMap(task => {
    if (cleanupOnly && !task.cleanup) return [];
    if (task.catchUpWeekly && task.dow !== undefined) {
      let days = (wib.getUTCDay() - task.dow + 7) % 7;
      if (!days && hour < task.h) days = 7;
      return [{ ...task, dueSince: midnight - days * 86400_000 + task.h * 3600_000 }];
    }
    if (hour < task.h || task.dow !== undefined && task.dow !== wib.getUTCDay()
      || task.dom !== undefined && task.dom !== wib.getUTCDate()) return [];
    return [{ ...task, dueSince: midnight }];
  });
}
