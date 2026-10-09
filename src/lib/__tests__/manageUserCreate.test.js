import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/_auth.js", () => ({ checkRateLimit: async () => true, signAppToken: vi.fn(), validateInternalToken: vi.fn() }));
import { manageUser } from "../../../api/_handlers/auth-token.js";

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const result = () => ({ code: 0, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = () => ({
  method: "POST", appClaims: { role: "Owner" }, headers: {},
  body: { action: "create", email: "rey@example.test", password: "secret123", name: "Rey", role: "Teknisi", phone: "628123" }
});
const run = async replies => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    calls.push({ url, options });
    const next = replies.shift();
    if (!next) throw new Error(`Unexpected request: ${url}`);
    if (next instanceof Error) throw next;
    return response(...next);
  }));
  const res = result();
  await manageUser(request(), res);
  return { res, calls };
};

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://db.example.test");
  vi.stubEnv("SUPABASE_SERVICE_KEY", "test-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("manage-user create", () => {
  it("returns success only after the employee profile is stored", async () => {
    const { res, calls } = await run([
      [200, { id: "user-1", email: "rey@example.test" }],
      [201, [{ id: "user-1", name: "Rey", role: "Teknisi" }]],
    ]);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, user: { id: "user-1", name: "Rey" } });
    expect(calls).toHaveLength(2);
  });

  it("accepts a matching profile already created by an auth trigger", async () => {
    const { res, calls } = await run([
      [200, { id: "user-1" }], [409, { code: "23505" }],
      [200, [{ id: "user-1", name: "Rey", role: "Teknisi" }]],
    ]);
    expect(res.code).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("rolls back a new login when its profile is confirmed missing", async () => {
    const { res, calls } = await run([
      [200, { id: "user-1" }], [400, { message: "profile rejected" }],
      [200, []], [204, null],
    ]);
    expect(res.code).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain("akun baru dibatalkan");
    expect(calls[3]).toMatchObject({ url: "https://db.example.test/auth/v1/admin/users/user-1", options: { method: "DELETE" } });
  });

  it("does not claim success or delete the account when verification is unavailable", async () => {
    const { res, calls } = await run([
      [200, { id: "user-1" }], [400, { message: "profile rejected" }],
      [503, { message: "offline" }],
    ]);
    expect(res.code).toBe(502);
    expect(res.body).toMatchObject({ ok: false, userId: "user-1" });
    expect(calls).toHaveLength(3);
  });

  it("keeps a possibly created profile intact after an uncertain network failure", async () => {
    const { res, calls } = await run([
      [200, { id: "user-1" }], new Error("connection lost"), [200, []],
    ]);
    expect(res.code).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(calls).toHaveLength(3);
  });
});
