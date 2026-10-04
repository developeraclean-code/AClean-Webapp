import { afterEach, describe, expect, it, vi } from "vitest";
import { maintenance } from "../../../api/_handlers/portal.js";

const oldFetch = globalThis.fetch;
const oldUrl = process.env.SUPABASE_URL;
const oldKey = process.env.SUPABASE_SERVICE_KEY;

afterEach(() => {
  globalThis.fetch = oldFetch;
  if (oldUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = oldUrl;
  if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
  else process.env.SUPABASE_SERVICE_KEY = oldKey;
});

function response(rows, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => rows, text: async () => "test error" };
}

async function runAutolog(units, registry) {
  process.env.SUPABASE_URL = "https://local.invalid";
  process.env.SUPABASE_SERVICE_KEY = "synthetic-only";
  const requests = [];
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    const path = new URL(url).pathname;
    requests.push({ path, method: options.method || "GET" });
    if (path.endsWith("/orders")) return response([{ id: "JOB-1", service: "Cleaning", maintenance_client_id: "C-1", maintenance_unit_ids: ["U-1", "U-2"] }]);
    if (path.endsWith("/service_reports")) return response([{ units_json: units, foto_urls: [], fotos: [], materials_json: [] }]);
    if (path.endsWith("/maintenance_units")) return response(registry);
    throw new Error("Unexpected endpoint: " + path);
  });
  const res = { statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  await maintenance({ method: "POST", body: { action: "autolog-from-order", order_id: "JOB-1" }, appClaims: { role: "Owner" }, headers: {} }, res);
  return { res, requests };
}

describe("maintenance autolog handler — no guessed unit history", () => {
  it.each([
    [[{ maint_unit_id: "U-1" }, {}], [{ id: "U-1", client_id: "C-1" }], "unit_id_missing"],
    [[{ maint_unit_id: "U-1" }, { maint_unit_id: "U-1" }], [{ id: "U-1", client_id: "C-1" }], "unit_id_duplicate"],
    [[{ maint_unit_id: "U-2" }], [{ id: "U-2", client_id: "C-2" }], "unit_other_client"],
    [[{ maint_unit_id: "U-X" }], [], "unit_id_unknown"],
  ])("tidak menulis log bila identitas ambigu", async (units, registry, reason) => {
    const { res, requests } = await runAutolog(units, registry);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ skipped: true, needs_unit_selection: true, reason });
    expect(requests.every(request => request.method === "GET")).toBe(true);
    expect(requests.some(request => request.path.endsWith("/maintenance_logs"))).toBe(false);
  });

  it("gagal membaca audit tidak tampil sebagai nol temuan", async () => {
    process.env.SUPABASE_URL = "https://local.invalid";
    process.env.SUPABASE_SERVICE_KEY = "synthetic-only";
    globalThis.fetch = vi.fn(async () => response([], false));
    const res = { statusCode: 200, body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; } };
    const oldConsoleError = console.error;
    console.error = vi.fn();
    try {
      await maintenance({ method: "POST", body: { action: "link-audit", days: 30 }, appClaims: { role: "Owner" }, headers: {} }, res);
    } finally { console.error = oldConsoleError; }
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toHaveProperty("summary");
  });

  it("audit tetap menemukan order bermasalah setelah halaman pertama", async () => {
    process.env.SUPABASE_URL = "https://local.invalid";
    process.env.SUPABASE_SERVICE_KEY = "synthetic-only";
    const orders = Array.from({ length: 1001 }, (_, i) => ({
      id: `JOB-${i}`, customer: `Customer ${i}`, maintenance_client_id: "C-1", date: "2026-10-04",
    }));
    const requests = [];
    globalThis.fetch = vi.fn(async (url) => {
      const parsed = new URL(url);
      const table = parsed.pathname.split("/").pop();
      requests.push({ table, offset: Number(parsed.searchParams.get("offset") || 0) });
      if (table === "orders") {
        const offset = Number(parsed.searchParams.get("offset") || 0);
        return response(orders.slice(offset, offset + Number(parsed.searchParams.get("limit") || 1000)));
      }
      if (table === "service_reports") return response([{ job_id: "JOB-1000", units_json: [{}], total_units: 1 }]);
      if (table === "maintenance_clients") return response([{ id: "C-1", name: "Client", pic_phone: null }]);
      return response([]);
    });
    const res = { statusCode: 200, body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; } };
    await maintenance({ method: "POST", body: { action: "link-audit", days: 30 }, appClaims: { role: "Owner" }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(requests.filter(request => request.table === "orders").map(request => request.offset)).toEqual([0, 1000]);
    expect(res.body.summary).toMatchObject({ missing_logs: 1, needs_unit_mapping: 1 });
    expect(res.body.needs_unit_mapping[0].order_id).toBe("JOB-1000");
  });
});
