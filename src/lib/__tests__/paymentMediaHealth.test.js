import { afterEach, describe, expect, it, vi } from "vitest";
import { paymentMediaHealth, paymentWorkerRunSummary, readPaymentMediaHealth } from "../../../api/_payment-health.js";
import { paymentMediaState, paymentWorkerResult, paymentWorkerState } from "../paymentMediaHealth.js";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader: vi.fn() });
describe("payment health is private and read-only", () => {
  it.each(["Teknisi", "Helper", "Finance", "", undefined])("denies role %s", async role => {
    vi.stubEnv("SUPABASE_URL", "https://db.test"); vi.stubEnv("SUPABASE_SERVICE_KEY", "key");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const res = response();
    await paymentMediaHealth({ method: "GET", appClaims: { role }, headers: {} }, res);
    expect(res.code).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["Owner", "Admin"])("allows %s, never exposes queue source URLs or secrets", async role => {
    vi.stubEnv("SUPABASE_URL", "https://db.test"); vi.stubEnv("SUPABASE_SERVICE_KEY", "key");
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ waiting: 0, incidents: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ status: "SUCCESS", started_at: "2026-10-17T01:07:03Z", metadata: { checked: 0, retried: 0, error: "secret source URL", invoiceId: "private" } }] });
    vi.stubGlobal("fetch", fetch);
    const res = response(); await paymentMediaHealth({ method: "GET", appClaims: { role }, headers: {} }, res);
    expect(res.code).toBe(200); expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(fetch.mock.calls[0][0]).toContain("/rpc/get_payment_ingestion_health");
    expect(fetch.mock.calls[0][1].body).toBe("{}");
    expect(fetch.mock.calls[1][0]).toContain("/cron_runs?task_name=eq.payment-media-retry");
    expect(fetch.mock.calls[1][0]).toContain("limit=1");
    expect(fetch.mock.calls[1][1].method).toBeUndefined(); // GET only; no retry/task invocation.
    expect(res.body.last_run).toMatchObject({ status: "SUCCESS", checked: 0, retried: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|private|source_url|serviceKey/);
  });
  it("does not report healthy when the RPC is unavailable", async () => {
    vi.stubEnv("SUPABASE_URL", "https://db.test"); vi.stubEnv("SUPABASE_SERVICE_KEY", "key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const res = response(); await paymentMediaHealth({ method: "GET", appClaims: { role: "Owner" }, headers: {} }, res);
    expect(res.code).toBe(503); expect(res.body.error).toContain("migrasi 210");
  });
  it("rejects non-GET requests before reading anything", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const res = response();
    await paymentMediaHealth({ method: "POST", appClaims: { role: "Owner" } }, res);
    expect(res.code).toBe(405); expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps watchdog polling to the original single RPC", async () => {
    const health = { waiting: 0, incidents: [] };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => health });
    expect(await readPaymentMediaHealth({ supabaseUrl: "https://db.test", serviceKey: "key", fetchImpl })).toBe(health);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(["http", "network", "malformed", "invalid-run"])("retains counters and marks unavailable worker detail (%s)", async failure => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ waiting: 0, failed: 5, incidents: [] }) });
    if (failure === "network") fetchImpl.mockRejectedValueOnce(new Error("secret provider URL"));
    else fetchImpl.mockResolvedValueOnce({ ok: failure !== "http", json: async () => failure === "malformed" ? {} : [{ status: "INVALID", started_at: "bad" }] });
    const health = await readPaymentMediaHealth({ supabaseUrl: "https://db.test", serviceKey: "key", fetchImpl, includeWorkerRun: true });
    expect(health).toMatchObject({ waiting: 0, failed: 5, last_run: null, last_run_error: true });
    expect(JSON.stringify(health)).not.toContain("secret");
  });
  it("distinguishes an empty run history from a failed read", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ incidents: [] }) }).mockResolvedValueOnce({ ok: true, json: async () => [] });
    expect(await readPaymentMediaHealth({ supabaseUrl: "https://db.test", serviceKey: "key", fetchImpl, includeWorkerRun: true })).toMatchObject({ last_run: null, last_run_error: false });
  });
});
it("distinguishes durable review from missing original media", () => {
  expect(paymentMediaState({ status: "FAILED_PERMANENT" }).label).toContain("kirim ulang");
  expect(paymentMediaState({ status: "FAILED_RETRYABLE", r2_url: "proof" }).label).toContain("Media aman");
  expect(paymentMediaState({ status: "PENDING_REVIEW" }).label).toContain("bukan konfirmasi");
});
it("shows disabled detection and missing/stale workers explicitly", () => {
  expect(paymentWorkerState({ enabled: false }).label).toContain("dimatikan");
  expect(paymentWorkerState({ enabled: true }).level).toBe("error");
  expect(paymentWorkerState({ enabled: true, last_worker_at: new Date().toISOString(), overdue: 1 }).level).toBe("warning");
  expect(paymentWorkerState({ enabled: true, last_worker_at: new Date().toISOString(), overdue: 0 }).level).toBe("ok");
});

it.each(["invalid", "2026-10-17T02:00:00Z", "2026-10-16T22:00:00Z", null])("does not mark invalid, future or stale heartbeat healthy: %s", timestamp => {
  expect(paymentWorkerState({ enabled: true, last_worker_at: timestamp }, Date.parse("2026-10-17T01:00:00Z")).level).toBe("error");
});

it.each([
  ["RECEIVED", "retry"], ["STORED", "retry"], ["PROCESSING", "retry"], ["FAILED_RETRYABLE", "retry"],
  ["PENDING_REVIEW", "admin"], ["FAILED_PERMANENT", "failed"], ["DONE", "complete"], ["IGNORED", "complete"], ["NEW_UNKNOWN", "unknown"],
])("classifies %s separately as %s", (status, group) => {
  expect(paymentMediaState({ status }).group).toBe(group);
});

it("never implies historical terminal files with zero attempts exhausted three retries", () => {
  const state = paymentMediaState({ status: "FAILED_PERMANENT", attempts: 0 });
  expect(state.explanation).toContain("tidak masuk antrean retry");
  expect(JSON.stringify(state)).not.toMatch(/3\/3|tiga percobaan|3 percobaan/);
  expect(paymentMediaState({ status: "PENDING_REVIEW", r2_url: "proof" }).explanation).toContain("bukan antrean retry");
});

it("whitelists result counters, known reason and dates without leaking raw cron metadata", () => {
  expect(paymentWorkerRunSummary({ status: "FAILED", started_at: "2026-10-17T01:07:03Z", finished_at: "bad", metadata: {
    checked: 1, retried: 0, failed: 1, pendingReview: "1", suggestion: -1, ignored: NaN, alreadySettled: true,
    reason: "https://secret.invalid", error: "secret", invoiceId: "INV-private", source_url: "private", serviceKey: "private",
  } })).toEqual({ status: "FAILED", started_at: "2026-10-17T01:07:03.000Z", finished_at: null, checked: 1, retried: 0, failed: 1, alreadySettled: true });
});

describe("worker outcomes do not confuse an empty queue with a failed payment", () => {
  const now = Date.parse("2026-10-17T01:10:00Z");
  it.each([
    [{ status: "SUCCESS", checked: 0, retried: 0 }, "ok", "antrean retry kosong"],
    [{ status: "SUCCESS" }, "ok", "Pemeriksaan berhasil"],
    [{ status: "SUCCESS", checked: 1, retried: 0 }, "ok", "Pemeriksaan berhasil"],
    [{ status: "SUCCESS", suggestion: 1 }, "ok", "Bukti tersedia"],
    [{ status: "SUCCESS", ignored: 1 }, "ok", "diklasifikasi"],
    [{ status: "SUCCESS", alreadySettled: true }, "ok", "sudah diselesaikan"],
    [{ status: "SUCCESS", pendingReview: 1 }, "warning", "tinjauan admin"],
    [{ status: "SUCCESS", failed: 1 }, "warning", "belum berhasil"],
    [{ status: "FAILED", pendingReview: 1 }, "warning", "tinjauan admin"],
    [{ status: "FAILED", checked: 0, retried: 0 }, "error", "gagal"],
    [{ status: "TIMEOUT" }, "error", "batas waktu"],
    [{ status: "SKIPPED", reason: "wa_payment_detect_off" }, "warning", "dilewati"],
    [{ status: "RUNNING", started_at: "2026-10-17T01:09:00Z" }, "warning", "sedang berjalan"],
    [{ status: "RUNNING", started_at: "2026-10-17T01:00:00Z" }, "warning", "belum selesai"],
    [{ status: "RUNNING", started_at: "bad" }, "warning", "belum selesai"],
    [{ status: "INVALID" }, "warning", "belum dikenali"],
  ])("shows %j accurately", (run, level, label) => {
    const result = paymentWorkerResult({ last_run: run }, now);
    expect(result.level).toBe(level); expect(result.label).toContain(label);
  });
  it("does not invent an empty queue from a missing run or a missing counter", () => {
    for (const health of [{}, { last_run_error: true }, { last_run: { status: "SUCCESS", retried: 0 } }]) {
      expect(paymentWorkerResult(health).label).not.toContain("antrean retry kosong");
    }
  });
  it("does not count old failures or manual reviews as a failed latest run", () => {
    expect(paymentWorkerResult({ failed: 5, review: 76, incidents: Array(11), last_run: { status: "SUCCESS", checked: 0, retried: 0 } }).label).toContain("antrean retry kosong");
  });
});
