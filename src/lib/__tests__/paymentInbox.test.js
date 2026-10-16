import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPendingPaymentSuggestions, startPaymentInboxPolling } from "../paymentInbox.js";

afterEach(() => vi.useRealTimers());
function harness(load) {
  vi.useFakeTimers();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = Object.assign(new EventTarget(), { setInterval, clearInterval, setTimeout, clearTimeout });
  const onData = vi.fn(), onNew = vi.fn(), onState = vi.fn();
  const controller = startPaymentInboxPolling({ load, onData, onNew, onState, doc, win });
  return { doc, win, onData, onNew, onState, ...controller };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
describe("payment inbox 24h visible-tab polling", () => {
  it.each(["2026-10-14T20:00:00+07:00", "2026-10-11T10:00:00+07:00"])("starts at night / Sunday: %s", async date => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(date));
    const load = vi.fn().mockResolvedValue([]), h = harness(load);
    await flush(); expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000); expect(load).toHaveBeenCalledTimes(2); h.stop();
  });
  it("continues across midnight and the next working morning without re-login", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T23:59:00+07:00"));
    const load = vi.fn().mockResolvedValue([]), h = harness(load);
    await flush(); await vi.advanceTimersByTimeAsync(9 * 3600_000);
    expect(load).toHaveBeenCalledTimes(109); h.stop();
  });
  it("pauses hidden tabs, resumes on visibility, and coalesces focus/online events", async () => {
    const load = vi.fn().mockResolvedValue([]), h = harness(load); await flush();
    h.doc.hidden = true; await vi.advanceTimersByTimeAsync(600_000); expect(load).toHaveBeenCalledTimes(1);
    h.doc.hidden = false; h.doc.dispatchEvent(new Event("visibilitychange")); h.win.dispatchEvent(new Event("focus")); h.win.dispatchEvent(new Event("online"));
    await flush(); expect(load).toHaveBeenCalledTimes(2); h.stop();
  });
  it("notifies a new ID even if it is older than 125 seconds, only once", async () => {
    const old = { id: "old" }, fresh = { id: "new", created_at: "2026-01-01" };
    const load = vi.fn().mockResolvedValueOnce([old]).mockResolvedValue([fresh, old]), h = harness(load);
    await flush(); expect(h.onNew).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300_000); expect(h.onNew).toHaveBeenCalledWith([fresh]);
    await vi.advanceTimersByTimeAsync(600_000); expect(h.onNew).toHaveBeenCalledTimes(1); h.stop();
  });
  it("clears resolved entries when the database returns no pending rows", async () => {
    const h = harness(vi.fn().mockResolvedValueOnce([{ id: "x" }]).mockResolvedValue([]));
    await flush(); await h.refresh({ force: true }); expect(h.onData).toHaveBeenLastCalledWith([]); h.stop();
  });
  it("does not discard a good snapshot on failure, reports failures, and recovers", async () => {
    const load = vi.fn().mockResolvedValueOnce([{ id: "x" }]).mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    const h = harness(load); await flush(); await h.refresh({ force: true });
    expect(h.onData).toHaveBeenCalledTimes(1); expect(h.onState).toHaveBeenCalledWith(expect.objectContaining({ error: "offline", failures: 1 }));
    await h.refresh({ force: true }); expect(h.onData).toHaveBeenLastCalledWith([]); h.stop();
  });
  it("deduplicates concurrent refresh and ignores results after logout/unmount", async () => {
    let resolve; const h = harness(vi.fn(() => new Promise(r => { resolve = r; })));
    await flush(); const a = h.refresh({ force: true }), b = h.refresh({ force: true }); expect(a).toBe(b);
    h.stop(); resolve([{ id: "private" }]); await a; expect(h.onData).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(900_000); expect(h.onNew).not.toHaveBeenCalled();
  });
  it("a hung request times out; a late response cannot overwrite a recovered snapshot", async () => {
    let finishOld;
    const load=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;})).mockResolvedValue([{id:"recovered"}]);
    const h=harness(load);await flush();await vi.advanceTimersByTimeAsync(30_000);
    expect(h.onState).toHaveBeenCalledWith(expect.objectContaining({error:expect.stringContaining("timeout")}));
    await h.refresh({force:true});finishOld([{id:"stale"}]);await flush();
    expect(h.onData).toHaveBeenCalledTimes(1);expect(h.onData).toHaveBeenLastCalledWith([{id:"recovered"}]);h.stop();
  });
});
describe("complete payment inbox pagination", () => {
  it("keeps 450 pending rows, never truncating to 20 or 200", async () => {
    const all = Array.from({ length: 450 }, (_, id) => ({ id: String(id) }));
    const chain = { select: vi.fn(function() { return this; }), eq() { return this; }, order() { return this; }, range: vi.fn(async (from, to) => ({ data: all.slice(from, to + 1) })) };
    const supabase = { from: vi.fn(() => chain) };
    expect(await fetchPendingPaymentSuggestions(supabase)).toEqual(all);
    expect(chain.range).toHaveBeenCalledTimes(3); expect(supabase.from).toHaveBeenCalledWith("payment_suggestions");
  });
  it("rejects a partial snapshot when a later page fails", async () => {
    const chain = { select() { return this; }, eq() { return this; }, order() { return this; }, range: vi.fn().mockResolvedValueOnce({ data: Array(200).fill({ id: "x" }) }).mockResolvedValueOnce({ error: new Error("database unavailable") }) };
    await expect(fetchPendingPaymentSuggestions({ from: () => chain })).rejects.toThrow("database unavailable");
  });
});
