import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAdaptivePolling } from "../adaptivePolling.js";
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
const make = options => startAdaptivePolling({ intervalMs: 100, maxIntervalMs: 800, timeoutMs: 1000, random: () => 0, ...options });
describe("adaptive polling", () => {
  it("waits for completion before scheduling and coalesces manual refreshes", async () => {
    let resolve;
    const load = vi.fn(() => new Promise(r => { resolve = r; })), onResult = vi.fn();
    const poll = make({ load, onResult });
    await vi.advanceTimersByTimeAsync(100);
    expect(poll.refresh()).toBe(poll.refresh());
    await vi.advanceTimersByTimeAsync(500); expect(load).toHaveBeenCalledTimes(1);
    resolve({ data: [] }); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(99); expect(load).toHaveBeenCalledTimes(1);
    poll.stop();
  });
  it("backs off failures and resets only on successful reads", async () => {
    const load = vi.fn().mockResolvedValueOnce({ error: { message: "offline" } }).mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data: [] });
    const onError = vi.fn(), onResult = vi.fn(), poll = make({ load, onError, onResult });
    await vi.advanceTimersByTimeAsync(100); expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(199); expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(400); expect(load).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(100); expect(load).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledTimes(2); expect(onResult).toHaveBeenCalledTimes(2); poll.stop();
  });
  it("does not read hidden/nonworking tabs, and resumes without an immediate storm", async () => {
    let visible = false;
    const load = vi.fn(async () => ({ data: [] })), poll = make({ load, canRun: () => visible });
    await vi.advanceTimersByTimeAsync(500); expect(load).not.toHaveBeenCalled();
    visible = true; await vi.advanceTimersByTimeAsync(100); expect(load).toHaveBeenCalledTimes(1); poll.stop();
  });
  it("aborts a stuck read and leaves last data untouched", async () => {
    let signal;
    const onError = vi.fn(), onResult = vi.fn();
    const poll = make({ load: s => { signal = s; return new Promise(() => {}); }, onError, onResult });
    await vi.advanceTimersByTimeAsync(1101);
    expect(signal.aborted).toBe(true); expect(onError).toHaveBeenCalledTimes(1); expect(onResult).not.toHaveBeenCalled(); poll.stop();
  });
  it("ignores late results after logout/stop and clears its timers", async () => {
    let resolve;
    const onResult = vi.fn(), poll = make({ load: () => new Promise(r => { resolve = r; }), onResult });
    await vi.advanceTimersByTimeAsync(100); poll.stop(); resolve({ data: ["private"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
