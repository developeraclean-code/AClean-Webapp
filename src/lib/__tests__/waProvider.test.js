import { afterEach, describe, expect, it, vi } from "vitest";
import { clearWaProviderCache, readSelectedWaProvider, sendWithConfiguredWaProvider, testWaProvider } from "../../../api/_wa-provider.js";

const env = {
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_SERVICE_KEY: "service-test-key",
  FONNTE_TOKEN: "fonnte-test-token",
  WHACENTER_DEVICE_ID: "device-test-id",
  WHACENTER_WEBHOOK_SECRET: "webhook-test-secret",
};

afterEach(() => clearWaProviderCache());

describe("WhatsApp provider selection and delivery", () => {
  it("reads the global provider from app_settings and rejects unknown values", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ value: "whacenter" }]), { status: 200 }));
    await expect(readSelectedWaProvider({ fetchImpl, env, cacheMs: 0 })).resolves.toBe("whacenter");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("app_settings?key=eq.wa_provider&select=value");

    clearWaProviderCache();
    const invalidFetch = vi.fn(async () => new Response(JSON.stringify([{ value: "unknown" }]), { status: 200 }));
    await expect(readSelectedWaProvider({ fetchImpl: invalidFetch, env, cacheMs: 0 })).rejects.toThrow("tidak dikenal");
  });

  it("keeps Fonnte endpoint, authorization and JSON payload intact", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: true }), { status: 200 }));
    const payload = { target: "628123456789", message: "invoice", url: "https://files.example.test/invoice.pdf" };
    await sendWithConfiguredWaProvider({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, { provider: "fonnte", fetchImpl, env });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.fonnte.com/send");
    expect(fetchImpl.mock.calls[0][1].headers.get("Authorization")).toBe("fonnte-test-token");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(payload);
  });

  it("sends WhaCenter text once using its own device and payload fields", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: true, id: "wha-1" }), { status: 200 }));
    const response = await sendWithConfiguredWaProvider({ method: "POST", body: JSON.stringify({ target: "628123456789", message: "halo" }) }, { provider: "whacenter", fetchImpl, env });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://app.whacenter.com/api/send");
    const sent = fetchImpl.mock.calls[0][1].body;
    expect(sent.get("device_id")).toBe("device-test-id");
    expect(sent.get("number")).toBe("628123456789");
    expect(sent.get("message")).toBe("halo");
    expect((await response.json())).toMatchObject({ status: true, id: "wha-1" });
  });

  it("maps WhaCenter group IDs and does not fall back to Fonnte", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes("wa_monitored_groups")) return new Response(JSON.stringify([{ group_name: "Tim Lapangan" }]), { status: 200 });
      return new Response(JSON.stringify({ status: true }), { status: 200 });
    });
    const response = await sendWithConfiguredWaProvider({ method: "POST", body: JSON.stringify({ target: "12012345-67890@g.us", message: "laporan" }) }, { provider: "whacenter", fetchImpl, env });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1][0])).toBe("https://app.whacenter.com/api/sendGroup");
    expect(fetchImpl.mock.calls[1][1].body.get("group")).toBe("Tim Lapangan");
    expect((await response.json()).status).toBe(true);
  });

  it("does not try Fonnte after a WhaCenter timeout or rejection", async () => {
    const timeoutFetch = vi.fn(async () => { throw new Error("synthetic timeout"); });
    await expect(sendWithConfiguredWaProvider({ method: "POST", body: JSON.stringify({ target: "628123456789", message: "halo" }) }, { provider: "whacenter", fetchImpl: timeoutFetch, env })).rejects.toThrow("synthetic timeout");
    expect(timeoutFetch).toHaveBeenCalledTimes(1);
    expect(String(timeoutFetch.mock.calls[0][0])).toContain("app.whacenter.com/api/send");

    const rejectionFetch = vi.fn(async () => new Response(JSON.stringify({ status: false, message: "offline" }), { status: 503 }));
    const response = await sendWithConfiguredWaProvider({ method: "POST", body: JSON.stringify({ target: "628123456789", message: "halo" }) }, { provider: "whacenter", fetchImpl: rejectionFetch, env });
    expect(response.status).toBe(503);
    expect((await response.json()).status).toBe(false);
    expect(rejectionFetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when WhaCenter is not connected or its credentials are missing", async () => {
    const missing = await sendWithConfiguredWaProvider({ method: "POST", body: JSON.stringify({ target: "628123456789", message: "x" }) }, { provider: "whacenter", env: { ...env, WHACENTER_DEVICE_ID: "" }, fetchImpl: vi.fn() });
    expect(missing.status).toBe(503);
    const failedFetch = vi.fn(async () => new Response(JSON.stringify({ status: false, message: "offline" }), { status: 200 }));
    await expect(testWaProvider("whacenter", { fetchImpl: failedFetch, env })).resolves.toMatchObject({ ok: false, success: false });
  });
});
