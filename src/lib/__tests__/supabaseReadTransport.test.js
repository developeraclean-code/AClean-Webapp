import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseReadTransport } from "../supabaseReadTransport.js";

const baseUrl = "https://database.test";
const url = baseUrl + "/rest/v1/orders?select=id";
const response = (status = 200) => new Response(JSON.stringify(status === 200 ? [{ id: "SIM-JOB" }] : { message: "temporarily unavailable" }), { status });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Supabase REST read backpressure", () => {
  it("serves 200 synthetic job reads with at most three concurrent requests and no lost IDs", async () => {
    let active = 0, peak = 0;
    const fetchImpl = vi.fn(async input => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return new Response(JSON.stringify({ id: new URL(input).searchParams.get("id") }));
    });
    const gate = createSupabaseReadTransport({ baseUrl, fetchImpl });
    const work = Promise.all(Array.from({ length: 200 }, (_, i) => gate.fetch(url + `&id=SIM-${i}`).then(r => r.json())));
    await vi.advanceTimersByTimeAsync(1000);
    const results = await work;
    expect(peak).toBe(3); expect(fetchImpl).toHaveBeenCalledTimes(200);
    expect(new Set(results.map(r => r.id)).size).toBe(200);
    expect(gate.getStats()).toMatchObject({ active: 0, queued: 0, state: "healthy" });
  });

  it("opens after three server failures and rejects queued/extra reads without hitting the server", async () => {
    const fetchImpl = vi.fn(async () => response(503));
    const gate = createSupabaseReadTransport({ baseUrl, fetchImpl });
    const results = await Promise.all(Array.from({ length: 200 }, () => gate.fetch(url)));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(results.filter(r => r.status === 503)).toHaveLength(3);
    expect(results.filter(r => r.status === 429)).toHaveLength(197);
    expect(gate.getSnapshot().state).toBe("paused");
    await gate.fetch(url); expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("lets only one recovery probe through, then resumes the bounded queue", async () => {
    const probe = deferred();
    const fetchImpl = vi.fn(async () => response(503));
    const gate = createSupabaseReadTransport({ baseUrl, fetchImpl });
    await Promise.all([gate.fetch(url), gate.fetch(url), gate.fetch(url)]);
    await vi.advanceTimersByTimeAsync(15_000);
    fetchImpl.mockImplementationOnce(() => probe.promise).mockImplementation(async () => response());
    const requests = Array.from({ length: 20 }, () => gate.fetch(url));
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(gate.getSnapshot().state).toBe("checking");
    probe.resolve(response());
    expect((await Promise.all(requests)).every(r => r.ok)).toBe(true);
    expect(gate.getSnapshot().state).toBe("healthy");
  });

  it("backs off failed probes progressively and caps the delay", async () => {
    const fetchImpl = vi.fn(async () => response(503));
    const gate = createSupabaseReadTransport({ baseUrl, fetchImpl });
    await Promise.all([gate.fetch(url), gate.fetch(url), gate.fetch(url)]);
    for (const delay of [15_000, 30_000, 60_000, 120_000, 120_000]) {
      expect(gate.getSnapshot().retryAt - Date.now()).toBe(delay);
      await vi.advanceTimersByTimeAsync(delay);
      await gate.fetch(url);
    }
  });

  it("never closes an open circuit from a late successful pre-outage response", async () => {
    const late = deferred(); let calls = 0;
    const gate = createSupabaseReadTransport({ baseUrl, failureThreshold: 2,
      fetchImpl: async () => ++calls === 1 ? late.promise : response(503) });
    const a = gate.fetch(url); await Promise.all([gate.fetch(url), gate.fetch(url)]);
    late.resolve(response()); await a;
    expect(gate.getSnapshot().state).toBe("paused");
  });

  it("bypasses all writes, RPC POST, Auth and other origins without retry or header/body changes", async () => {
    const fetchImpl = vi.fn(async () => response(503));
    const gate = createSupabaseReadTransport({ baseUrl, fetchImpl });
    await Promise.all([gate.fetch(url), gate.fetch(url), gate.fetch(url)]);
    fetchImpl.mockClear();
    const cases = [
      [url, { method: "POST", body: '{"amount":100}', headers: { Authorization: "Bearer SIMULATED" } }],
      [url, { method: "PATCH", body: '{"status":"PAID"}' }],
      [url, { method: "DELETE" }],
      [baseUrl + "/rest/v1/rpc/record_payment", { method: "POST", body: "{}" }],
      [baseUrl + "/auth/v1/token", { method: "POST", body: "{}" }],
      ["https://other.test/rest/v1/orders", {}],
    ];
    for (const [input, init] of cases) {
      await gate.fetch(input, init);
      expect(fetchImpl).toHaveBeenLastCalledWith(input, init);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(cases.length);
  });

  it("returns a structured timeout even when fetch ignores cancellation", async () => {
    const gate = createSupabaseReadTransport({ baseUrl, fetchImpl: () => new Promise(() => {}) });
    const request = gate.fetch(url);
    await vi.advanceTimersByTimeAsync(20_001);
    const result = await request;
    expect(result.status).toBe(504); expect((await result.json()).code).toBe("APP_READ_TIMEOUT");
    expect(gate.getStats().active).toBe(0);
  });

  it("cancels queued reads without sending them or blaming the server", async () => {
    const running = deferred(), fetchImpl = vi.fn(() => running.promise);
    const gate = createSupabaseReadTransport({ baseUrl, fetchImpl, concurrency: 1 });
    const first = gate.fetch(url), controller = new AbortController();
    const queued = gate.fetch(url, { signal: controller.signal });
    const rejected = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected;
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(gate.getStats().failures).toBe(0);
    running.resolve(response()); await first;
  });

  it("cancels an active read without adding an outage failure", async () => {
    const gate = createSupabaseReadTransport({ baseUrl, fetchImpl: () => new Promise(() => {}) });
    const controller = new AbortController(), request = gate.fetch(url, { signal: controller.signal });
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected;
    expect(gate.getStats()).toMatchObject({ active: 0, failures: 0, state: "healthy" });
  });

  it("does not treat permission or validation errors as a database outage", async () => {
    const fetchImpl = vi.fn(async () => response(403));
    const gate = createSupabaseReadTransport({ baseUrl, fetchImpl });
    await Promise.all(Array.from({ length: 20 }, () => gate.fetch(url)));
    expect(fetchImpl).toHaveBeenCalledTimes(20); expect(gate.getStats().failures).toBe(0);
  });

  it("bounds queue size and waiting time", async () => {
    const running = deferred();
    const gate = createSupabaseReadTransport({ baseUrl, fetchImpl: () => running.promise, concurrency: 1, maxQueued: 1, queueTimeoutMs: 100 });
    const first = gate.fetch(url), second = gate.fetch(url), third = await gate.fetch(url);
    expect((await third.json()).code).toBe("APP_READ_QUEUE_FULL");
    await vi.advanceTimersByTimeAsync(101);
    expect((await (await second).json()).code).toBe("APP_READ_QUEUE_TIMEOUT");
    running.resolve(response()); await first;
  });

  it("recovers actual supabase-js GETs without SDK retries multiplying network errors", async () => {
    vi.useRealTimers();
    const { createClient } = await import("@supabase/supabase-js");
    const fetchImpl = vi.fn(async () => { throw new TypeError("offline"); });
    const gate = createSupabaseReadTransport({ baseUrl, fetchImpl });
    const db = createClient(baseUrl, "SIMULATED_ANON_KEY", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: gate.fetch } });
    const result = await db.from("orders").select("id");
    expect(result.error.code).toBe("APP_READ_NETWORK");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps actual SDK retries of upstream 503 inside the same circuit", async () => {
    vi.useRealTimers();
    const { createClient } = await import("@supabase/supabase-js");
    const fetchImpl = vi.fn(async () => response(503));
    const gate = createSupabaseReadTransport({ baseUrl, fetchImpl });
    const db = createClient(baseUrl, "SIMULATED_ANON_KEY", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: gate.fetch } });
    await db.auth.getSession();
    vi.useFakeTimers();
    const pending = db.from("orders").select("id").then(value => value);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.error.code).toBe("APP_READ_PAUSED"); expect(result.status).toBe(429);
    expect(gate.getSnapshot().state).toBe("paused");
  });
});
