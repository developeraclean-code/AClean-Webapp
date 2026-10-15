import { afterEach, describe, expect, it, vi } from "vitest";
import { maintenance } from "../../../api/_handlers/portal.js";
const previous = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };
afterEach(() => {
  globalThis.fetch = previous.fetch;
  for (const [env, value] of [["SUPABASE_URL", previous.url], ["SUPABASE_SERVICE_KEY", previous.key]]) {
    if (value === undefined) delete process.env[env]; else process.env[env] = value;
  }
});
const base = { action: "save-price", client_id: "client-fixture", service_type: "Cuci Rutin", ac_type: "vrv_outdoor", capacity_pk: 34.2, unit_price: 0, included_in_service: true };
async function run(body, role = "Owner") {
  process.env.SUPABASE_URL = "https://fixture.invalid"; process.env.SUPABASE_SERVICE_KEY = "fixture-only";
  const requests = [];
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    requests.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, json: async () => [{ id: "price-fixture", ...(options.body ? JSON.parse(options.body) : base) }] };
  });
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await maintenance({ method: "POST", appClaims: { role }, headers: {}, body }, res);
  return { res, requests };
}
describe("maintenance price API — explicit included service", () => {
  it("harga outdoor Rp0 disimpan eksplisit; tidak mengakses invoice/uang masuk", async () => {
    const { res, requests } = await run(base);
    expect(res.statusCode).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST", body: { unit_price: 0, included_in_service: true, capacity_pk: 34.2 } });
    expect(requests[0].url).toContain("/maintenance_client_prices");
  });
  it.each([[-1, false], ["Infinity", false], ["NaN", false], [1, true]])("menolak harga invalid %s sebelum ada write", async (unit_price, included_in_service) => {
    const { res, requests } = await run({ ...base, unit_price, included_in_service });
    expect(res.statusCode).toBe(400); expect(requests).toEqual([]);
  });
  it("termasuk penawaran harus menunjuk tipe tertentu", async () => {
    const { res, requests } = await run({ ...base, ac_type: "" });
    expect(res.statusCode).toBe(400); expect(requests).toEqual([]);
  });
  it.each(["NaN", "Infinity", -1, 0])("kapasitas invalid %s tidak berubah diam-diam menjadi wildcard", async capacity_pk => {
    const { res, requests } = await run({ ...base, capacity_pk });
    expect(res.statusCode).toBe(400); expect(requests).toEqual([]);
  });
  it("Admin boleh atur harga, field flag pada update browser lama tidak ditimpa false diam-diam", async () => {
    const body = { ...base, id: "price-existing", unit_price: 450000 };
    delete body.included_in_service;
    const { res, requests } = await run(body, "Admin");
    expect(res.statusCode).toBe(200);
    expect(requests[0].method).toBe("PATCH");
    expect(requests[0].body).not.toHaveProperty("included_in_service");
  });
  it.each(["Teknisi", "Helper"])("role %s tidak boleh mengubah tarif", async role => {
    const { res, requests } = await run(base, role);
    expect(res.statusCode).toBe(403); expect(requests).toEqual([]);
  });
});
