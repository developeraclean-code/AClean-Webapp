import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateCustomerToken } from "../../../api/_handlers/customer.js";

const phone = "628123456789";
const existingToken = "a".repeat(48);
const response = body => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

describe("permanent customer portal token", () => {
  let previous;

  beforeEach(() => {
    previous = {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_KEY,
      ready: process.env.STATUS_PORTAL_REDIRECT_READY,
    };
    process.env.SUPABASE_URL = "https://db.example.test";
    process.env.SUPABASE_SERVICE_KEY = "test-service-key";
    process.env.STATUS_PORTAL_REDIRECT_READY = "true";
  });

  afterEach(() => {
    for (const [name, value] of Object.entries({
      SUPABASE_URL: previous.url,
      SUPABASE_SERVICE_KEY: previous.key,
      STATUS_PORTAL_REDIRECT_READY: previous.ready,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.unstubAllGlobals();
  });

  async function generate(existing, concurrentWinner = null) {
    const writes = [];
    let current = existing && { id: "token-row-1", ...existing };
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      const request = new URL(url);
      if (request.pathname.endsWith("/customer_tokens") && !options.method) return response(current ? [current] : []);
      if (request.pathname.endsWith("/customer_tokens")) {
        writes.push({ method: options.method, body: JSON.parse(options.body) });
        if (concurrentWinner && writes.length === 1) {
          current = { id: "token-row-1", token: concurrentWinner, expires_at: null, revoked_at: null };
          return response([]);
        }
        return response([{}]);
      }
      if (request.pathname.endsWith("/app_settings")) return response([{ value: "https://status.aclean.id" }]);
      throw new Error("unexpected request");
    }));
    const res = {
      code: 200,
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await generateCustomerToken({ method: "POST", body: { phone, customer_name: "Test" } }, res);
    return { res, writes };
  }

  it("uses the same active token and removes the legacy expiry", async () => {
    const { res, writes } = await generate({ token: existingToken, expires_at: "2099-01-01T00:00:00Z", revoked_at: null });
    expect(res.code).toBe(200);
    expect(res.body.token).toBe(existingToken);
    expect(res.body.link).toBe(`https://status.aclean.id/status/${existingToken}`);
    expect(res.body.expires_at).toBeNull();
    expect(writes[0].body.expires_at).toBeNull();
  });

  it("rotates an expired token and keeps the replacement permanent", async () => {
    const { res, writes } = await generate({ token: existingToken, expires_at: "2020-01-01T00:00:00Z", revoked_at: null });
    expect(res.code).toBe(200);
    expect(res.body.token).toMatch(/^[a-f0-9]{48}$/);
    expect(res.body.token).not.toBe(existingToken);
    expect(writes[0].body).toMatchObject({ expires_at: null, revoked_at: null });
  });

  it("rotates a revoked token", async () => {
    const { res, writes } = await generate({ token: existingToken, expires_at: null, revoked_at: "2026-11-03T00:00:00Z" });
    expect(res.code).toBe(200);
    expect(res.body.token).not.toBe(existingToken);
    expect(writes[0].body.revoked_at).toBeNull();
  });

  it("returns the winning token when another request rotates first", async () => {
    const winner = "b".repeat(48);
    const { res, writes } = await generate({ token: existingToken, expires_at: "2020-01-01T00:00:00Z", revoked_at: null }, winner);
    expect(res.code).toBe(200);
    expect(res.body.token).toBe(winner);
    expect(writes).toHaveLength(2);
  });
});
