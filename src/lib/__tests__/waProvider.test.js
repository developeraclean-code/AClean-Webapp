import { afterEach, describe, expect, it, vi } from "vitest";
import { clearWaProviderCache, readSelectedWaProvider, sendWithConfiguredWaProvider, testWaProvider } from "../../../api/_wa-provider.js";

const env = {
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_SERVICE_KEY: "service-test-key",
  FONNTE_TOKEN: "fonnte-test-token",
  WHACENTER_DEVICE_ID: "device-test-id",
  WHACENTER_WEBHOOK_SECRET: "webhook-test-secret",
  WABLAS_TOKEN: "wablas-test-token",
  WABLAS_SECRET_KEY: "wablas-test-secret",
  WABLAS_WEBHOOK_SECRET: "wablas-hook-secret",
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

  it("sends WABLAS text through V2 with provider credentials, reference, and group flag", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: true, data: { messages: [{ id: "wablas-id-1", status: "pending" }] } }), { status: 200 }));
    const response = await sendWithConfiguredWaProvider({ method: "POST", body: JSON.stringify({
      target: "120363012345678901@g.us", message: "laporan", outbox_id: "outbox-1",
    }) }, { provider: "wablas", fetchImpl, env });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://wablas.com/api/v2/send-message");
    expect(options.headers.get("Authorization")).toBe("wablas-test-token.wablas-test-secret");
    expect(JSON.parse(options.body)).toEqual({ data: [{
      phone: "120363012345678901@g.us", message: "laporan", isGroup: true, ref_id: "outbox-1",
    }] });
    expect(await response.json()).toMatchObject({ status: true, id: "wablas-id-1", ref_id: "outbox-1" });
  });

  it("recognizes WABLAS bare numeric group IDs from its inbound webhook shape", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: true, data: { messages: [{ id: "group-id" }] } }), { status: 200 }));
    await sendWithConfiguredWaProvider({ method: "POST", body: JSON.stringify({ target: "120363064449269123", message: "group reply" }) }, { provider: "wablas", fetchImpl, env });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).data[0]).toMatchObject({ phone: "120363064449269123", isGroup: true });
  });

  it("sends WABLAS PDFs through the document endpoint and keeps timeout uncertain", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: true, data: { messages: [{ id: "pdf-id" }] } }), { status: 200 }));
    const response = await sendWithConfiguredWaProvider({ method: "POST", body: JSON.stringify({
      target: "628123456789", message: "Service report", url: "https://files.example.test/report.pdf",
      filename: "Report Card.pdf", outbox_id: "outbox-pdf",
    }) }, { provider: "wablas", fetchImpl, env });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://wablas.com/api/v2/send-document");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).data[0]).toMatchObject({
      phone: "628123456789", document: "https://files.example.test/report.pdf", caption: "Service report",
      filename: "Report_Card.pdf", isGroup: false, ref_id: "outbox-pdf",
    });
    expect((await response.json()).id).toBe("pdf-id");
    const timeout = vi.fn(async () => { throw new Error("connection reset"); });
    await expect(sendWithConfiguredWaProvider({ method: "POST", body: JSON.stringify({ target: "628123456789", message: "test" }) }, { provider: "wablas", fetchImpl: timeout, env })).rejects.toThrow("connection reset");
    expect(timeout).toHaveBeenCalledTimes(1);
  });

  it("tests WABLAS device connectivity without exposing its token in diagnostics", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: true, data: { active: true, status: "connected" } }), { status: 200 }));
    const result = await testWaProvider("wablas", { fetchImpl, env });
    expect(result).toMatchObject({ success: true, provider: "wablas", message: "WABLAS terhubung" });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/api/device/info?token=wablas-test-token");
    expect(JSON.stringify(result)).not.toContain("wablas-test-token");
  });

  it("rejects messages over WABLAS's documented limit before sending", async () => {
    const fetchImpl = vi.fn();
    const response = await sendWithConfiguredWaProvider({ method: "POST", body: JSON.stringify({ target: "628123456789", message: "x".repeat(1025) }) }, { provider: "wablas", fetchImpl, env });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: false, reason: expect.stringContaining("1024") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
