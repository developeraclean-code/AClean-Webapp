import { afterEach, describe, expect, it, vi } from "vitest";
import { sendToARA } from "../ara.js";

afterEach(()=>vi.unstubAllGlobals());
function context() {
  const messages=[];
  return {messages,araMessages:[],currentUser:{role:"Owner"},_apiHeaders:async()=>({}),buildAraContext:()=>({}),
    setAraMessages:vi.fn(v=>{if(typeof v==="function"){const next=v(messages);messages.splice(0,messages.length,...next);}else messages.splice(0,messages.length,...v);}),
    setAraInput:vi.fn(),setAraLoading:vi.fn(),setAraImageData:vi.fn(),setAraImageType:vi.fn(),setAraImagePreview:vi.fn(),setLlmStatus:vi.fn(),
    addAgentLog:vi.fn(),araBottomRef:{current:null},markPaid:vi.fn(),approveInvoice:vi.fn(),sendWA:vi.fn(),insertInvoice:vi.fn(),supabase:{from:vi.fn()},
  };
}
describe("ARA client cannot mutate business data",()=>{
  it.each(["MARK_PAID","APPROVE_INVOICE","UPDATE_INVOICE","CREATE_INVOICE","SEND_WA","CREATE_ORDER","BULK_CREATE_ORDER","RESCHEDULE_ORDER","UPDATE_ORDER_STATUS","CANCEL_ORDER","DISPATCH_WA","UPDATE_STOCK","CREATE_EXPENSE","SEND_REMINDER","MARK_INVOICE_OVERDUE"])("%s becomes a reviewable proposal only",async type=>{
    const ctx=context();vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({reply:`Berhasil! [ACTION]{"type":"${type}","id":"TEST"}[/ACTION]`})}));
    await sendToARA("Bantu review",ctx);
    expect(ctx.messages.at(-1).proposals).toHaveLength(1);expect(ctx.messages.at(-1).content).not.toContain("Berhasil!");
    for(const key of ["markPaid","approveInvoice","sendWA","insertInvoice"])expect(ctx[key]).not.toHaveBeenCalled();expect(ctx.supabase.from).not.toHaveBeenCalled();
  });
  it("locks duplicate clicks before React rerenders",async()=>{
    let resolve;const fetch=vi.fn(()=>new Promise(r=>{resolve=r;}));vi.stubGlobal("fetch",fetch);const ctx=context();
    const a=sendToARA("cek",ctx),b=sendToARA("cek",ctx);await Promise.resolve();resolve({ok:true,json:async()=>({reply:"Draf"})});await Promise.all([a,b]);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retains image on error, permits image-only requests and reports API failure",async()=>{
    const ctx={...context(),araImageData:"base64",araImageType:"image/png"};vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:503,json:async()=>({error:"quota"})}));
    await sendToARA("",ctx);expect(ctx.messages.at(-1).content).toContain("quota");expect(ctx.setAraImageData).not.toHaveBeenCalled();expect(ctx.setLlmStatus).toHaveBeenCalledWith("error");
  });
});
