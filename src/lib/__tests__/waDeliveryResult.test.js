import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Helper WA berada di modul cron bersama. Jangan membangun koneksi Supabase
// sungguhan saat unit test—CI tidak membawa secret dan test ini hanya menguji
// kontrak hasil provider WA.
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({})),
}));

describe("sendWAWithResult", () => {
  let sendWAWithResult;
  const originalOwner = process.env.OWNER_PHONE;
  const originalToken = process.env.FONNTE_TOKEN;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_KEY;
  const originalWhaCenterDevice = process.env.WHACENTER_DEVICE_ID;
  let clearProviderCache;

  beforeAll(async () => {
    process.env.OWNER_PHONE = "628000000000";
    process.env.FONNTE_TOKEN = "test-token";
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "test-service-key";
    vi.resetModules();
    ({ clearWaProviderCache: clearProviderCache } = await import("../../../api/_wa-provider.js"));
    ({ sendWAWithResult } = await import("../../../api/_tasks/_shared.js"));
  });

  afterAll(() => {
    if (originalOwner === undefined) delete process.env.OWNER_PHONE; else process.env.OWNER_PHONE = originalOwner;
    if (originalToken === undefined) delete process.env.FONNTE_TOKEN; else process.env.FONNTE_TOKEN = originalToken;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = originalKey;
    if (originalWhaCenterDevice === undefined) delete process.env.WHACENTER_DEVICE_ID; else process.env.WHACENTER_DEVICE_ID = originalWhaCenterDevice;
    vi.unstubAllGlobals();
  });

  it("retry sekali lalu mengembalikan audit sukses", async () => {
    clearProviderCache();
    const sendMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: false, reason: "temporary" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: true }) });
    const fetchMock = vi.fn(async (url, options) => String(url).includes("/rest/v1/app_settings")
      ? new Response(JSON.stringify([{ value: "fonnte" }]), { status: 200 })
      : sendMock(url, options));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWAWithResult("628123", "test", { retries: 1, timeoutMs: 1000 });
    expect(result).toEqual({ ok: true, attempts: 2, httpStatus: 200 });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("mengembalikan alasan gagal setelah batas retry", async () => {
    clearProviderCache();
    const sendMock = vi.fn().mockResolvedValue({
      ok: false, status: 503, json: async () => ({ status: false, reason: "provider down" }),
    });
    vi.stubGlobal("fetch", vi.fn(async (url, options) => String(url).includes("/rest/v1/app_settings")
      ? new Response(JSON.stringify([{ value: "fonnte" }]), { status: 200 })
      : sendMock(url, options)));
    const result = await sendWAWithResult("628123", "test", { retries: 1, timeoutMs: 1000 });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.error).toContain("provider down");
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a WhaCenter message when the first result is uncertain", async () => {
    clearProviderCache();
    process.env.WHACENTER_DEVICE_ID = "test-device";
    const sendMock = vi.fn(async () => { throw new Error("timeout uncertain"); });
    const fetchMock = vi.fn(async (url, options) => String(url).includes("/rest/v1/app_settings")
      ? new Response(JSON.stringify([{ value: "whacenter" }]), { status: 200 })
      : sendMock(url, options));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendWAWithResult("628123", "test", { retries: 2, timeoutMs: 1000 });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.error).toContain("uncertain");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(String(sendMock.mock.calls[0][0])).toContain("app.whacenter.com/api/send");
  });
});
