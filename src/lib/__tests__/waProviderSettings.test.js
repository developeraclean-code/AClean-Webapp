import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setWaProvider } from "../../../api/_handlers/auth-token.js";

const response = () => ({
  setHeader: vi.fn(),
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://db.example.test");
  vi.stubEnv("SUPABASE_SERVICE_KEY", "service-test-key");
  vi.stubEnv("WHACENTER_DEVICE_ID", "device-test-id");
  vi.stubEnv("WHACENTER_WEBHOOK_SECRET", "webhook-test-secret");
  vi.stubGlobal("fetch", vi.fn(async url => {
    if (String(url).includes("statusDevice")) return new Response(JSON.stringify({ status: true, data: { status: "CONNECTED" } }), { status: 200 });
    return new Response(null, { status: 201 });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Owner WhatsApp provider setting", () => {
  it("saves WhaCenter only after a successful connection check", async () => {
    const res = response();
    await setWaProvider({ method: "POST", appClaims: { role: "Owner" }, body: { provider: "whacenter" } }, res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ provider: "whacenter", provider_saved: true, success: true });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ key: "wa_provider", value: "whacenter" });
    expect(JSON.stringify(res.body)).not.toContain("webhook-test-secret");
  });

  it("does not write the setting when connectivity fails", async () => {
    fetch.mockImplementation(async () => new Response(JSON.stringify({ status: false, data: { status: "DISCONNECTED" } }), { status: 200 }));
    const res = response();
    await setWaProvider({ method: "POST", appClaims: { role: "Owner" }, body: { provider: "whacenter" } }, res);
    expect(res.code).toBe(409);
    expect(res.body.provider_saved).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects non-Owners before probing or writing", async () => {
    const res = response();
    await setWaProvider({ method: "POST", appClaims: { role: "Admin" }, body: { provider: "whacenter" } }, res);
    expect(res.code).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires the independent webhook secret before switching", async () => {
    vi.stubEnv("WHACENTER_WEBHOOK_SECRET", "");
    const res = response();
    await setWaProvider({ method: "POST", appClaims: { role: "Owner" }, body: { provider: "whacenter" } }, res);
    expect(res.code).toBe(409);
    expect(res.body.provider_saved).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
