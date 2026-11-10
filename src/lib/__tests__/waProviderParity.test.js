import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { clearWaProviderCache, sendConfiguredWaNotification, testWaProvider } from "../../../api/_wa-provider.js";
import { captureWaIngress, downloadIngressMedia, normalizeWaIngress, safeWhacenterMediaUrl } from "../../../api/_wa-ingress.js";
import { retryOnePaymentMediaJob } from "../../../api/_payment-media.js";
import { createHealthCheck } from "../../../api/_health.js";

const env = { SUPABASE_URL: "https://db.example.com", SUPABASE_SERVICE_KEY: "synthetic-service", WHACENTER_DEVICE_ID: "synthetic-device" };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => { clearWaProviderCache(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("gateway parity across operational notifications and media", () => {
  it("routes alerts through selected WhaCenter even without any Fonnte credential", async () => {
    const fetchImpl = vi.fn(async url => String(url).includes("app_settings") ? json([{ value: "whacenter" }]) : json({ status: true }));
    expect(await sendConfiguredWaNotification("628000000001", "synthetic alert", { env, fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1][0])).toBe("https://app.whacenter.com/api/send");
    expect(fetchImpl.mock.calls[1][1].body.get("device_id")).toBe("synthetic-device");
  });
  it.each([false, "timeout"])("does not fall back or retry after an uncertain/rejected operational alert (%s)", async state => {
    const fetchImpl = vi.fn(async () => { if (state === "timeout") throw new Error("timeout"); return json({ status: false }); });
    expect(await sendConfiguredWaNotification("628000000001", "test", { provider: "whacenter", env, fetchImpl })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("uses the actual Fonnte device profile and distinguishes disconnected devices", async () => {
    const fetchImpl = vi.fn(async () => json({ status: true, device_status: "connect" }));
    expect((await testWaProvider("fonnte", { env: { FONNTE_TOKEN: "synthetic" }, fetchImpl })).ok).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.fonnte.com/device");
    fetchImpl.mockImplementation(async () => json({ status: true, device_status: "disconnect" }));
    expect((await testWaProvider("fonnte", { env: { FONNTE_TOKEN: "synthetic" }, fetchImpl })).ok).toBe(false);
  });
  it("keeps built-in WhaCenter hosts enabled when configuring an extra CDN", () => {
    const options = { env: { WHACENTER_MEDIA_HOSTS: "cdn.example.com, https://evil.com,127.0.0.1" } };
    expect(safeWhacenterMediaUrl("https://app.whacenter.com/m/a.jpg", options)).toBeTruthy();
    expect(safeWhacenterMediaUrl("https://cdn.example.com/a.jpg", options)).toBeTruthy();
    expect(safeWhacenterMediaUrl("https://cdn.example.com.evil.com/a.jpg", options)).toBeNull();
    expect(safeWhacenterMediaUrl("https://evil.com/a.jpg", options)).toBeNull();
    expect(safeWhacenterMediaUrl("https://127.0.0.1/a.jpg", options)).toBeNull();
  });
  it("retains long media references and recognizes WhaCenter PDF/video without a type field", () => {
    const media = "https://app.whacenter.com/media/receipt.pdf?sig=" + "x".repeat(200);
    const event = normalizeWaIngress({ from: "628000000001", message: "bukti", media, timestamp: "2026-11-10 10:30:00" }, { provider: "whacenter" });
    expect(event).toMatchObject({ type: "document", capture_media: true, media_url: media, payload: { media, provider: "whacenter" } });
    expect(normalizeWaIngress({ from: "628000000001", media: "https://app.whacenter.com/a.mp4" }, { provider: "whacenter" })).toMatchObject({ type: "video", processable: false, capture_media: false });
    expect(normalizeWaIngress({ from: "628000000001", media: "https://app.whacenter.com/a.docx" }, { provider: "whacenter" })).toMatchObject({ type: "document", processable: false, review_reason: expect.stringContaining("manual") });
  });
  it("preserves explicit group identity and participant without inventing a customer phone", () => {
    const event = normalizeWaIngress({ group: "120000000001@g.us", from: "628000000001", media: "https://app.whacenter.com/a.jpg" }, { provider: "whacenter" });
    expect(event).toMatchObject({ sender: "120000000001@g.us", member: "628000000001", is_group: true, phone: null, capture_media: false });
  });
  it("passes trusted extra hosts separately to the service-only RPC, never from webhook payload", async () => {
    const fetchImpl = vi.fn(async () => json({ receipt_id: "receipt", received_at: "2026-11-10T00:00:00Z", duplicate: false, message_id: "1" }));
    const event = normalizeWaIngress({ from: "628000000001", media: "https://cdn.example.com/a.jpg", p_media_hosts: ["evil.com"] }, { provider: "whacenter", env: { WHACENTER_MEDIA_HOSTS: "cdn.example.com" } });
    await captureWaIngress(event, { supabaseUrl: env.SUPABASE_URL, serviceKey: "synthetic", fetchImpl, env: { WHACENTER_MEDIA_HOSTS: "cdn.example.com" } });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ p_event: event, p_media_hosts: ["cdn.example.com"] });
  });
  it("reports useful SQL diagnostics without logging private database messages", async () => {
    const options = { supabaseUrl: env.SUPABASE_URL, serviceKey: "synthetic", fetchImpl: async () => json({ code: "P0001", message: "URL media tidak aman", details: "PRIVATE" }, 400) };
    await expect(captureWaIngress({}, options)).rejects.toThrow("code=P0001, URL media ditolak database");
    options.fetchImpl = async () => json({ code: "23514", message: "PRIVATE_PHONE_AND_TOKEN" }, 400);
    await expect(captureWaIngress({}, options)).rejects.not.toThrow("PRIVATE");
  });
  it("retries media from the stored provider after the global selection changes", async () => {
    const source = "https://app.whacenter.com/media/expired.jpg";
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes("claim_wa_payment_media")) return json({ id: "job-1", provider: "whacenter", source_url: source, phone: "628000000001", attempts: 3 });
      if (String(url) === source) { expect(init.redirect).toBe("error"); return json({}, 404); }
      if (init.method === "PATCH") return json([{ id: "job-1" }]);
      throw new Error("Unexpected request: " + url);
    });
    vi.stubGlobal("fetch", fetchImpl);
    expect(await retryOnePaymentMediaJob({ supabaseUrl: env.SUPABASE_URL, serviceKey: "synthetic" })).toMatchObject({ checked: 1, failed: 1 });
    expect(fetchImpl.mock.calls.some(([url]) => String(url) === source)).toBe(true);
    expect(fetchImpl.mock.calls.some(([url]) => /fonnte|app_settings/.test(String(url)))).toBe(false);
  });
  it("blocks cross-provider sources, redirect following and oversized WhaCenter downloads", async () => {
    const fetchImpl = vi.fn(async () => new Response("x", { headers: { "content-length": "11000000" } }));
    await expect(downloadIngressMedia("https://api.fonnte.com/a.jpg", { provider: "whacenter", fetchImpl })).rejects.toThrow("URL media");
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(downloadIngressMedia("https://app.whacenter.com/a.jpg", { provider: "whacenter", fetchImpl })).rejects.toThrow("10 MB");
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
  });
  it("reports WhaCenter device health independently of Fonnte configuration", async () => {
    const fetchImpl = vi.fn(async url => String(url).includes("statusDevice") ? json({ status: true, data: { status: "CONNECTED" } }) : json({}));
    const result = await createHealthCheck({ fetchImpl })(env);
    expect(result.checks).toMatchObject({ whacenter: "ok", fonnte: "not_configured" });
  });
  it("keeps every runtime send behind the provider adapter", () => {
    const root = new URL("../../../api/", import.meta.url);
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(new URL(entry.name + "/", dir)) : entry.name.endsWith(".js") ? [new URL(entry.name, dir)] : []);
    const bypasses = walk(root).filter(url => !url.pathname.endsWith("/_wa-provider.js") && /https:\/\/api\.fonnte\.com\/send["']/.test(readFileSync(url, "utf8")));
    expect(bypasses.map(url => url.pathname)).toEqual([]);
  });
});

it("retains the actual gateway in a durable send audit when the transport times out", async () => {
  vi.stubEnv("SUPABASE_URL", env.SUPABASE_URL);vi.stubEnv("SUPABASE_SERVICE_KEY", "synthetic");vi.stubEnv("WHACENTER_DEVICE_ID", "synthetic-device");
  const { deliverWorkspaceMessage } = await import("../../../api/_wa-workspace.js");
  const fetchImpl = vi.fn(async url => {
    if (String(url).includes("app_settings")) return json([{ value: "whacenter" }]);
    throw new Error("synthetic transport timeout");
  });
  expect(await deliverWorkspaceMessage({ phone: "628000000001", message: "test" }, { fetchImpl })).toMatchObject({ status: "UNCERTAIN", provider: "whacenter" });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it.each(["empty-json", "non-json", "server-error"])("keeps an unconfirmed WhaCenter response UNCERTAIN, never retryable FAILED (%s)", async shape => {
  const { deliverWorkspaceMessage } = await import("../../../api/_wa-workspace.js");
  vi.stubEnv("WHACENTER_DEVICE_ID", "synthetic-device");
  const fetchImpl = vi.fn(async () => shape === "empty-json" ? json({}) : new Response("upstream unavailable", { status: shape === "server-error" ? 502 : 200 }));
  const result = await deliverWorkspaceMessage({ phone: "628000000001", message: "test" }, { provider: "whacenter", fetchImpl });
  expect(result).toMatchObject({ status: "UNCERTAIN", provider: "whacenter" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(String(fetchImpl.mock.calls[0][0])).toBe("https://app.whacenter.com/api/send");
});
