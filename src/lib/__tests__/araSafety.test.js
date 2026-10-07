import { describe, it, expect, vi } from "vitest";
import { assessCustomerReply, buildAraSystem, buildCustomerHistory, customerDecision, parseAraProposals, parseAraTraining, resolveAraBrain, trainingForPrompt } from "../araPolicy.js";
import { processAraCustomer } from "../../../api/_ara-customer.js";
import { ARA_REPLY_SIGNATURE, ARA_PAYMENT_REPLY, ARA_COMPLAINT_REPLY, formatAraCustomerReply } from "../araPolicy.js";
import { createAraMemoryDb, customerCases, prices, training } from "../../../scripts/lib/ara-fixtures.mjs";

const base = {phone:"628000000001",message:"Halo",sourceKey:"test",chatbotOn:true,autoOn:false};
describe("ARA training and policy",()=>{
  it("attributes customer replies exactly once without labelling an empty response",()=>{
    expect(formatAraCustomerReply("")).toBe("");
    expect(formatAraCustomerReply(`Halo\n${ARA_REPLY_SIGNATURE}\n${ARA_REPLY_SIGNATURE}`)).toBe(`Halo\n\n${ARA_REPLY_SIGNATURE}`);
  });
  it("uses approved payment and complaint wording without assuming every payment question is a receipt",()=>{
    expect(customerDecision("Ini saya sudah transfer DP, tolong dicek.").reply).toBe(ARA_PAYMENT_REPLY);
    expect(customerDecision("Kemarin baru dicuci, sekarang bocor lagi. Masih garansi kan?").reply).toBe(ARA_COMPLAINT_REPLY);
    expect(customerDecision("Nomor rekening untuk bayar DP?").reply).not.toContain("Bukti transfernya");
  });
  it("loads all training categories, rejects malformed/oversized input and ignores disabled rules",()=>{
    expect(trainingForPrompt(training,"harga")).toContain("Permintaan refund");
    expect(trainingForPrompt({...training,auto_reply_rules:[{trigger:"x",response:"SECRET",active:false}]},"x")).not.toContain("SECRET");
    for(const bad of ["{", "[]", {auto_reply_rules:[{trigger:"x"}]}, "x".repeat(80001)]) expect(()=>parseAraTraining(bad)).toThrow();
  });
  it("uses internal SOP when saved brain accidentally contains customer SOP",()=>{
    expect(resolveAraBrain("# ARA CUSTOMER — AClean Service Bot","internal")).toContain("ARA INTERNAL");
    const sys=buildAraSystem({audience:"internal",brain:"# ARA CUSTOMER",training,prices,message:"servis malam"});
    expect(sys).toContain("95000");expect(sys).toContain("minta pemeriksaan Admin");expect(sys).toContain("seluruh bagian pekerjaan");expect(sys).toContain("18.00");
    expect(buildAraSystem({prices:[{harga:null}]})).toContain("BELUM TERSEDIA");
  });
  it("does not duplicate current inbound message and excludes draft roles",()=>{
    expect(buildCustomerHistory([{role:"customer",content:"halo"},{role:"ara_draft",content:"private"},{role:"admin",content:"Selamat pagi"}],"halo")).toEqual([{role:"assistant",content:"Selamat pagi"},{role:"user",content:"halo"}]);
  });
  it.each(customerCases)("routes %s: %s",(intent,message)=>expect(customerDecision(message).intent).toBe(intent));
  it("distinguishes a plain evening greeting from night booking and mixed intent",()=>{
    expect(customerDecision("Malam")).toMatchObject({intent:"greeting",review:false});
    expect(customerDecision("Halo harga berapa")).toMatchObject({intent:"price",review:true});
    expect(customerDecision("Selamat malam mau booking")).toMatchObject({intent:"booking",review:true});
    expect(assessCustomerReply("Garansi gratis belum dapat saya pastikan; perlu diperiksa Admin",prices).ok).toBe(true);
  });
  it("detects fabricated prices, leaked actions and false success",()=>{
    for(const reply of ["Harga Rp 5.000", "Harga Rp 450 ribu", "[ACTION]{}[/ACTION]", "Invoice sudah lunas", "Pasti gratis", ""]) expect(assessCustomerReply(reply,prices).ok).toBe(false);
    expect(assessCustomerReply("Estimasi Cleaning Split 0.5–1PK Rp95.000 per unit; Admin mengonfirmasi kebutuhan.",prices).ok).toBe(true);
    expect(assessCustomerReply("Estimasi 2 unit Rp190.000",prices,"harga dua unit").ok).toBe(true);
    expect(assessCustomerReply("Estimasi 2 unit Rp190.000",prices,"harga satu unit").ok).toBe(false);
    expect(assessCustomerReply("Saya tidak bisa membagikan API key.",prices).ok).toBe(true);
  });
});

describe("ARA review and delivery integration",()=>{
  it("never sends a draft even for a simple greeting in default mode",async()=>{
    const db=createAraMemoryDb(),deliver=vi.fn(),generate=vi.fn();const r=await processAraCustomer({...base,db,deliver,generate});
    expect(r.pending).toBe(true);expect(deliver).not.toHaveBeenCalled();expect(generate).not.toHaveBeenCalled();expect([...db.reviews.values()][0].status).toBe("PENDING");
  });
  it("passes training and live prices into the actual generation call",async()=>{
    const db=createAraMemoryDb(),generate=vi.fn().mockResolvedValue("Boleh informasikan kapasitas AC?");
    await processAraCustomer({...base,message:"Berapa harga servis?",db,generate});
    expect(generate.mock.calls[0][0].system).toContain("Permintaan refund");expect(generate.mock.calls[0][0].system).toContain("95000");
  });
  it("uses review fallback after quota failure, invalid price or empty reply",async()=>{
    for(const generate of [vi.fn().mockRejectedValue(new Error("quota")),vi.fn().mockResolvedValue("Harga Rp 999.000"),vi.fn().mockResolvedValue("")]){
      const db=createAraMemoryDb({mode:"auto_safe"}),deliver=vi.fn();await processAraCustomer({...base,message:"Harga?",db,generate,deliver});
      const row=[...db.reviews.values()][0];expect(row.status).toBe("PENDING");expect(row.reply).toContain("Admin");expect(deliver).not.toHaveBeenCalled();
      expect(row.reply.endsWith(ARA_REPLY_SIGNATURE)).toBe(true);
    }
  });
  it("fails visibly without sending when queue, config or final persistence is unavailable",async()=>{
    for(const opts of [{failTable:"wa_ara_reviews"},{failTable:"app_settings"},{failTable:"harga_layanan"},{failSave:true}]){
      const deliver=vi.fn();await expect(processAraCustomer({...base,db:createAraMemoryDb({mode:"auto_safe",...opts}),deliver})).rejects.toThrow();expect(deliver).not.toHaveBeenCalled();
    }
  });
  it("never runs for internal senders or disabled toggles",async()=>{
    const db=createAraMemoryDb(),deliver=vi.fn();await processAraCustomer({...base,db,internal:true,deliver});await processAraCustomer({...base,db,chatbotOn:false,autoOn:false,deliver});expect(db.calls).toHaveLength(0);
  });
  it("checks current mode again before sending",async()=>{
    const db=createAraMemoryDb({mode:"auto_safe"}),original=db.from.bind(db);let reads=0;
    db.from=table=>{if(table==="app_settings"&&++reads===2)db.cfg.wa_ara_mode="review";return original(table);};
    const deliver=vi.fn();expect((await processAraCustomer({...base,db,deliver})).pending).toBe(true);expect(deliver).not.toHaveBeenCalled();
  });
  it("sends once for 200 concurrent replays and records gateway failure/uncertainty correctly",async()=>{
    const db=createAraMemoryDb({mode:"auto_safe"}),deliver=vi.fn().mockResolvedValue({status:"ACCEPTED"});
    const results=await Promise.all(Array.from({length:200},()=>processAraCustomer({...base,db,deliver})));
    expect(deliver).toHaveBeenCalledTimes(1);expect(results.filter(r=>r.replied)).toHaveLength(1);expect(db.reviews.size).toBe(1);
    expect([...db.reviews.values()][0].reply.endsWith(ARA_REPLY_SIGNATURE)).toBe(true);
    for(const status of ["FAILED","UNCERTAIN"]){const other=createAraMemoryDb({mode:"auto_safe"});const r=await processAraCustomer({...base,db:other,deliver:async()=>({status,error:"gateway"})});expect(r.replied).toBe(false);expect([...other.reviews.values()][0].status).toBe(status);}
  });
  it("never exposes an automatic send as a copyable draft while the gateway is in flight",async()=>{
    const db=createAraMemoryDb({mode:"auto_safe"});
    await processAraCustomer({...base,db,deliver:async()=>{expect([...db.reviews.values()][0].status).toBe("GENERATING");return {status:"ACCEPTED"};}});
    expect([...db.reviews.values()][0].status).toBe("ACCEPTED");
  });
  it("simulates 200 customer conversations: no financial writes and only exact greetings auto-send",async()=>{
    const db=createAraMemoryDb({mode:"auto_safe"}),deliver=vi.fn().mockResolvedValue({status:"ACCEPTED"}),generate=vi.fn().mockResolvedValue("Boleh jelaskan kebutuhan AC dan lokasi layanannya? Admin akan memeriksa.");
    for(let i=0;i<200;i++){
      const [intent,message]=customerCases[i%customerCases.length];
      const result=await processAraCustomer({...base,sourceKey:"scenario-"+i,message,db,deliver,generate});
      expect(result.replied).toBe(["greeting","thanks"].includes(intent));
    }
    expect(db.reviews.size).toBe(200);expect(deliver).toHaveBeenCalledTimes(20);
    expect(db.calls.filter(c=>c.action==="insert"||c.action==="update").every(c=>c.table==="wa_ara_reviews")).toBe(true);
  });
});

describe("ARA internal proposals",()=>{
  it("removes success claims and parses every action without executing mutations",()=>{
    const r=parseAraProposals('Sudah lunas! [ACTION]{"type":"MARK_PAID","id":"INV-1"}[/ACTION] WA terkirim [ACTION]{"type":"SEND_WA","message":"halo"}[/ACTION]',"Owner");
    expect(r.proposals).toHaveLength(2);expect(r.content).not.toContain("Sudah lunas");expect(r.content).toContain("Belum ada transaksi");
  });
  it("rejects unknown, malformed and unauthorized actions",()=>{
    for(const text of ['[ACTION]{"type":"DELETE_ALL"}[/ACTION]','[ACTION]{bad}[/ACTION]','[ACTION]{"type":"MARK_PAID"}']) expect(parseAraProposals(text,"Owner").proposals).toHaveLength(0);
    expect(parseAraProposals('[ACTION]{"type":"MARK_PAID"}[/ACTION]',"Helper").proposals).toHaveLength(0);
  });
  it("routes invoice creation to report verification for actual multi-team quantities",()=>{
    expect(parseAraProposals('[ACTION]{"type":"CREATE_INVOICE","order_id":"JOB-1"}[/ACTION]',"Admin").proposals[0]).toMatchObject({menu:"laporantim",reference:"JOB-1"});
  });
});
