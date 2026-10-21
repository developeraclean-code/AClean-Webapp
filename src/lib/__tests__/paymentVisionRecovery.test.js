import { afterEach, beforeEach, expect, it, vi } from "vitest";

const jpeg = Buffer.from([255, 216, 255, 0]);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
let requests, providerReply, logFailure;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  vi.resetModules();
  for (const [key, value] of Object.entries({ SUPABASE_URL:"https://db.invalid", SUPABASE_SERVICE_KEY:"test", OPENAI_API_KEY:"test",
    R2_ACCESS_KEY:"test", R2_SECRET_KEY:"test", R2_ACCOUNT_ID:"test" })) vi.stubEnv(key, value);
  requests = []; logFailure = false;
  providerReply = () => json({choices:[{message:{content:'{"category":"dokumen","document_type":"invoice"}'}}],usage:{prompt_tokens:17,completion_tokens:6}});
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    requests.push({url, options, body:options.body ? JSON.parse(options.body) : null});
    if (url.includes("/app_settings?")) return json([{value:"openai"}]);
    if (url === "https://api.openai.com/v1/chat/completions") return providerReply();
    if (url.endsWith("/ai_usage")) { if(logFailure) throw new Error("log unavailable"); return json(null, 201); }
    throw new Error("Unexpected network: " + url);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const audit = {supabaseUrl:"https://db.invalid",serviceKey:"test",stage:"retry",mediaJobId:"j1",attempt:2};
const usageRows = () => requests.filter(r => r.url.endsWith("/ai_usage")).map(r => r.body);
const providerCalls = () => requests.filter(r => r.url === "https://api.openai.com/v1/chat/completions");

it("detects mislabeled PDF bytes, sends a file, and logs exactly one measured call", async () => {
  const {classifyPaymentMedia} = await import("../../../api/_payment-media.js");
  const result = await classifyPaymentMedia({buffer:pdf,mimeType:"image/jpeg",audit});
  expect(result).toMatchObject({ok:true,classification:{category:"dokumen"}});
  expect(providerCalls()).toHaveLength(1);
  expect(providerCalls()[0].body.messages[0].content[1].file.file_data).toMatch(/^data:application\/pdf;base64,/);
  expect(usageRows()).toEqual([expect.objectContaining({feature:"wa-personal-vision",input_tokens:17,output_tokens:6,error:null,
    metadata:expect.objectContaining({stage:"retry",media_job_id:"j1",attempt:2,mime_type:"application/pdf",declared_mime_mismatch:true,usage_known:true})})]);
  expect(requests.some(r => /payment_suggestions|invoice_payments/.test(r.url))).toBe(false);
});

it.each([Buffer.from("<html>expired download</html>"), Buffer.alloc(10*1024*1024+1), Buffer.alloc(0)])("rejects unsupported, oversized, or empty bytes without spending AI quota", async buffer => {
  const {classifyPaymentMedia} = await import("../../../api/_payment-media.js");
  expect(await classifyPaymentMedia({buffer,mimeType:"image/jpeg",audit})).toMatchObject({ok:false,retryable:false});
  expect(requests).toHaveLength(0);
});

it("logs billed tokens even if the model returns malformed JSON", async () => {
  providerReply = () => json({choices:[{message:{content:"not JSON"}}],usage:{prompt_tokens:21,completion_tokens:9}});
  const {classifyPaymentMedia} = await import("../../../api/_payment-media.js");
  expect(await classifyPaymentMedia({buffer:jpeg,audit})).toMatchObject({ok:false,retryable:true});
  expect(usageRows()).toEqual([expect.objectContaining({input_tokens:21,output_tokens:9,error:expect.stringContaining("JSON")})]);
});

it.each([[400,false],[429,true],[503,true]])("records HTTP %s failure without hiding unknown usage or changing provider", async (status,retryable) => {
  providerReply = () => json({error:{code:status===400?"invalid_image_format":"upstream_error"}},status);
  const {classifyPaymentMedia} = await import("../../../api/_payment-media.js");
  expect(await classifyPaymentMedia({buffer:jpeg,audit})).toMatchObject({ok:false,retryable});
  expect(providerCalls()).toHaveLength(1);
  expect(usageRows()).toEqual([expect.objectContaining({error:expect.stringContaining(`HTTP ${status}`),metadata:expect.objectContaining({usage_known:false})})]);
});

it("records network failure, but does not treat a missing key as a provider call", async () => {
  providerReply = () => { throw new Error("network timeout"); };
  const {classifyPaymentMedia} = await import("../../../api/_payment-media.js");
  expect(await classifyPaymentMedia({buffer:jpeg,audit})).toMatchObject({ok:false,retryable:true});
  expect(usageRows()).toHaveLength(1);
  vi.stubEnv("OPENAI_API_KEY", "");
  expect(await classifyPaymentMedia({buffer:jpeg,audit})).toMatchObject({ok:false});
  expect(providerCalls()).toHaveLength(1); expect(usageRows()).toHaveLength(1);
});

it("does not turn missing usage into a measured zero-cost call", async () => {
  providerReply = () => json({choices:[{message:{content:'{"category":"dokumen"}'}}]});
  const {classifyPaymentMedia} = await import("../../../api/_payment-media.js");
  expect(await classifyPaymentMedia({buffer:jpeg,audit})).toMatchObject({ok:true});
  expect(usageRows()[0].metadata.usage_known).toBe(false);
});

it("a failed usage write cannot lose a successful classification", async () => {
  logFailure = true;
  const {classifyPaymentMedia} = await import("../../../api/_payment-media.js");
  expect(await classifyPaymentMedia({buffer:jpeg,audit})).toMatchObject({ok:true});
  expect(usageRows()).toHaveLength(1);
});

it("usage logging is bounded even if the database stops responding", async () => {
  const {logAiUsageRest} = await import("../../../api/_logger.js");
  let signal;
  vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve,reject) => {
    signal = options.signal;
    signal.addEventListener("abort", () => reject(signal.reason), {once:true});
  })));
  await expect(logAiUsageRest({SU:audit.supabaseUrl,SK:audit.serviceKey,feature:"wa-personal-vision",timeoutMs:10})).resolves.toBeUndefined();
  expect(signal.aborted).toBe(true);
});

it("a database settings error never silently selects a different provider or records an AI request", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({error:"unavailable"},503)));
  const {classifyPaymentMedia} = await import("../../../api/_payment-media.js");
  expect(await classifyPaymentMedia({buffer:jpeg,audit})).toMatchObject({ok:false,retryable:true,error:expect.stringContaining("setting unavailable")});
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

it("stages mislabeled PDF with a PDF key and MIME before any AI request", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    requests.push({url,options,body:options.method === "POST" ? JSON.parse(options.body) : null});
    if(url.includes("/wa_payment_media_jobs?") && !options.method) return json([]);
    if(options.method === "PUT") return new Response(null,{status:200});
    if(options.method === "POST") return json([{id:"j1"}]);
    throw new Error("Unexpected network: " + url);
  }));
  const {stagePaymentMedia} = await import("../../../api/_payment-media.js");
  const result = await stagePaymentMedia({supabaseUrl:audit.supabaseUrl,serviceKey:audit.serviceKey,sourceUrl:"https://api.fonnte.com/t/mislabeled.jpg",phone:"628000000002",buffer:pdf,mimeType:"image/jpeg"});
  expect(result).toMatchObject({ok:true,key:expect.stringMatching(/\.pdf$/)});
  expect(requests.find(r=>r.options.method==="POST").body.mime_type).toBe("application/pdf");
  expect(providerCalls()).toHaveLength(0);
});

it.each(["pdf", "unsupported", "bad_request"])("worker handles %s end-to-end without payment mutation or repeated bad-input calls", async kind => {
  const originalFetch = globalThis.fetch.getMockImplementation();
  globalThis.fetch.mockImplementation(async (url, options = {}) => {
    if (url.includes("/rpc/claim_wa_payment_media")) return json({id:"j1",phone:"628000000002",r2_key:"wa-inbox/2026-10/proof.pdf",r2_url:"/api/foto?key=proof.pdf",mime_type:"application/pdf",attempts:1});
    if (url.includes("r2.cloudflarestorage.com")) return new Response(kind === "unsupported" ? "<html>expired</html>" : pdf,{headers:{"content-type":"application/pdf"}});
    if (options.method === "PATCH") { requests.push({url,options,body:JSON.parse(options.body)}); return json([{id:"j1"}]); }
    return originalFetch(url,options);
  });
  if (kind === "bad_request") providerReply = () => json({error:{code:"invalid_pdf"}},400);
  const {retryOnePaymentMediaJob} = await import("../../../api/_payment-media.js");
  const result = await retryOnePaymentMediaJob({supabaseUrl:audit.supabaseUrl,serviceKey:audit.serviceKey});
  expect(result).toMatchObject(kind === "pdf" ? {ok:true,ignored:1} : {ok:false,failed:1});
  expect(requests.find(r=>r.options.method==="PATCH").body).toMatchObject({status:kind==="pdf"?"IGNORED":"FAILED_PERMANENT",next_retry_at:null});
  expect(usageRows()).toHaveLength(kind === "unsupported" ? 0 : 1);
  expect(requests.some(r=>/payment_suggestions|invoice_payments|\/invoices\?/.test(r.url))).toBe(false);
});

it("a recognized PDF receipt reaches a PENDING suggestion only after durable archiving, never PAID", async () => {
  const job = {id:"j1",phone:"628000000002",r2_key:"wa-staging/2026-10/0123456789abcdef01234567.pdf",r2_url:"staging-proof",mime_type:"application/pdf",attempts:1};
  providerReply = () => json({choices:[{message:{content:'{"category":"bukti_transfer","document_type":"payment_receipt","transfer_amount":985000,"bank":"BCA"}'}}],usage:{prompt_tokens:19,completion_tokens:8}});
  const originalFetch = globalThis.fetch.getMockImplementation();
  globalThis.fetch.mockImplementation(async (url,options = {}) => {
    if (url.includes("/rpc/claim_wa_payment_media")) return json(job);
    if (url.includes("r2.cloudflarestorage.com")) {
      requests.push({url,options});
      return options.method === "PUT" ? new Response(null,{status:200}) : new Response(pdf,{headers:{"content-type":"application/pdf"}});
    }
    if (url.includes("/invoices?")) { expect(options.method || "GET").toBe("GET"); return json([]); }
    if (options.method === "PATCH" || url.includes("/payment_suggestions?on_conflict")) {
      const payload = JSON.parse(options.body); requests.push({url,options,body:payload}); return json([{id:"j1",...payload}]);
    }
    return originalFetch(url,options);
  });
  const {retryOnePaymentMediaJob} = await import("../../../api/_payment-media.js");
  expect(await retryOnePaymentMediaJob({supabaseUrl:audit.supabaseUrl,serviceKey:audit.serviceKey})).toMatchObject({ok:true,suggestion:1});
  const index = requests.findIndex(r=>r.url.includes("/payment_suggestions?on_conflict"));
  expect(index).toBeGreaterThan(requests.findIndex(r=>r.options.method === "PUT"));
  expect(requests[index].body).toMatchObject({status:"PENDING",validation_status:"PENDING",amount:985000,invoice_id:null,image_url:expect.stringContaining("wa-inbox")});
  expect(requests.at(-1).body.status).toBe("DONE");
  expect(providerCalls()).toHaveLength(1); expect(usageRows()).toHaveLength(1);
  expect(requests.some(r=>/invoice_payments|apply_wa_payment/.test(r.url))).toBe(false);
});
