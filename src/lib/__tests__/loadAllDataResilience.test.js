import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAllData } from "../loadAllData.js";
import { cachedFetch, invalidateCache } from "../fetchCache.js";
vi.mock("../perfMetrics.js", () => ({ flushPerfMetrics: vi.fn(), recordPerfMetric: vi.fn() }));
const fetchNames = ["fetchAppSettings", "fetchAraBrain", "fetchCustomers", "fetchDispatchLogs", "fetchInventory", "fetchInventoryTransactions", "fetchInventoryUnits", "fetchInvoices", "fetchOrders", "fetchPayments", "fetchPriceList", "fetchServiceReports", "fetchUserAccounts", "fetchUserProfiles", "fetchWaConversations", "fetchBootstrapInvoices", "fetchBootstrapOrders", "fetchBootstrapServiceReports"];
function context(overrides = {}) {
  const target = { ...Object.fromEntries(fetchNames.map(key => [key, vi.fn(async () => ({ data: [], error: null }))])),
    _ls: (_key, fallback) => fallback, _lsSave: vi.fn(), cachedFetch,
    currentUser: { id: "SIMULATED-OWNER", role: "Owner" }, today: "2026-10-19", supabase: {},
    parseInvoiceRow: row => row, parseLaporanRow: row => row, dedupReportsByJob: rows => rows,
    buildPriceListFromDB: rows => rows, onCriticalReady: vi.fn(), ...overrides };
  return new Proxy(target, { get(object, key) {
    if (!(key in object) && typeof key === "string" && key.startsWith("set")) object[key] = vi.fn();
    return object[key];
  } });
}
beforeEach(() => invalidateCache());
describe("bootstrap resilience", () => {
  it("reads profiles once and supplies both technician choices and account management", async () => {
    const ctx = context();
    ctx.fetchUserAccounts.mockResolvedValue({ data: [{ id: "SIM-T", role: "Teknisi", name: "Synthetic technician" }], error: null });
    await loadAllData(ctx);
    expect(ctx.fetchUserAccounts).toHaveBeenCalledOnce(); expect(ctx.fetchUserProfiles).not.toHaveBeenCalled();
    expect(ctx.setTeknisiData).toHaveBeenCalledWith([expect.objectContaining({ id: "SIM-T" })]);
    expect(ctx.setUserAccounts).toHaveBeenCalledWith([expect.objectContaining({ id: "SIM-T" })]);
  });
  it("keeps all 200 simulated jobs/invoices and their original amounts", async () => {
    const jobs = Array.from({ length: 200 }, (_, i) => ({ id: `SIM-${i}`, date: "2026-10-19" }));
    const invoices = jobs.map((job, i) => ({ id: `SIM-INV-${i}`, job_id: job.id, total: 100_000 + i, remaining_amount: 50_000 + i }));
    const ctx = context({ bootstrapMode: "critical" });
    ctx.fetchBootstrapOrders.mockResolvedValue({ data: jobs });
    ctx.fetchBootstrapInvoices.mockResolvedValue({ data: invoices });
    ctx.fetchBootstrapServiceReports.mockResolvedValue({ data: jobs.map(job => ({ id: `REPORT-${job.id}`, job_id: job.id })) });
    expect(await loadAllData(ctx)).toEqual({ ok: true, failed: [] });
    expect(ctx.setOrdersData).toHaveBeenCalledWith(jobs); expect(ctx.setInvoicesData).toHaveBeenLastCalledWith(invoices);
    expect(ctx.onCriticalReady).toHaveBeenCalledWith({ failed: [] });
  });
  it("stops secondary fan-out on a total outage and does not replace data with empty arrays", async () => {
    const ctx = context({ bootstrapMode: "critical" });
    for (const name of ["fetchBootstrapOrders", "fetchBootstrapInvoices", "fetchBootstrapServiceReports", "fetchInventory"]) ctx[name].mockResolvedValue({ error: { message: "503" } });
    expect((await loadAllData(ctx)).ok).toBe(false);
    expect(ctx.fetchAppSettings).not.toHaveBeenCalled(); expect(ctx.fetchUserAccounts).not.toHaveBeenCalled();
    expect(ctx.setOrdersData).not.toHaveBeenCalled(); expect(ctx.setInvoicesData).not.toHaveBeenCalled();
    expect(ctx.onCriticalReady).toHaveBeenCalledWith({ failed: ["pekerjaan", "invoice", "laporan", "inventori"] });
  });
  it("displays partial failure and allows a fresh read after recovery, without caching the error", async () => {
    const ctx = context({ bootstrapMode: "critical" });
    ctx.fetchBootstrapInvoices.mockResolvedValueOnce({ error: { message: "timeout" } }).mockResolvedValue({ data: [{ id: "RECOVERED" }] });
    expect((await loadAllData(ctx)).failed).toEqual(["invoice"]);
    expect(ctx.setInvoicesData).not.toHaveBeenCalled();
    expect((await loadAllData(ctx)).ok).toBe(true);
    expect(ctx.fetchBootstrapInvoices).toHaveBeenCalledTimes(2);
    expect(ctx.setInvoicesData).toHaveBeenLastCalledWith([{ id: "RECOVERED" }]);
  });
  it("ignores initial results from a disposed/account-switched screen", async () => {
    const ctx = context({ isActive: () => false });
    await loadAllData(ctx);
    expect(ctx.setOrdersData).not.toHaveBeenCalled(); expect(ctx.fetchAppSettings).not.toHaveBeenCalled();
  });
  it("ignores late secondary results from a disposed session", async () => {
    let active = true;
    const ctx = context({ isActive: () => active });
    ctx.fetchPayments.mockImplementation(async () => { active = false; return { data: [{ id: "PRIVATE-OLD" }] }; });
    await loadAllData(ctx);
    expect(ctx.setPaymentsData).not.toHaveBeenCalled(); expect(ctx.setUserAccounts).not.toHaveBeenCalled();
  });
});
