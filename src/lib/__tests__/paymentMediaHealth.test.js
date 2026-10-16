import { afterEach, describe, expect, it, vi } from "vitest";
import { paymentMediaHealth } from "../../../api/_payment-health.js";
import { paymentMediaState, paymentWorkerState } from "../paymentMediaHealth.js";
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
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ waiting: 0, incidents: [] }) }); vi.stubGlobal("fetch", fetch);
    const res = response(); await paymentMediaHealth({ method: "GET", appClaims: { role }, headers: {} }, res);
    expect(res.code).toBe(200); expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(fetch.mock.calls[0][0]).toContain("/rpc/get_payment_ingestion_health");
    expect(fetch.mock.calls[0][1].body).toBe("{}");
  });
  it("does not report healthy when the RPC is unavailable", async () => {
    vi.stubEnv("SUPABASE_URL", "https://db.test"); vi.stubEnv("SUPABASE_SERVICE_KEY", "key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const res = response(); await paymentMediaHealth({ method: "GET", appClaims: { role: "Owner" }, headers: {} }, res);
    expect(res.code).toBe(503); expect(res.body.error).toContain("migrasi 210");
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
