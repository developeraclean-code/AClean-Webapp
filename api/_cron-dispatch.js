import { randomUUID } from 'node:crypto';
import { cronTaskBudget } from './_cron-result.js';

// Atomic across GitHub, Supabase and Vercel. Timeout retains the lease because
// an older non-cancellable task may still be finishing after Promise.race.
export async function withDispatcherLease(db, work) {
  const token = randomUUID();
  const claim = await db.rpc('claim_cron_worker_216', { p_name: 'dispatcher', p_token: token, p_seconds: 180 });
  if (claim.error) throw new Error('Lease dispatcher gagal; migrasi 216 diperlukan: ' + claim.error.message);
  if (claim.data !== true) return { skipped: true, reason: 'dispatcher_busy' };
  let release = true;
  try {
    const result = await work(); release = !result?.timedOut;
    return result;
  } catch (error) { release = error?.code !== 'CRON_TIMEOUT'; throw error; }
  finally {
    if (release) {
      const result = await db.rpc('release_cron_worker_216', { p_name: 'dispatcher', p_token: token });
      if (result.error) throw new Error('Lease dispatcher belum dapat dilepas: ' + result.error.message);
    }
  }
}

export async function runCronQueue(tasks, { startedAt, run, now = Date.now, cap = 3 } = {}) {
  const result = { ran: [], pending: 0, failures: [], items_processed: 0 };
  for (const [index, task] of tasks.entries()) {
    const budget = cronTaskBudget(startedAt, task.budgetMs || 6500, now());
    if (result.ran.length >= cap || !budget || budget < (task.minimumMs || 2500)) { result.pending++; continue; }
    try {
      const outcome = await run(task.t, task.fn, { timeoutMs: budget, requireAudit: true });
      result.ran.push(task.t);
      if ((task.cleanup || task.continuable || task.repeatable) && outcome?.has_more) result.pending++;
    } catch (error) {
      result.ran.push(task.t);
      result.failures.push({ task: task.t, error: error.message });
      if (error.code === 'CRON_TIMEOUT') {
        result.timedOut = task.t; result.pending += tasks.length - index; break;
      }
      result.pending++;
    }
  }
  result.ok = result.failures.length === 0;
  result.items_processed = result.ran.length;
  return result;
}
