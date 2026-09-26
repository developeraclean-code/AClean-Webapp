import { describe, expect, it } from "vitest";
import { closeStaleCronRuns, runWithCronLogging } from "../../../api/_logger.js";

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
