import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ stage: vi.fn(), classify: vi.fn(), suggestion: vi.fn(), update: vi.fn(), register: vi.fn() }));
vi.mock("../../../api/_auth.js", async original => ({ ...await original(), checkRateLimit: vi.fn(async () => true) }));
vi.mock("../../../api/_ara-customer.js", () => ({ processAraCustomer: vi.fn() }));
vi.mock("../../../api/_payment-media.js", async original => ({ ...await original(), stagePaymentMedia: mocks.stage,
  classifyPaymentMedia: mocks.classify, ensurePaymentSuggestion: mocks.suggestion, updatePaymentMediaJob: mocks.update, registerPaymentMediaReference: mocks.register }));
import { receiveWa } from "../../../api/_handlers/wa.js";

let requests, captureResult, captureFailure;
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader: vi.fn() });
const body = { sender: "628000000002", type: "image", url: "https://api.fonnte.com/t/synthetic.jpg", timestamp: "1792197446" };
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://db.invalid");vi.stubEnv("SUPABASE_SERVICE_KEY", "synthetic");vi.stubEnv("FONNTE_TOKEN", "");vi.stubEnv("FONNTE_WEBHOOK_SECRET", "");
  vi.stubEnv("AUTOREPLY_ENABLED", "false");vi.stubEnv("FORWARD_TO_OWNER", "false");
  requests=[];captureFailure=false;
  captureResult={receipt_id:"raw-1",received_at:"2026-10-17T00:37:26Z",duplicate:false,message_id:"msg-1",intake_status:"MEDIA_QUEUED",sender_is_internal:false,payment_detect_enabled:true,
    media_job:{id:"job-1",status:"RECEIVED",phone:body.sender}};
  mocks.stage.mockReset().mockImplementation(async () => { requests.push({stage:"R2"});return {ok:true,url:"/api/foto?key=synthetic",job:{...captureResult.media_job,r2_url:"/api/foto?key=synthetic"}}; });
  mocks.classify.mockReset().mockImplementation(async () => { requests.push({stage:"AI"});return {ok:false,error:"synthetic AI timeout"}; });
  mocks.suggestion.mockReset().mockResolvedValue({ok:true,suggestion:{id:"suggestion-1",status:"PENDING"}});
  mocks.update.mockReset().mockResolvedValue({ok:true});mocks.register.mockReset();
  vi.spyOn(console,"info").mockImplementation(()=>{});vi.spyOn(console,"log").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});vi.spyOn(console,"error").mockImplementation(()=>{});
  vi.stubGlobal("fetch",vi.fn(async (raw,options={})=>{
    const url=new URL(raw);requests.push({origin:url.origin,path:url.pathname,method:options.method||"GET",body:options.body?JSON.parse(options.body):null});
    if(url.origin==="https://db.invalid" && url.pathname==="/rest/v1/rpc/capture_wa_webhook_214")return new Response(JSON.stringify(captureFailure?{error:"unavailable"}:captureResult),{status:captureFailure?503:200});
    if(url.origin==="https://db.invalid" && url.pathname==="/rest/v1/app_settings")return new Response(JSON.stringify([{key:"wa_autoreply_enabled",value:"false"},{key:"wa_forward_to_owner",value:"false"},{key:"wa_chatbot_enabled",value:"false"},{key:"wa_payment_detect",value:"true"}]));
    if(url.origin==="https://api.fonnte.com" && url.pathname==="/t/synthetic.jpg")return new Response(Buffer.alloc(500,1),{headers:{"content-type":"image/jpeg"}});
    if(url.origin==="https://db.invalid" && url.pathname==="/rest/v1/wa_messages" && options.method==="PATCH")return new Response(JSON.stringify([{id:"msg-1"}]));
    if(url.origin==="https://db.invalid" && url.pathname==="/rest/v1/invoices" && (!options.method || options.method==="GET"))return new Response("[]");
    throw new Error(`Unexpected request in isolated test: ${url.pathname}`);
  }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
const run = async value => {const res=response();await receiveWa({method:"POST",headers:{},query:{},body:value},res);return res;};
it("commits intake before download, secures media before AI, and keeps failures in retry rather than the payment inbox",async()=>{
  const res=await run(body);expect(res.code).toBe(200);expect(mocks.stage).toHaveBeenCalledOnce();expect(mocks.classify).toHaveBeenCalledOnce();
  expect(mocks.stage.mock.calls[0][0].buffer.length).toBe(500);expect(mocks.suggestion).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({patch:expect.objectContaining({status:"FAILED_RETRYABLE"})}));
  const captureIndex=requests.findIndex(r=>r.path?.endsWith("/capture_wa_webhook_214"));
  expect(captureIndex).toBeLessThan(requests.findIndex(r=>r.path==="/t/synthetic.jpg"));
  expect(requests.findIndex(r=>r.stage==="R2")).toBeLessThan(requests.findIndex(r=>r.stage==="AI"));
  expect(requests.some(r=>/invoice_payments|apply_wa_payment/.test(r.path||""))).toBe(false);
  expect(requests.some(r=>r.path==="/rest/v1/wa_messages"&&r.method==="POST")).toBe(false);
});
it("returns retryable 503 rather than falsely acknowledging a failed intake commit",async()=>{
  captureFailure=true;const res=await run(body);expect(res.code).toBe(503);expect(res.body.code).toBe("WA_INGRESS_NOT_DURABLE");
  expect(res.setHeader).toHaveBeenCalledWith("Retry-After","60");expect(mocks.stage).not.toHaveBeenCalled();expect(mocks.classify).not.toHaveBeenCalled();expect(requests).toHaveLength(1);
});
it("does not redownload or rerun AI on a replay of already queued media",async()=>{
  captureResult.duplicate=true;const res=await run(body);expect(res.body.skipped).toBe("duplicate-webhook");expect(mocks.classify).not.toHaveBeenCalled();expect(requests).toHaveLength(1);
});
it("does not spend AI quota before the R2 copy is safe",async()=>{
  mocks.stage.mockResolvedValue({ok:false,error:"synthetic R2 unavailable"});const res=await run(body);
  expect(res.code).toBe(200);expect(mocks.classify).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({id:"job-1",patch:expect.objectContaining({status:"FAILED_RETRYABLE"})}));
});
it("stops invalid input without retry, while preserving the staged reference for manual review", async()=>{
  mocks.classify.mockResolvedValue({ok:false,retryable:false,error:"Format media tidak dikenali"});
  expect((await run(body)).code).toBe(200);
  expect(mocks.classify).toHaveBeenCalledWith(expect.objectContaining({audit:expect.objectContaining({stage:"webhook",mediaJobId:"job-1",attempt:1})}));
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({id:"job-1",patch:expect.objectContaining({status:"FAILED_PERMANENT",next_retry_at:null})}));
  expect(mocks.suggestion).not.toHaveBeenCalled();
  expect(requests.some(r=>/invoice_payments|apply_wa_payment|\/ai_usage/.test(r.path||""))).toBe(false);
});
it.each(["kerusakan_ac", "tidak_relevan", "dokumen"])("never searches invoices or creates a payment for %s, even with a transfer caption",async category=>{
  mocks.classify.mockResolvedValue({ok:true,classification:{category,amount:null}});
  const res=await run({...body,message:"sudah transfer, ini fotonya"});
  expect(res.code).toBe(200);expect(mocks.suggestion).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({patch:expect.objectContaining({status:"IGNORED",next_retry_at:null})}));
  expect(requests.some(r=>r.path?.includes("/invoices"))).toBe(false);
  expect(requests.some(r=>r.origin?.endsWith("r2.cloudflarestorage.com"))).toBe(false);
});
it.each([985000,null])("keeps a recognized receipt with amount %s for human verification, never auto-PAID",async amount=>{
  mocks.classify.mockResolvedValue({ok:true,classification:{category:"bukti_transfer",amount,bank:"BCA"}});
  const res=await run(body);expect(res.code).toBe(200);
  expect(mocks.suggestion).toHaveBeenCalledWith(expect.objectContaining({classification:expect.objectContaining({category:"bukti_transfer",amount})}));
  expect(requests.some(r=>/invoice_payments|apply_wa_payment/.test(r.path||""))).toBe(false);
  expect(requests.some(r=>r.path==="/rest/v1/invoices"&&r.method!=="GET")).toBe(false);
});
it("does not double-process an image caption as a text payment before the R2 mirror",async()=>{
  vi.stubEnv("LLM_API_KEY","synthetic-no-network");await run({...body,message:"Bukti transfer pembayaran Rp 985000"});
  expect(mocks.stage).toHaveBeenCalledOnce();expect(mocks.classify).toHaveBeenCalledOnce();
  expect(requests.some(request=>/anthropic\.com|openai\.com/.test(request.origin||""))).toBe(false);
});
it("preserves the captured payment toggle when the later settings refresh is unavailable",async()=>{
  vi.stubEnv("LLM_API_KEY","synthetic-no-network");
  captureResult.payment_detect_enabled=false;captureResult.media_job=null;captureResult.intake_status="RECORDED";
  const originalFetch=globalThis.fetch.getMockImplementation();
  globalThis.fetch.mockImplementation(async(raw,options)=>{
    if(new URL(raw).pathname==="/rest/v1/app_settings")return new Response("{}",{status:503});
    return originalFetch(raw,options);
  });
  const res=await run({...body,type:"text",url:undefined,message:"Sudah transfer pembayaran Rp 985000"});
  expect(res.code).toBe(200);expect(mocks.stage).not.toHaveBeenCalled();expect(mocks.classify).not.toHaveBeenCalled();
  expect(requests.some(request=>/anthropic\.com|openai\.com/.test(request.origin||""))).toBe(false);
});
it("does not rerun a terminal media job under a fresh provider event ID",async()=>{
  captureResult.media_job.status="DONE";const res=await run(body);expect(res.body.skipped).toBe("media-already-recorded");expect(mocks.classify).not.toHaveBeenCalled();expect(requests).toHaveLength(1);
});
it("records video without a caption and acknowledges it without AI or an endless HTTP400 loop",async()=>{
  captureResult.intake_status="RECORDED";captureResult.media_job=null;
  const res=await run({...body,type:"video"});expect(res.code).toBe(200);expect(res.body.automated_reply).toBe(false);expect(mocks.classify).not.toHaveBeenCalled();expect(requests).toHaveLength(1);
});
it("retains unresolved media identity for review instead of dropping it or guessing a customer",async()=>{
  captureResult.intake_status="REVIEW";captureResult.media_job=null;captureResult.message_id=null;
  const res=await run({...body,sender:"98765432112345@lid"});expect(res.code).toBe(200);expect(res.body.needs_review).toBe(true);expect(requests[0].body.p_event.phone).toBeNull();
});
it("accepts the alternate from shape through the actual handler",async()=>{
  await run({...body,sender:undefined,from:body.sender+"@s.whatsapp.net"});expect(requests[0].body.p_event.phone).toBe(body.sender);expect(mocks.stage).toHaveBeenCalledOnce();
});
it("does not confuse a photo with missing sender and status metadata with a delivery receipt",async()=>{
  captureResult.intake_status="REVIEW";captureResult.media_job=null;captureResult.message_id=null;
  const res=await run({...body,sender:undefined,status:true});expect(res.body.needs_review).toBe(true);expect(requests).toHaveLength(1);
});
it("still ignores genuine outgoing delivery receipts without DB writes",async()=>{
  const res=await run({state:"delivered",device:"628000000001",stateid:"synthetic"});expect(res.body.ignored).toBe("delivery_receipt");expect(requests).toHaveLength(0);
});
it("still rejects a missing webhook secret before capture",async()=>{
  vi.stubEnv("FONNTE_WEBHOOK_SECRET","secret");const res=await run(body);expect(res.code).toBe(401);expect(requests).toHaveLength(0);
});
it("routes the old Settings URL to the same public webhook without exposing another unauthenticated handler",async()=>{
  const {default:router}=await import("../../../api/[route].js");
  const res=response();await router({method:"GET",headers:{},query:{route:"fonnte-webhook"}},res);expect(res.code).toBe(200);expect(res.body.service).toBe("AClean WA Webhook");expect(requests).toHaveLength(0);
});
