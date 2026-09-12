import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPerfMetrics, measureAsync, recordPerfMetric, resetPerfMetrics } from "../perfMetrics.js";

describe("perfMetrics", () => {
  beforeEach(() => resetPerfMetrics());

  it("records a bounded, inspectable metric", () => {
    recordPerfMetric("bootstrap.critical", 123.7, { rows: 10 });
    expect(getPerfMetrics()).toMatchObject([
      { name: "bootstrap.critical", durationMs: 124, rows: 10 },
    ]);
  });

  it("measures successful and failed async work", async () => {
    await expect(measureAsync("rpc.dashboard", async () => "ok")).resolves.toBe("ok");
    await expect(measureAsync("rpc.failed", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(getPerfMetrics().map(x => [x.name, x.outcome])).toEqual([
      ["rpc.dashboard", "ok"],
      ["rpc.failed", "error"],
    ]);
  });

  it("keeps only the latest 100 metrics", () => {
    vi.setSystemTime(new Date("2026-09-12T00:00:00Z"));
    for (let i = 0; i < 105; i++) recordPerfMetric(`m${i}`, i);
    expect(getPerfMetrics()).toHaveLength(100);
    expect(getPerfMetrics()[0].name).toBe("m5");
  });
});
