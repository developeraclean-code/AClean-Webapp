import { afterEach, describe, expect, it, vi } from "vitest";
import { maintenance } from "../../../api/_handlers/portal.js";
import { dupoin, dupoinUnits, dupoinPrices } from "../../../scripts/data/dupoin-maintenance-20261015.mjs";
const previous = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };
afterEach(() => {
  globalThis.fetch = previous.fetch;
  for (const [name, value] of [["SUPABASE_URL", previous.url], ["SUPABASE_SERVICE_KEY", previous.key]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => structuredClone(data) });

function setup(overrides = {}) {
  process.env.SUPABASE_URL = "https://fixture.invalid"; process.env.SUPABASE_SERVICE_KEY = "fixture-only";
  const units = dupoinUnits.map((u, i) => ({ ...u, id: id(i + 1), client_id: dupoin.client_id }));
  const state = {
    maintenance_clients: [{ id: dupoin.client_id, name: dupoin.name }],
    maintenance_units: units,
    maintenance_logs: units.map((u, i) => ({ id: id(i + 101), client_id: dupoin.client_id, unit_id: u.id, service_type: "Cuci Rutin", service_category: "cuci_rutin", service_date: "2026-10-15", cost: null, invoiced: false, order_id: null })),
    maintenance_client_prices: dupoinPrices.map((p, i) => ({ ...p, client_id: dupoin.client_id, id: id(i + 201) })),
    price_list: [], orders: [], invoices: [], ...overrides,
  };
  const requests = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = new URL(url), table = u.pathname.split("/").pop();
    expect(u.host).toBe("fixture.invalid");
    requests.push({ table, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
    if (table === "create_maintenance_invoice_atomic") {
      if (state.rpcFailure) return response(state.rpcFailure, 400);
      const p = JSON.parse(opts.body);
      return response({ invoice: { ...p.p_invoice, status: "PENDING_APPROVAL" }, replayed: false });
    }
    expect(opts.method || "GET").toBe("GET");
    if (state.failTable === table) return response({ error: "fixture failure" }, 503);
    if (state.invalidTable === table) return response({ error: "invalid array fixture" });
    if (!state[table]) throw new Error(`Unexpected table ${table}`);
    let rows = state[table];
    for (const [key, filter] of u.searchParams) {
      if (filter.startsWith("in.(")) rows = rows.filter(r => filter.slice(4, -1).split(",").includes(String(r[key])));
      else if (filter.startsWith("eq.")) rows = rows.filter(r => String(r[key]) === filter.slice(3));
      else if (filter.startsWith("neq.")) rows = rows.filter(r => String(r[key]) !== filter.slice(4));
    }
    return response(rows);
  });
  const execute = async (action = "preview-invoice", extra = {}, role = "Owner") => {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
    await maintenance({ method: "POST", headers: {}, appClaims: { role, name: "Owner fixture" }, body: { action, client_id: dupoin.client_id, log_ids: state.maintenance_logs.map(l => l.id), ...extra } }, res);
    return res;
  };
  return { state, requests, execute };
}

describe("maintenance B2B API — price book and fail-closed billing", () => {
  it("52-asset preview reads contract prices/type/PK and makes zero writes", async () => {
    const { execute, requests } = setup();
    const res = await execute();
    expect(res.statusCode).toBe(200); expect(res.body.total).toBe(15600000);
    expect(res.body.line_items.filter(l => l.included_in_service && l.price === 0)).toHaveLength(12);
    expect(requests.every(r => r.method === "GET")).toBe(true);
    expect(requests.some(r => r.table === "maintenance_client_prices")).toBe(true);
  });
  it("create uses the same preview and exactly one atomic RPC; canonical PDF lines are saved", async () => {
    const { execute, requests } = setup();
    const preview = await execute();
    const saved = await execute("create-invoice", { expected_quote: preview.body.quote_key });
    expect(saved.statusCode).toBe(200); expect(saved.body.total).toBe(preview.body.total);
    const writes = requests.filter(r => r.method !== "GET");
    expect(writes).toHaveLength(1); expect(writes[0].table).toBe("create_maintenance_invoice_atomic");
    expect(JSON.parse(writes[0].body.p_invoice.materials_detail)).toEqual(preview.body.line_items);
    expect(writes[0].body.p_snapshot.prices).toHaveLength(7);
  });
  it("changing a tariff after preview rejects create without writing", async () => {
    const { execute, state, requests } = setup();
    const preview = await execute();
    state.maintenance_client_prices[0].unit_price = 500000;
    const res = await execute("create-invoice", { expected_quote: preview.body.quote_key });
    expect(res.statusCode).toBe(409);
    expect(requests.every(r => r.method === "GET")).toBe(true);
  });
  it.each([undefined, "old-quote"])("create without a current preview %s is blocked", async expected_quote => {
    const { execute, requests } = setup();
    expect((await execute("create-invoice", { expected_quote })).statusCode).toBe(409);
    expect(requests.every(r => r.method === "GET")).toBe(true);
  });
  it.each(["maintenance_client_prices", "maintenance_logs", "maintenance_units", "price_list", "orders", "invoices"])("HTTP failure for %s stops billing instead of guessing", async failTable => {
    const { execute, state, requests } = setup({ failTable });
    state.maintenance_logs[0].order_id = "JOB-1";
    expect((await execute()).statusCode).toBe(503);
    expect(requests.every(r => r.method === "GET")).toBe(true);
  });
  it("a malformed source response is blocked", async () => {
    const { execute } = setup({ invalidTable: "maintenance_client_prices" });
    expect((await execute()).statusCode).toBe(503);
  });
  it.each(["invoiced", "invoice_id"])("stored %s blocks billed logs", async field => {
    const { execute, state, requests } = setup();
    state.maintenance_logs[0][field] = field === "invoiced" ? true : "INV-EXISTING";
    const res = await execute();
    expect(res.statusCode).toBe(409); expect(res.body.blocked_log_ids).toContain(state.maintenance_logs[0].id);
    expect(requests.every(r => r.method === "GET")).toBe(true);
  });
  it("regular job invoice blocks B2B rebilling even if the log flag is still false", async () => {
    const { execute, state } = setup();
    state.maintenance_logs[0].order_id = "JOB-1";
    state.invoices = [{ id: "INV-EXISTING", job_id: "JOB-1", status: "PAID" }];
    expect((await execute()).statusCode).toBe(409);
  });
  it("merged invoice linked via orders.invoice_id also blocks rebilling", async () => {
    const { execute, state } = setup();
    state.maintenance_logs[0].order_id = "JOB-1";
    state.orders = [{ id: "JOB-1", invoice_id: "INV-MERGED", status: "COMPLETED" }];
    state.invoices = [{ id: "INV-MERGED", job_id: null, status: "UNPAID" }];
    expect((await execute()).statusCode).toBe(409);
  });
  it("even an order without any invoice must use report verification, not B2B", async () => {
    const { execute, state, requests } = setup();
    state.maintenance_logs[0].order_id = "JOB-UNVERIFIED";
    state.orders = [{ id: "JOB-UNVERIFIED", invoice_id: null, status: "REPORT_SUBMITTED" }];
    const res = await execute();
    expect(res.statusCode).toBe(409); expect(res.body.error).toContain("verifikasi laporan");
    expect(requests.every(r => r.method === "GET")).toBe(true);
  });
  it("foreign log and foreign asset are not billed under this customer", async () => {
    const { execute, state } = setup();
    state.maintenance_logs[0].client_id = id(999);
    expect((await execute()).statusCode).toBe(400);
    state.maintenance_logs[0].client_id = dupoin.client_id;
    state.maintenance_units[0].client_id = id(999);
    expect((await execute()).statusCode).toBe(400);
  });
  it("missing VRV prices are not replaced by Split/Duct prices", async () => {
    const { execute } = setup({ maintenance_client_prices: [], price_list: [{ service: "Cleaning", type: "AC Split Duct 4PK", price: 400000, is_active: true }] });
    expect((await execute()).statusCode).toBe(422);
  });
  it.each(["Teknisi", "Helper"])("%s cannot preview/create financial data", async role => {
    const { execute, requests } = setup();
    expect((await execute("preview-invoice", {}, role)).statusCode).toBe(403);
    expect((await execute("create-invoice", {}, role)).statusCode).toBe(403);
    expect(requests).toEqual([]);
  });
  it("duplicates/unknown IDs and an oversized selection are rejected before writes", async () => {
    const { execute, state } = setup();
    const one = state.maintenance_logs[0].id;
    for (const log_ids of [[one, one], ["bad-id"], [], [id(999)], Array.from({ length: 201 }, (_, i) => id(1000 + i))]) {
      expect((await execute("preview-invoice", { log_ids })).statusCode).toBe(400);
    }
  });
  it("an unapplied migration is visible and never falls back to non-atomic inserts", async () => {
    const { execute, requests } = setup({ rpcFailure: { code: "PGRST202" } });
    const preview = await execute();
    const res = await execute("create-invoice", { expected_quote: preview.body.quote_key });
    expect(res.statusCode).toBe(503); expect(res.body.error).toContain("208");
    expect(requests.filter(r => r.method !== "GET").map(r => r.table)).toEqual(["create_maintenance_invoice_atomic"]);
  });
});
