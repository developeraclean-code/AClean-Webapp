import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWa } from "../../../api/_handlers/wa.js";
import { foto } from "../../../api/_handlers/foto.js";
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

  it("sends a PDF attachment URL to WhaCenter in its documented file field", async () => {
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      if (String(url).includes("/rest/v1/app_settings")) return new Response(JSON.stringify([{ value: "whacenter" }]), { status: 200 });
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({ status: true, id: "pdf-accepted" }), { status: 200 });
    }));

    const pdfUrl = "https://app.aclean.id/api/foto?key=service-reports%2Freport.pdf&filename=Report.pdf";
    const res = response();
    await sendWa({ method: "POST", body: { phone: "081234567890", message: "Report Card", url: pdfUrl, filename: "Report.pdf" } }, res);

    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ success: true, provider: "whacenter", withAttachment: true });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://app.whacenter.com/api/send");
    expect(requests[0].options.body.get("number")).toBe("6281234567890");
    expect(requests[0].options.body.get("file")).toBe(pdfUrl);
  });

  it("adds the PDF filename when WhaCenter must fetch the stable foto proxy URL", async () => {
    vi.stubEnv("R2_CDN_URL", "");
    vi.stubEnv("R2_PUBLIC_URL", "");
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      if (String(url).includes("/rest/v1/app_settings")) return new Response(JSON.stringify([{ value: "whacenter" }]), { status: 200 });
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({ status: true }), { status: 200 });
    }));

    const res = response();
    await sendWa({ method: "POST", body: {
      phone: "081234567890", message: "Invoice", url: "https://app.aclean.id/api/foto?key=invoices/invoice-1.pdf",
      filename: "Invoice-1.pdf",
    } }, res);

    expect(res.code).toBe(200);
    expect(requests[0].options.body.get("file")).toBe("https://app.aclean.id/api/foto?key=invoices%2Finvoice-1.pdf&filename=Invoice-1.pdf");
  });

  it("serves a proxy PDF with its requested filename using the uploader account ID fallback", async () => {
    vi.stubEnv("R2_ACCESS_KEY", "r2-access");
    vi.stubEnv("R2_SECRET_KEY", "r2-secret");
    vi.stubEnv("R2_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-fallback");
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      requests.push(String(url));
      return new Response(Buffer.from("%PDF-1.7\nsynthetic"), {
        status: 200, headers: { "content-type": "application/pdf" },
      });
    }));
    const headers = {};
    const res = {
      status(code) { this.code = code; return this; },
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      send(value) { this.payload = value; return this; },
      json(value) { this.body = value; return this; },
    };

    await foto({ method: "GET", query: { key: "service-reports/report.pdf", filename: "Report Card.pdf" } }, res);

    expect(res.code).toBe(200);
    expect(requests[0]).toContain("account-fallback.r2.cloudflarestorage.com");
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["content-disposition"]).toBe('attachment; filename="Report_Card.pdf"');
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

  it("routes a selected WABLAS send and PDF only through WABLAS V2", async () => {
    selectedProvider = "wablas";
    vi.stubEnv("WABLAS_TOKEN", "wablas-test-token");
    vi.stubEnv("WABLAS_SECRET_KEY", "wablas-test-secret");
    const requests = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      if (String(url).includes("/rest/v1/app_settings")) return new Response(JSON.stringify([{ value: "wablas" }]), { status: 200 });
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({ status: true, data: { messages: [{ id: "wablas-accepted" }] } }), { status: 200 });
    }));
    const res = response();
    await sendWa({ method: "POST", body: { phone: "081234567890", message: "Report Card", url: "https://files.example.test/report.pdf", filename: "Report.pdf" } }, res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ success: true, provider: "wablas", providerId: "wablas-accepted", withAttachment: true, queued: true });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://wablas.com/api/v2/send-document");
    expect(requests[0].options.headers.get("Authorization")).toBe("wablas-test-token.wablas-test-secret");
    expect(JSON.parse(requests[0].options.body).data[0]).toMatchObject({ phone: "6281234567890", document: "https://files.example.test/report.pdf" });
  });
});
