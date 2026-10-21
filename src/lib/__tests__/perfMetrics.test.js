import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPerfMetrics, getPerfMetrics, measureAsync, recordPerfMetric, resetPerfMetrics } from "../perfMetrics.js";

describe("perfMetrics", () => {
  beforeEach(() => resetPerfMetrics());
  it('marks a resolved Supabase error as failure, without changing the result contract',async()=>{
    const result={data:null,error:{code:'57014'}};
    expect(await measureAsync('dashboard.timeout',async()=>result)).toBe(result);
    expect(getPerfMetrics().at(-1).outcome).toBe('error');
  });
  it('coalesces simultaneous metric writes into one request',async()=>{
    recordPerfMetric('dashboard.summary',100);let resolve;
    const rpc=vi.fn(()=>new Promise(r=>{resolve=r;}));
    const calls=Array.from({length:30},()=>flushPerfMetrics({rpc},'Owner',{force:true}));
    await Promise.resolve();
    expect(rpc).toHaveBeenCalledTimes(1);resolve({data:1,error:null});await Promise.all(calls);
  });
  it('continues flushing beyond the rolling 100-metric buffer, without dropping a >20 batch',async()=>{
    const rpc=vi.fn(async()=>({data:20,error:null}));
    for(let i=0;i<25;i++)recordPerfMetric('dashboard.metric',1);
    await flushPerfMetrics({rpc},'Owner',{force:true});await flushPerfMetrics({rpc},'Owner',{force:true});
    expect(rpc.mock.calls[0][1].p_metrics).toHaveLength(20);expect(rpc.mock.calls[1][1].p_metrics).toHaveLength(5);
    for(let i=0;i<110;i++)recordPerfMetric('dashboard.metric',2);
    await flushPerfMetrics({rpc},'Owner',{force:true});expect(rpc).toHaveBeenCalledTimes(3);
  });
  it('backs off failed metric writes instead of adding load on every widget completion',async()=>{
    recordPerfMetric('dashboard.metric',1);const rpc=vi.fn(async()=>({error:{code:'503'}}));
    await flushPerfMetrics({rpc},'Owner',{force:true});
    for(let i=0;i<10;i++)await flushPerfMetrics({rpc},'Owner',{force:true});
    expect(rpc).toHaveBeenCalledTimes(1);
  });

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

  it("flushes a bounded aggregate batch through RPC", async () => {
    recordPerfMetric("bootstrap.critical", 900, { outcome: "ok", rows: 20 });
    recordPerfMetric("unrelated.metric", 10, { outcome: "ok" });
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    const result = await flushPerfMetrics({ rpc }, "Owner", { force: true });
    expect(result.recorded).toBe(1);
    expect(rpc).toHaveBeenCalledWith("record_performance_metrics", {
      p_metrics: [
        { name: "bootstrap.critical", durationMs: 900, outcome: "ok" },
      ],
      p_role: "Owner",
    });
  });

  it("does not resend a successful batch and keeps later metrics", async () => {
    recordPerfMetric("bootstrap.critical", 900);
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    await flushPerfMetrics({ rpc }, "Owner", { force: true });
    recordPerfMetric("dashboard.snapshot_v2", 350);
    await flushPerfMetrics({ rpc }, "Owner", { force: true });
    expect(rpc).toHaveBeenNthCalledWith(2, "record_performance_metrics", {
      p_metrics: [{ name: "dashboard.snapshot_v2", durationMs: 350, outcome: "ok" }],
      p_role: "Owner",
    });
  });
});
