import { describe, expect, it } from "vitest";
import { closeStaleCronRuns, runWithCronLogging } from "../../../api/_logger.js";
import { pendingCronTasks } from '../../../api/_cron-result.js';

function fakeCronDb() {
  const updates = [];
  const makeQuery = () => {
    let isInsert = false;
    let wantsRows = false;
    const query = {
      update(payload) { updates.push(payload); return query; },
      insert() { isInsert = true; return query; },
      eq() { return query; },
      lt() { return query; },
      select() { wantsRows = true; return query; },
      single: async () => ({ data: { id: "run-1" }, error: null }),
      then(resolve) {
        resolve({ data: wantsRows ? [{ id: isInsert ? "run-1" : "stale-1" }] : null, error: null });
      },
    };
    return query;
  };
  return { db: { from: () => makeQuery() }, updates };
}

describe("cron logger hardening", () => {
  it('records partial cleanup as failed, preserving successful deletions and retry context', async () => {
    const { db, updates } = fakeCronDb();
    await expect(runWithCronLogging(db, 'cleanup', async () => ({ swept: 50, purged: 48, errors: 2, has_more: true })))
      .rejects.toThrow('2 pekerjaan gagal');
    expect(updates.at(-1)).toMatchObject({ status: 'FAILED', items_processed: 48, metadata: { errors: 2, has_more: true } });
  });
  it('rejects explicit task failure, counts SQL deletions, and preserves disabled tasks', async () => {
    const { db, updates } = fakeCronDb();
    await expect(runWithCronLogging(db, 'log-cleanup', async () => ({ error: 'permission denied' }))).rejects.toThrow('permission denied');
    await expect(runWithCronLogging(db, 'tick', async () => ({ ok: false }))).rejects.toThrow();
    await runWithCronLogging(db, 'log-cleanup', async () => ({ deleted: { cron_runs: 12, agent_logs: 8 }, has_more: false }));
    expect(updates.at(-1)).toMatchObject({ status: 'SUCCESS', items_processed: 20 });
    await runWithCronLogging(db, 'disabled', async () => ({ skipped: true }));
    expect(updates.at(-1).status).toBe('SKIPPED');
  });
  it('continues unfinished batches without starving new tasks or restarting completed batches', () => {
    const now = Date.now();
    const run = (task_name, status, metadata = {}, age = 1000) => ({ task_name, status, metadata, started_at: new Date(now - age).toISOString() });
    const due = ['r2', 'wa', 'log', 'off', 'busy', 'broken', 'completed'].map(t => ({ t, cleanup: true }));
    const runs = [run('r2', 'SUCCESS', { has_more: true }), run('log', 'SUCCESS'), run('off', 'SKIPPED'), run('busy', 'RUNNING'), run('broken', 'FAILED'), run('completed', 'SUCCESS', { has_more: true }, 10000), run('completed', 'SUCCESS', { has_more: false })];
    expect(pendingCronTasks(due, runs, now).map(t => t.t)).toEqual(['wa', 'broken', 'r2']);
    expect(pendingCronTasks([{ t: 'busy' }], [run('busy', 'RUNNING', {}, 21 * 60_000)], now)).toHaveLength(1);
    expect(pendingCronTasks([{ t: 'r2' }], runs, now)).toHaveLength(0);
  });
  it("marks a task timeout instead of leaving it RUNNING", async () => {
    const { db, updates } = fakeCronDb();
    await expect(runWithCronLogging(
      db,
      "slow-task",
      () => new Promise(resolve => setTimeout(() => resolve({}), 40)),
      { timeoutMs: 5 },
    )).rejects.toMatchObject({ code: "CRON_TIMEOUT" });
    expect(updates.some(update => update.status === "TIMEOUT" && update.finished_at)).toBe(true);
  });

  it("closes stale runs globally with a bounded cutoff", async () => {
    const { db, updates } = fakeCronDb();
    await expect(closeStaleCronRuns(db, 20 * 60 * 1000)).resolves.toBe(1);
    expect(updates[0]).toMatchObject({ status: "TIMEOUT" });
  });
});
