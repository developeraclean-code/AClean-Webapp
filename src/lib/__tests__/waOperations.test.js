import { describe, it, expect, vi } from "vitest";
import { allocatePayment, paymentCandidates, suggestWaSlots, serviceFollowup, fromJakartaInput, toJakartaInput, loadWaDay } from "../waOperations.js";
import { deliverWorkspaceMessage, dispatchWorkspaceMessage, validateWorkspacePayload } from "../../../api/_wa-workspace.js";

const inv = (id,total,paid=0) => ({id,phone:"6281234567890",status:paid?"PARTIAL_PAID":"UNPAID",total,paid_amount:paid});
const now = new Date("2026-10-04T03:10:00Z");
const base = {date:"2026-10-05",service:"Cleaning",units:3,technicians:[{name:"Rian",role:"Teknisi"}],orders:[],absences:[],duration:()=>1.5,now};

describe("WA operational planning",()=>{
  it("allocates one transfer to outstanding balances and never beyond them",()=>{
    expect(allocatePayment([inv("A",500,200),inv("B",500)],600)).toEqual([{invoice_id:"A",amount:300},{invoice_id:"B",amount:300}]);
    expect(allocatePayment([inv("A",100)],200)).toEqual([{invoice_id:"A",amount:100}]);
    expect(allocatePayment([inv("A",100)],-1)).toEqual([]);
  });
  it("never recommends a different phone even if nominal/ID matches",()=>{
    const rows=[inv("A",500,200),{...inv("B",300),phone:"6288888888888"}];
    expect(paymentCandidates(rows,{phone:"081234567890",amount:300,invoice_id:"B"}).map(i=>i.id)).toEqual(["A"]);
  });
  it("uses remaining balances to rank candidates",()=>expect(paymentCandidates([inv("A",500),inv("B",500,200)],{phone:"6281234567890",amount:300})[0].id).toBe("B"));
  it("accounts for helper assignments, attendance, full days and unknown start times",()=>{
    const job={date:base.date,helper:"Rian",status:"CONFIRMED",time:"09:00",time_end:"11:00"};
    expect(suggestWaSlots({...base,orders:[job]})[0].time).toBe("11:00");
    expect(suggestWaSlots({...base,absences:[{date:base.date,teknisi:"Rian",status:"SAKIT"}]})).toEqual([]);
    expect(suggestWaSlots({...base,orders:Array(6).fill(job)})).toEqual([]);
    expect(suggestWaSlots({...base,orders:[{...job,time:null}]})).toEqual([]);
    expect(suggestWaSlots({...base,duration:()=>12})).toEqual([]);
  });
  it("does not offer past slots or dates",()=>{
    expect(suggestWaSlots({...base,date:"2026-10-03"})).toEqual([]);
    expect(suggestWaSlots({...base,date:"2026-10-04"})[0].time).toBe("10:30");
  });
  it("uses completed cleaning dates instead of pending future orders",()=>{
    const orders=[{date:"2026-05-01",status:"PAID",service:"Cleaning"},{date:"2026-10-05",status:"CANCELLED",service:"Cleaning"}];
    expect(serviceFollowup(orders,[],"a",now)).toMatchObject({last:"2026-05-01",eligible:true});
    expect(serviceFollowup([...orders,{status:"CONFIRMED"}],[],"a",now).eligible).toBe(false);
    expect(serviceFollowup(orders,[{kind:"SERVICE_REMINDER",customer_id:"a",created_at:"2026-10-01",status:"UNCERTAIN"}],"a",now).eligible).toBe(false);
    expect(serviceFollowup(orders,[{kind:"SERVICE_REMINDER",customer_id:"b",created_at:"2026-10-01",status:"ACCEPTED"}],"a",now).eligible).toBe(true);
  });
  it("roundtrips reminders explicitly in Jakarta time",()=>{
    expect(fromJakartaInput("2026-10-05T09:00")).toBe("2026-10-05T02:00:00.000Z");
    expect(toJakartaInput("2026-10-05T02:00:00Z")).toBe("2026-10-05T09:00");
  });
  it("fails closed when the live scheduling lookup fails",async()=>{
    const q={select:()=>q,eq:()=>q,limit:()=>Promise.resolve({error:{message:"offline"}})};
    await expect(loadWaDay({from:()=>q},base.date)).rejects.toThrow("offline");
  });
});

describe("Durable WhatsApp delivery",()=>{
  const payload={phone:"6281234567890",message:"Halo",kind:"TEXT"};
  it("distinguishes accepted, explicit rejection, ambiguous response and timeout without retry",async()=>{
    for(const [body,status] of [[{status:true,id:["provider1"]},"ACCEPTED"],[{status:false,reason:"offline"},"FAILED"],[{},"UNCERTAIN"]]){
      const fn=vi.fn().mockResolvedValue({ok:true,json:async()=>body});
      expect((await deliverWorkspaceMessage(payload,{token:"mock",fetchImpl:fn})).status).toBe(status);
      expect(fn).toHaveBeenCalledTimes(1);
    }
    const fn=vi.fn().mockRejectedValue(new Error("timeout"));
    expect((await deliverWorkspaceMessage(payload,{token:"mock",fetchImpl:fn})).status).toBe("UNCERTAIN");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("sends PDF as one request and never falls back to duplicate text",async()=>{
    const fn=vi.fn().mockRejectedValue(new Error("timeout"));
    await deliverWorkspaceMessage({...payload,url:"https://example.test/document.pdf",filename:"Invoice.pdf"},{token:"mock",fetchImpl:fn});
    expect(JSON.parse(fn.mock.calls[0][1].body)).toMatchObject({url:"https://example.test/document.pdf",filename:"Invoice.pdf"});
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("replays existing send IDs without calling the gateway",async()=>{
    const deliver=vi.fn();const db={rpc:vi.fn().mockResolvedValue({data:{claimed:false,row:{id:"1",status:"SENDING"}}})};
    expect(await dispatchWorkspaceMessage(db,"1",payload,"Admin",deliver)).toMatchObject({status:"SENDING",replayed:true});
    expect(deliver).not.toHaveBeenCalled();
  });
  it("does not send if durable claim fails; audit failure preserves the provider outcome",async()=>{
    const deliver=vi.fn().mockResolvedValue({status:"ACCEPTED"});
    await expect(dispatchWorkspaceMessage({rpc:vi.fn().mockResolvedValue({error:{message:"DB down"}})},"1",payload,"Admin",deliver)).rejects.toThrow("DB down");
    expect(deliver).not.toHaveBeenCalled();
    const db={rpc:vi.fn().mockResolvedValueOnce({data:{claimed:true,row:{id:"1",status:"SENDING"}}}).mockResolvedValueOnce({error:{message:"DB down"}})};
    expect(await dispatchWorkspaceMessage(db,"1",payload,"Admin",deliver)).toMatchObject({status:"ACCEPTED",audit_pending:true});
    expect(deliver).toHaveBeenCalledTimes(1);
  });
  it("validates attachments and rejects unapproved/mismatched documents",async()=>{
    const q={select:()=>q,eq:()=>q,single:()=>Promise.resolve({data:{phone:"6288888888888",status:"UNPAID"}})};
    await expect(validateWorkspacePayload({from:()=>q},{...payload,kind:"INVOICE",document_id:"INV",url:"https://example.test/a.pdf",filename:"a.pdf"})).rejects.toThrow("nomor");
    await expect(validateWorkspacePayload({}, {...payload,url:"https://example.test/a.pdf"})).rejects.toThrow("Lampiran");
    await expect(validateWorkspacePayload({}, {...payload,message:"x".repeat(4097)})).rejects.toThrow("tidak valid");
  });
});

describe("Scheduling and reminder edge cases",()=>{
  it("respects boolean attendance overrides and rejects fractional units",()=>{
    expect(suggestWaSlots({...base,absences:[{date:base.date,teknisi:"Rian",is_available:false}]})).toEqual([]);
    expect(suggestWaSlots({...base,units:1.5})).toEqual([]);
    expect(suggestWaSlots({...base,orders:[{date:base.date,teknisi:"Rian",status:"CONFIRMED",time:"25:00"}]})).toEqual([]);
  });
  it("honors the legacy automatic-contact marker used by cron",()=>{
    expect(serviceFollowup([{date:"2026-01-01",status:"COMPLETED",service:"Cleaning"}],[],"a",now,"2026-10-01")).toMatchObject({eligible:false,legacyBlocked:true});
  });
});
