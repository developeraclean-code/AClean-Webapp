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

  beforeAll(async () => {
    process.env.OWNER_PHONE = "628000000000";
    process.env.FONNTE_TOKEN = "test-token";
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "test-service-key";
    vi.resetModules();
    ({ sendWAWithResult } = await import("../../../api/_tasks/_shared.js"));
  });

  afterAll(() => {
    if (originalOwner === undefined) delete process.env.OWNER_PHONE; else process.env.OWNER_PHONE = originalOwner;
    if (originalToken === undefined) delete process.env.FONNTE_TOKEN; else process.env.FONNTE_TOKEN = originalToken;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it("retry sekali lalu mengembalikan audit sukses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: false, reason: "temporary" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWAWithResult("628123", "test", { retries: 1, timeoutMs: 1000 });
    expect(result).toEqual({ ok: true, attempts: 2, httpStatus: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("mengembalikan alasan gagal setelah batas retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 503, json: async () => ({ status: false, reason: "provider down" }),
    }));
    const result = await sendWAWithResult("628123", "test", { retries: 1, timeoutMs: 1000 });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.error).toContain("provider down");
  });
});
