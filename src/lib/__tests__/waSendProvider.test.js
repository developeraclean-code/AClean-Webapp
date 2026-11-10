import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWa } from "../../../api/_handlers/wa.js";
import { clearWaProviderCache } from "../../../api/_wa-provider.js";

let selectedProvider;
const response = () => ({
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; },
});

beforeEach(() => {
  clearWaProviderCache();
  selectedProvider = "whacenter";
  vi.stubEnv("SUPABASE_URL", "https://db.example.test");
  vi.stubEnv("SUPABASE_SERVICE_KEY", "service-test-key");
  vi.stubEnv("FONNTE_TOKEN", "fonnte-test-token");
  vi.stubEnv("WHACENTER_DEVICE_ID", "wha-test-device");
});
afterEach(() => { clearWaProviderCache(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("send-wa provider routing", () => {
  it("uses exactly the provider selected in app_settings", async () => {
    vi.stubEnv("FONNTE_TOKEN", "");
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      if (String(url).includes("/rest/v1/app_settings")) return new Response(JSON.stringify([{ value: selectedProvider }]), { status: 200 });
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({ status: true, id: "accepted-1" }), { status: 200 });
    }));

    const res = response();
    await sendWa({ method: "POST", body: { phone: "081234567890", message: "invoice" } }, res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ success: true, provider: "whacenter" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://app.whacenter.com/api/send");
    expect(requests[0].options.body.get("device_id")).toBe("wha-test-device");
    expect(requests[0].options.body.get("number")).toBe("6281234567890");
    expect(requests[0].options.body.get("message")).toBe("invoice");
  });

  it("does not retry or fall back to Fonnte when WhaCenter result is uncertain", async () => {
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async url => {
      if (String(url).includes("/rest/v1/app_settings")) return new Response(JSON.stringify([{ value: "whacenter" }]), { status: 200 });
      requests.push(String(url));
      throw new Error("synthetic timeout");
    }));

    const res = response();
    await sendWa({ method: "POST", body: { phone: "081234567890", message: "invoice" } }, res);
    expect(res.code).toBe(502);
    expect(res.body.detail).toBe("WHACENTER_UNCERTAIN");
    expect(requests).toEqual(["https://app.whacenter.com/api/send"]);
  });

  it("preserves Fonnte endpoint and payload when Fonnte is selected", async () => {
    selectedProvider = "fonnte";
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      if (String(url).includes("/rest/v1/app_settings")) return new Response(JSON.stringify([{ value: selectedProvider }]), { status: 200 });
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({ status: true, id: "fonnte-1" }), { status: 200 });
    }));

    const res = response();
    await sendWa({ method: "POST", body: { phone: "081234567890", message: "halo" } }, res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ success: true, provider: "fonnte" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.fonnte.com/send");
    expect(requests[0].options.headers.get("Authorization")).toBe("fonnte-test-token");
    expect(JSON.parse(requests[0].options.body)).toMatchObject({ target: "6281234567890", message: "halo" });
  });
});
