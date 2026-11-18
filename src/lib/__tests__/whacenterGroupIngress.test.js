import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ classify: vi.fn(), upload: vi.fn(), customer: vi.fn() }));
vi.mock("../../../api/_auth.js", async original => ({ ...await original(), checkRateLimit: vi.fn(async () => true) }));
vi.mock("../../../api/_ara-customer.js", () => ({ processAraCustomer: mocks.customer }));
vi.mock("../../../api/_ai-vision.js", async original => ({ ...await original(), classifyImage: mocks.classify }));
vi.mock("../../../api/_r2-upload.js", async original => ({ ...await original(), hasR2Config: () => true, uploadBufferToR2: mocks.upload }));
import { receiveWa } from "../../../api/_handlers/wa.js";
import { clearWaProviderCache } from "../../../api/_wa-provider.js";

const group = "120000000001@g.us", phone = "6281234567890";
const photo = { from: phone, pushName: "Synthetic Rey", is_group: true, id_group: group, message_type: "media",
  media: "https://app.whacenter.com/api/media?path=synthetic.jpg", message: "Bon pengeluaran harian", timestamp: "2026-11-16 10:00:00" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
let requests, expenses, locks, monitored, registered, expenseAi, selected;
const run = async body => {
  const res = { code: null, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader: vi.fn() };
  await receiveWa({ method: "POST", headers: {}, query: selected === "whacenter" ? { route: "whacenter-webhook", token: "synthetic-hook" } : {}, body }, res);
  return res;
};
beforeEach(() => {
  clearWaProviderCache(); requests = []; expenses = []; locks = new Set(); monitored = registered = expenseAi = true; selected = "whacenter";
  for (const [key, value] of Object.entries({ SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_KEY: "synthetic",
    WHACENTER_DEVICE_ID: "synthetic-device", WHACENTER_WEBHOOK_SECRET: "synthetic-hook", FONNTE_WEBHOOK_SECRET: "",
    FONNTE_TOKEN: "synthetic-fonnte", OWNER_PHONE: "", OPENAI_API_KEY: "synthetic-never-used", LLM_API_KEY: "", ANTHROPIC_API_KEY: "" })) vi.stubEnv(key, value);
  mocks.customer.mockReset(); mocks.upload.mockReset().mockResolvedValue({ ok: true, url: "/api/foto?key=wa-group/synthetic.jpg" });
  mocks.classify.mockReset().mockResolvedValue({ intent: "expense", confidence: "HIGH", model: "synthetic",
    data: { amount: 20000, date: new Date().toISOString().slice(0, 10), category: "petty_cash", subcategory: "Bensin Motor", merchant: "Synthetic" } });
  for (const method of ["info", "log", "warn", "error"]) vi.spyOn(console, method).mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (raw, options = {}) => {
    const url = new URL(raw), method = options.method || "GET", body = options.body ? JSON.parse(options.body) : null;
    requests.push({ path: url.pathname, search: url.search, method, body });
    if (["app.whacenter.com", "api.fonnte.com"].includes(url.hostname)) return new Response(Buffer.alloc(20000, 1), { headers: { "content-type": "image/jpeg" } });
    if (url.hostname !== "db.invalid") throw new Error("Unexpected external call");
    if (url.pathname.endsWith("/capture_wa_webhook_214")) return json({ receipt_id: "receipt", received_at: new Date().toISOString(), duplicate: false, intake_status: "GROUP_RECEIVED", message_id: null, media_job: null });
    if (url.pathname.endsWith("/app_settings")) return json([{ key: "wa_provider", value: selected }]);
    if (url.pathname.endsWith("/user_profiles")) return json(registered ? [{ name: "Synthetic Rey", phone, role: "Teknisi", active: true }] : []);
    if (url.pathname.endsWith("/wa_monitored_groups")) return json(monitored ? [{ group_id: group, group_name: "Synthetic Finance", enabled: true, capture_all: true, ai_expense_enabled: expenseAi }] : []);
    if (url.pathname.endsWith("/wa_webhook_dedup")) {
      if (locks.has(body.dedup_key)) return json({}, 409);
      locks.add(body.dedup_key); return json({}, 201);
    }
    if (url.pathname.endsWith("/expenses")) {
      if (method === "GET") return json(expenses.map(e => ({ id: e.id })));
      if (method !== "POST") throw new Error("Unexpected expense mutation");
      const row = { id: "00000000-0000-4000-8000-000000000001", ...body }; expenses.push(row); return json([row], 201);
    }
    if (url.pathname.endsWith("/ai_extractions")) return json(method === "POST" ? [{ id: 1 }] : []);
    if (["wa_group_logs", "wa_group_discovery", "wa_ai_observations"].some(table => url.pathname.endsWith("/" + table))) return json([]);
    throw new Error("Unexpected DB operation: " + url.pathname);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("routes a modern group bon through group Vision and saves one pending expense, never a personal payment", async () => {
  const res = await run(photo);
  expect(res.body).toMatchObject({ status: "group_processed", ai: "ok:expense" });
  expect(mocks.classify).toHaveBeenCalledWith(expect.objectContaining({ sender: { phone, name: "Synthetic Rey" } }));
  expect(expenses).toEqual([expect.objectContaining({ amount: 20000, validation_status: "PENDING_AI", ai_extraction_id: 1 })]);
  expect(requests.find(r => r.path.endsWith("/capture_wa_webhook_214")).body.p_event).toMatchObject({ is_group: true, sender: group, phone: null, capture_media: false });
  expect(requests.some(r => /wa_payment_media_jobs|payment_suggestions|invoice_payments/.test(r.path))).toBe(false);
  expect(mocks.customer).not.toHaveBeenCalled();
});
it("records Bensin 20k caption as pending exactly once across webhook replay", async () => {
  const body = { ...photo, message: "Bensin 20k motor Rey" };
  expect((await run(body)).body.status).toBe("group_processed");
  expect((await run(body)).body.status).toBe("group_processed");
  expect(expenses).toHaveLength(1);
  expect(expenses[0]).toMatchObject({ amount: 20000, subcategory: "Bensin Motor", validation_status: "PENDING_AI" });
  expect(mocks.classify).not.toHaveBeenCalled();
});
it("keeps groups outside the whitelist out of costs and AI", async () => {
  monitored = false;
  expect((await run(photo)).body.reason).toBe("group_not_monitored");
  expect(expenses).toHaveLength(0); expect(mocks.classify).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
});
it("does not process an unregistered group member", async () => {
  registered = false;
  expect((await run(photo)).body.reason).toBe("not_registered");
  expect(expenses).toHaveLength(0); expect(mocks.classify).not.toHaveBeenCalled();
});
it.each([{ from: "12345678901234", lid: "12345678901234", from_jid: "12345678901234@lid" }, { id_group: undefined }])("stops an unresolved member or missing group ID after durable intake", async patch => {
  expect((await run({ ...photo, ...patch })).body).toMatchObject({ needs_review: true, automated_reply: false });
  expect(requests).toHaveLength(2); // provider selection + durable capture only
  expect(expenses).toHaveLength(0); expect(mocks.classify).not.toHaveBeenCalled();
});
it("respects the group Vision expense toggle", async () => {
  expenseAi = false;
  expect((await run(photo)).body.status).toBe("group_processed");
  expect(mocks.classify).not.toHaveBeenCalled(); expect(expenses).toHaveLength(0);
});
it("preserves the Fonnte group expense path", async () => {
  selected = "fonnte";
  const res = await run({ sender: group, member: phone, name: "Synthetic Rey", type: "image", url: "https://api.fonnte.com/synthetic.jpg", message: "Bon pengeluaran harian", timestamp: "1794826800" });
  expect(res.body.status).toBe("group_processed");
  expect(expenses).toEqual([expect.objectContaining({ amount: 20000, validation_status: "PENDING_AI" })]);
});
