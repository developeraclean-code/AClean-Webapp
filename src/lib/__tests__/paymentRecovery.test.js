import { afterEach, describe, expect, it, vi } from "vitest";
import { paymentMediaRetry, paymentMediaRecover, paymentMediaManualUpload } from "../../../api/_payment-recovery.js";

const actor = { appClaims: { userId: "00000000-0000-4000-8000-000000000001" } };
const reply = value => new Response(JSON.stringify(value), { status: 200 });
const response = () => ({ setHeader: vi.fn(), status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("payment recovery endpoints", () => {
  it("denies a valid session without an active Owner/Admin profile", async () => {
    vi.stubEnv("SUPABASE_URL", "https://db.test"); vi.stubEnv("SUPABASE_SERVICE_KEY", "service");
    const network = vi.fn(async () => reply([{ role: "Finance", active: true }])); vi.stubGlobal("fetch", network);
    const res = response(); await paymentMediaRetry({ ...actor, method: "POST", body: { jobId: "00000000-0000-4000-8000-000000000002" } }, res);
    expect(res.code).toBe(403); expect(network).toHaveBeenCalledTimes(1);
  });
  it("requeues by UUID through a service-only RPC and returns no source URL", async () => {
    vi.stubEnv("SUPABASE_URL", "https://db.test"); vi.stubEnv("SUPABASE_SERVICE_KEY", "service");
    const network = vi.fn(async url => String(url).includes("user_profiles") ? reply([{ role: "Owner", active: true }])
      : String(url).includes("app_settings") ? reply([{ value: "true" }]) : reply({ queued: true }));
    vi.stubGlobal("fetch", network);
    const res = response(); await paymentMediaRetry({ ...actor, method: "POST", body: { jobId: "00000000-0000-4000-8000-000000000002" } }, res);
    expect(res.code).toBe(202); expect(res.body).toEqual({ queued: true, status: "FAILED_RETRYABLE" });
    expect(network.mock.calls[2][0]).toContain("requeue_failed_payment_media_237");
    expect(network.mock.calls[2][1].method).toBe("POST");
  });
  it("runs bounded recovery through the service-only RPC and returns counts without media URLs", async () => {
    vi.stubEnv("SUPABASE_URL", "https://db.test"); vi.stubEnv("SUPABASE_SERVICE_KEY", "service");
    const network = vi.fn(async url => String(url).includes("user_profiles") ? reply([{ role: "Owner", active: true }])
      : String(url).includes("app_settings") ? reply([{ value: "true" }])
        : reply({ queued: 3, eligible: 18, remaining: 15, cooldown_until: "2026-11-14T03:00:00Z", source_url: "private" }));
    vi.stubGlobal("fetch", network);
    const res = response(); await paymentMediaRecover({ ...actor, method: "POST" }, res);
    expect(res.code).toBe(202);
    expect(res.body).toEqual({ queued: 3, eligible: 18, remaining: 15, cooldown_until: "2026-11-14T03:00:00Z" });
    expect(network.mock.calls[2][0]).toContain("requeue_failed_payment_media_batch_243");
  });
  it("rejects recovery for a non-admin before calling the batch RPC", async () => {
    vi.stubEnv("SUPABASE_URL", "https://db.test"); vi.stubEnv("SUPABASE_SERVICE_KEY", "service");
    const network = vi.fn(async () => reply([{ role: "Finance", active: true }])); vi.stubGlobal("fetch", network);
    const res = response(); await paymentMediaRecover({ ...actor, method: "POST" }, res);
    expect(res.code).toBe(403); expect(network).toHaveBeenCalledTimes(1);
  });
  it("refuses a forged key before reading the invoice or R2", async () => {
    vi.stubEnv("SUPABASE_URL", "https://db.test"); vi.stubEnv("SUPABASE_SERVICE_KEY", "service");
    const network = vi.fn(async url => String(url).includes("user_profiles") ? reply([{ role: "Admin", active: true }]) : reply([{ value: "true" }])); vi.stubGlobal("fetch", network);
    const res = response(); await paymentMediaManualUpload({ ...actor, method: "POST", body: { invoiceId: "INV-1", r2Key: "wa-staging/other.jpg" } }, res);
    expect(res.code).toBe(400); expect(network).toHaveBeenCalledTimes(2);
  });
  it("queues a verified R2 upload for AI without fetching WhaCenter or changing an invoice", async () => {
    for (const [name, value] of Object.entries({ SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_KEY: "service",
      R2_ACCESS_KEY: "access", R2_SECRET_KEY: "secret", R2_ACCOUNT_ID: "account" })) vi.stubEnv(name, value);
    const network = vi.fn(async (url, options) => {
      const value = String(url);
      if (value.includes("user_profiles")) return reply([{ role: "Owner", active: true }]);
      if (value.includes("app_settings")) return reply([{ value: "true" }]);
      if (value.includes("/invoices?")) return reply([{ id: "INV-1", phone: "628000000001", status: "UNPAID", payment_proof_url: null }]);
      if (value.includes("r2.cloudflarestorage.com")) return new Response(new Uint8Array([0xff,0xd8,0xff,0xe0,0x00]));
      if (value.includes("wa_payment_media_jobs?on_conflict")) return reply([{ id: "00000000-0000-4000-8000-000000000003" }]);
      throw new Error("Unexpected request: " + value);
    });
    vi.stubGlobal("fetch", network);
    const res = response(); await paymentMediaManualUpload({ ...actor, method: "POST", body: {
      invoiceId: "INV-1", r2Key: "laporan/bukti-INV-1/123_proof_INV-1_123.jpg",
    } }, res);
    expect(res.code).toBe(202);
    expect(res.body).toMatchObject({ queued: true, duplicate: false, proofUrl: "/api/foto?key=laporan%2Fbukti-INV-1%2F123_proof_INV-1_123.jpg" });
    expect(network.mock.calls.every(([url]) => !String(url).includes("whacenter"))).toBe(true);
    const insert = network.mock.calls.find(([url]) => String(url).includes("on_conflict"));
    expect(JSON.parse(insert[1].body)).toMatchObject({ provider: "manual", status: "STORED", invoice_id: "INV-1" });
    expect(network.mock.calls.some(([url]) => /invoice_payments|apply_wa_payment/.test(String(url)))).toBe(false);
  });
});
