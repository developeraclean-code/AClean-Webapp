import { afterEach, expect, it, vi } from "vitest";
import { startWaConversationPolling } from "../waConversationPolling.js";
afterEach(() => vi.useRealTimers());
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
it("refreshes on Sunday night, independent of business hours or a WA Monitor flag", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T23:00:00+07:00"));
  const load=vi.fn().mockResolvedValue([{phone:"628000000000"}]),onData=vi.fn();
  const poll=startWaConversationPolling({load,onData,visibility:new EventTarget(),events:new EventTarget()});
  await settle(); await vi.advanceTimersByTimeAsync(60000);
  expect(load).toHaveBeenCalledTimes(2);expect(onData).toHaveBeenCalledTimes(2);poll.stop();
});
it("stops hidden-tab requests and resumes on visibility/focus/online without concurrent reads", async () => {
  vi.useFakeTimers();const visibility=new EventTarget(),events=new EventTarget();visibility.hidden=true;
  let resolve;const load=vi.fn(()=>new Promise(done=>{resolve=done;}));const onData=vi.fn();
  const poll=startWaConversationPolling({load,onData,visibility,events});await vi.advanceTimersByTimeAsync(60000);expect(load).not.toHaveBeenCalled();
  visibility.hidden=false;visibility.dispatchEvent(new Event("visibilitychange"));events.dispatchEvent(new Event("focus"));events.dispatchEvent(new Event("online"));
  await settle();expect(load).toHaveBeenCalledTimes(1);resolve([]);await settle();expect(onData).toHaveBeenCalledWith([]);poll.stop();
});
it("keeps the previous snapshot on error, reports the failure and clears it after recovery", async () => {
  vi.useFakeTimers();const load=vi.fn().mockResolvedValueOnce([{phone:"628000000000"}]).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]),onData=vi.fn(),onState=vi.fn();
  const poll=startWaConversationPolling({load,onData,onState});await poll.refresh({force:true});await poll.refresh({force:true});
  expect(onData).toHaveBeenCalledTimes(1);expect(onState).toHaveBeenCalledWith({error:"offline"});
  await poll.refresh({force:true});expect(onData).toHaveBeenLastCalledWith([]);expect(onState).toHaveBeenCalledWith(expect.objectContaining({error:""}));poll.stop();
});
it("does not commit a late response after the Workspace is closed", async () => {
  let resolve;const onData=vi.fn();const poll=startWaConversationPolling({load:()=>new Promise(done=>{resolve=done;}),onData});
  await settle();poll.stop();resolve([]);await settle();expect(onData).not.toHaveBeenCalled();
});
it("can recover even if the data loader throws synchronously",async()=>{
  const load=vi.fn().mockImplementationOnce(()=>{throw new Error("sync offline");}).mockResolvedValueOnce([]),onData=vi.fn();
  const poll=startWaConversationPolling({load,onData});await poll.refresh({force:true});await poll.refresh({force:true});
  expect(load).toHaveBeenCalledTimes(2);expect(onData).toHaveBeenCalledWith([]);poll.stop();
});
