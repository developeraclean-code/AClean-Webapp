import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedFetch, invalidateCache, setFetchCacheScope } from "../fetchCache.js";
beforeEach(() => { vi.useFakeTimers(); invalidateCache(); setFetchCacheScope("SIMULATED-A"); });
afterEach(() => vi.useRealTimers());
describe("fetch cache", () => {
  it("coalesces 200 simultaneous consumers into one read", async () => {
    const fetcher = vi.fn(async () => ({ data: Array.from({ length: 200 }, (_, i) => ({ id: i })), error: null }));
    const rows = await Promise.all(Array.from({ length: 200 }, () => cachedFetch("orders", fetcher)));
    expect(fetcher).toHaveBeenCalledTimes(1); expect(rows.every(r => r.data.length === 200)).toBe(true);
  });
  it("expires a successful cached read after a minute", async () => {
    const fetcher = vi.fn(async () => ({ data: [] }));
    await cachedFetch("orders", fetcher); await cachedFetch("orders", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001); await cachedFetch("orders", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("never caches returned or thrown errors", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ error: { message: "timeout" } }).mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data: [] });
    await cachedFetch("orders", fetcher); await expect(cachedFetch("orders", fetcher)).rejects.toThrow("offline");
    await cachedFetch("orders", fetcher); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not let an invalidated in-flight read overwrite fresh data", async () => {
    let resolve;
    const old = cachedFetch("orders", () => new Promise(r => { resolve = r; })); await Promise.resolve();
    invalidateCache("orders");
    await cachedFetch("orders", async () => ({ data: ["fresh"] }));
    resolve({ data: ["old"] }); await old;
    expect(await cachedFetch("orders", () => { throw new Error("should be cached"); })).toEqual({ data: ["fresh"] });
  });
  it("isolates late cache completion across account changes", async () => {
    let resolve;
    const old = cachedFetch("orders", () => new Promise(r => { resolve = r; })); await Promise.resolve();
    setFetchCacheScope("SIMULATED-B"); resolve({ data: ["private-A"] }); await old;
    expect(await cachedFetch("orders", async () => ({ data: ["private-B"] }))).toEqual({ data: ["private-B"] });
  });
  it("invalidates the bootstrap projection when its entity is changed", async () => {
    await cachedFetch("orders_bootstrap", async () => ({ data: ["old"] }));
    invalidateCache("orders");
    expect(await cachedFetch("orders_bootstrap", async () => ({ data: ["new"] }))).toEqual({ data: ["new"] });
  });
});
