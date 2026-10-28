import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAppToken } from "../../../api/_auth.js";
import { foto, uploadFoto } from "../../../api/_handlers/foto.js";
import {
  canAccessStagingMedia, isPrivateStagingMedia, isMediaAuthRequired, setStagingMediaCookie,
  stagingMediaActor, stagingUploadProbe,
} from "../../../api/_staging-media-access.js";

const userId = "11111111-1111-4111-8111-111111111111";
const owner = { id: userId, name: "LAB OWNER", role: "Owner", active: true };
const field = { ...owner, name: "LAB TEKNISI", role: "Teknisi" };
const originals = {};

function response() {
  const headers = {};
  return {
    headers,
    setHeader: (name, value) => { headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

beforeEach(() => {
  for (const name of ["R2_BUCKET_NAME", "INTERNAL_API_SECRET", "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY", "R2_ACCOUNT_ID", "R2_ACCESS_KEY", "R2_SECRET_KEY", "ACLEAN_MEDIA_AUTH_REQUIRED", "R2_PUBLIC_URL"]) {
    originals[name] = process.env[name];
  }
  Object.assign(process.env, {
    R2_BUCKET_NAME: "aclean-staging-media", INTERNAL_API_SECRET: "test-secret-32-characters-not-production",
    SUPABASE_URL: "http://lab.invalid", SUPABASE_SERVICE_KEY: "test-service-key",
    R2_ACCOUNT_ID: "test-account", R2_ACCESS_KEY: "test-access", R2_SECRET_KEY: "test-secret",
  });
  delete process.env.ACLEAN_MEDIA_AUTH_REQUIRED;
});

describe("explicit production API media authorization", () => {
  beforeEach(() => {
    process.env.R2_BUCKET_NAME = "aclean-files";
    process.env.ACLEAN_MEDIA_AUTH_REQUIRED = "true";
  });

  it("enables the same live-profile gate without pretending the R2 bucket is private", () => {
    expect(isPrivateStagingMedia()).toBe(false);
    expect(isMediaAuthRequired()).toBe(true);
    delete process.env.ACLEAN_MEDIA_AUTH_REQUIRED;
    expect(isMediaAuthRequired()).toBe(false);
  });

  it("rejects anonymous production reads before R2", async () => {
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    const res = response();
    await foto({ query: { key: "laporan/JOB-TEST/a.jpg" }, headers: {} }, res);
    expect(res.code).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });

  it("rejects unauthorized production uploads before presigning", async () => {
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    const res = response();
    await uploadFoto({ method: "POST", headers: {}, body: { action: "presign", reportId: "JOB-TEST",
      filename: "a.jpg", mimeType: "image/jpeg", size: 10 } }, res);
    expect(res.code).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });

  it("issues a production media cookie and returns private/no-store for authorized reads", async () => {
    const token = signAppToken({ userId, role: "Owner", name: "TEST OWNER" });
    const cookie = response(); setStagingMediaCookie(cookie, token);
    expect(cookie.headers["Set-Cookie"]).toContain("HttpOnly; Secure; SameSite=Strict");
    vi.stubGlobal("fetch", vi.fn(async url => String(url).includes("/user_profiles?")
      ? Response.json([owner]) : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })));
    const res = response();
    await foto({ query: { key: "laporan/JOB-TEST/a.png" }, headers: { cookie: `aclean_staging_media=${token}` } }, res);
    expect(res.code).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("keeps the existing production upload URL contract used by WA/portals", async () => {
    process.env.R2_PUBLIC_URL = "https://cdn.example.test";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([owner])));
    const res = response();
    await uploadFoto({ method: "POST", appClaims: { userId }, headers: {},
      body: { action: "presign", reportId: "JOB-TEST", filename: "a.jpg", mimeType: "image/jpeg", size: 10 } }, res);
    expect(res.code).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/cdn\.example\.test\//);
    expect(res.body.bucket).toBe("aclean-files");
  });

  it("rejects inactive production profiles despite a previously valid cookie", async () => {
    const token = signAppToken({ userId, role: "Owner", name: "TEST OWNER" });
    const network = vi.fn(async () => Response.json([{ ...owner, active: false }]));
    vi.stubGlobal("fetch", network);
    const res = response();
    await foto({ query: { key: "invoices/TEST.pdf" }, headers: { cookie: `aclean_staging_media=${token}` } }, res);
    expect(res.code).toBe(403);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("allows assigned production field media but rejects a different team before R2", async () => {
    const token = signAppToken({ userId, role: "Teknisi", name: "LAB TEKNISI" });
    for (const assigned of [true, false]) {
      const network = vi.fn(async url => String(url).includes("/user_profiles?")
        ? Response.json([field]) : String(url).includes("/orders?")
          ? Response.json([{ teknisi: assigned ? field.name : "OTHER", assigned_members: [] }])
          : new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }));
      vi.stubGlobal("fetch", network);
      const res = response();
      await foto({ query: { key: "laporan/JOB-TEST/a.png" },
        headers: { cookie: `aclean_staging_media=${token}` } }, res);
      expect(res.code).toBe(assigned ? 200 : 403);
      expect(network).toHaveBeenCalledTimes(assigned ? 3 : 2);
    }
  });

  it("allows production Finance invoice media and denies field staff", async () => {
    for (const role of ["Finance", "Helper"]) {
      const token = signAppToken({ userId, role, name: "TEST" });
      const network = vi.fn(async url => String(url).includes("/user_profiles?")
        ? Response.json([{ ...owner, role }])
        : new Response(new Uint8Array([1]), { headers: { "content-type": "application/pdf" } }));
      vi.stubGlobal("fetch", network);
      const res = response();
      await foto({ query: { key: "invoices/TEST.pdf" },
        headers: { cookie: `aclean_staging_media=${token}` } }, res);
      expect(res.code).toBe(role === "Finance" ? 200 : 403);
      expect(network).toHaveBeenCalledTimes(role === "Finance" ? 2 : 1);
    }
  });
});

afterEach(() => {
  for (const [name, value] of Object.entries(originals)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  vi.unstubAllGlobals();
});

describe("isolated staging media gate", () => {
  it("is enabled only for the dedicated staging bucket", () => {
    expect(isPrivateStagingMedia()).toBe(true);
    process.env.R2_BUCKET_NAME = "aclean-files";
    expect(isPrivateStagingMedia()).toBe(false);
  });

  it("issues a host-only HttpOnly Secure cookie and checks the live profile", async () => {
    const token = signAppToken({ userId, role: "Owner", name: "LAB OWNER" });
    const res = response();
    setStagingMediaCookie(res, token);
    expect(res.headers["Set-Cookie"]).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(res.headers["Set-Cookie"]).toContain("Path=/api/foto");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([owner])));
    expect(await stagingMediaActor({ headers: { cookie: `other=a; aclean_staging_media=${token}` } }, { cookie: true }))
      .toEqual(owner);
  });

  it("rejects missing cookies before any database or R2 request", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const res = response();
    await foto({ query: { key: "laporan/JOB-LAB/a.jpg" }, headers: {} }, res);
    expect(res.code).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });

  it("rejects unauthorized upload before signing a direct R2 URL", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const res = response();
    await uploadFoto({ method: "POST", body: { action: "presign", reportId: "JOB-LAB",
      filename: "a.jpg", mimeType: "image/jpeg", size: 10 }, headers: {} }, res);
    expect(res.code).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });

  it("returns only a private proxy URL for an authorized staging upload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([owner])));
    const res = response();
    await uploadFoto({ method: "POST", appClaims: { userId }, headers: {},
      body: { action: "presign", reportId: "JOB-LAB", filename: "a.jpg",
        mimeType: "image/jpeg", size: 10 } }, res);
    expect(res.code).toBe(200);
    expect(res.body.url).toMatch(/^\/api\/foto\?key=/);
    expect(res.body.url).not.toContain("r2.cloudflarestorage.com");
  });

  it("serves an authorized Owner image without public caching", async () => {
    const token = signAppToken({ userId, role: "Owner", name: "LAB OWNER" });
    vi.stubGlobal("fetch", vi.fn(async url =>
      String(url).includes("/user_profiles?")
        ? Response.json([owner])
        : new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } })));
    const res = response();
    await foto({ query: { key: "laporan/JOB-LAB/a.png" }, headers: { cookie: `aclean_staging_media=${token}` } }, res);
    expect(res.code).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    expect(res.headers["Content-Type"]).toBe("image/png");
  });

  it("permits field staff only on assigned lab jobs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{
      teknisi: "LAB TEKNISI", teknisi2: null, teknisi3: null,
      helper: null, helper2: null, helper3: null, assigned_members: [],
    }])));
    expect(await canAccessStagingMedia(field, "laporan/JOB-LAB/a.jpg")).toBe(true);
    expect(await canAccessStagingMedia(field, "invoices/secret.pdf")).toBe(false);
    expect(await canAccessStagingMedia({ ...field, name: "OTHER" }, "laporan/JOB-LAB/a.jpg")).toBe(false);
  });

  it("denies unassigned field media before fetching R2", async () => {
    const token = signAppToken({ userId, role: "Teknisi", name: "LAB TEKNISI" });
    const network = vi.fn(async url => String(url).includes("/user_profiles?")
      ? Response.json([field])
      : Response.json([{ teknisi: "ANOTHER PERSON", assigned_members: [] }]));
    vi.stubGlobal("fetch", network);
    const res = response();
    await foto({ query: { key: "laporan/JOB-OTHER/a.jpg" },
      headers: { cookie: `aclean_staging_media=${token}` } }, res);
    expect(res.code).toBe(403);
    expect(network).toHaveBeenCalledTimes(2);
    expect(network.mock.calls.every(([url]) => !String(url).includes("r2.cloudflarestorage.com"))).toBe(true);
  });

  it("rejects a once-valid cookie after the profile is deactivated", async () => {
    const token = signAppToken({ userId, role: "Owner", name: "LAB OWNER" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ ...owner, active: false }])));
    const res = response();
    await foto({ query: { key: "laporan/JOB-LAB/a.jpg" },
      headers: { cookie: `aclean_staging_media=${token}` } }, res);
    expect(res.code).toBe(403);
  });

  it("limits Finance to invoice and payment media", async () => {
    const finance = { ...owner, role: "Finance" };
    expect(await canAccessStagingMedia(finance, "invoices/INV-LAB.pdf")).toBe(true);
    expect(await canAccessStagingMedia(finance, "laporan/bukti-INV-LAB/proof.jpg")).toBe(true);
    expect(await canAccessStagingMedia(finance, "customer-photos/private.jpg")).toBe(false);
  });

  it("fails closed on folder traversal or arbitrary staff upload folders", () => {
    expect(stagingUploadProbe({ reportId: "JOB-LAB" })).toBe("laporan/JOB-LAB/__upload.jpg");
    expect(stagingUploadProbe({ folder: "../private" })).toBeNull();
    expect(stagingUploadProbe({ folder: "laporan//JOB-LAB" })).toBeNull();
  });
});
