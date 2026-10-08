import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyPaymentMedia, ensurePaymentSuggestion, normalizePaymentClassification,
  parsePaymentClassification, registerPaymentMediaReference, stagePaymentMedia, retryOnePaymentMediaJob,
} from "../../../api/_payment-media.js";

afterEach(() => vi.unstubAllGlobals());

describe("WA payment media classification", () => {
  it("memakai nominal transfer, bukan total debit yang termasuk biaya admin", () => {
    const parsed = normalizePaymentClassification({
      category: "bukti_transfer",
      transfer_amount: "Rp 200.000",
      fee_amount: "2.500",
      total_debit: "202500",
      bank: "Bank Central Asia",
      transfer_date: "2026-09-29",
    });
    expect(parsed.amount).toBe(200000);
    expect(parsed.fee_amount).toBe(2500);
    expect(parsed.total_debit).toBe(202500);
  });

  it("tetap kompatibel dengan response AI lama yang hanya punya amount", () => {
    expect(normalizePaymentClassification({ category: "bukti_transfer", amount: 150000 }).amount).toBe(150000);
  });

  it("membaca JSON walau dibungkus markdown", () => {
    const parsed = parsePaymentClassification('```json\n{"category":"bukti_transfer","transfer_amount":200000}\n```');
    expect(parsed).toMatchObject({ category: "bukti_transfer", amount: 200000 });
  });

  it("mengembalikan retryable saat provider AI timeout/error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network timeout"));
    const result = await classifyPaymentMedia({
      buffer: Buffer.alloc(2048, 1), mimeType: "image/jpeg", apiKey: "test", fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, retryable: true, error: "network timeout" });
  });

  it("memproses response sukses dan menormalkan nominal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: '{"category":"bukti_transfer","transfer_amount":200000,"fee_amount":2500,"total_debit":202500}' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    const result = await classifyPaymentMedia({
      buffer: Buffer.alloc(2048, 1), mimeType: "image/jpeg", apiKey: "test", fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.classification).toMatchObject({ amount: 200000, fee_amount: 2500, total_debit: 202500 });
  });

  it("mendaftarkan referensi sebelum download agar kegagalan tidak silent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => [{ id: "job-1", status: "RECEIVED", phone: "628179527958" }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await registerPaymentMediaReference({
      supabaseUrl: "https://example.supabase.co", serviceKey: "service",
      sourceUrl: "https://fonnte/image.jpeg", phone: "628179527958", senderName: "Ibu Dian",
    });
    expect(result).toMatchObject({ ok: true, job: { id: "job-1" } });
    expect(fetchMock.mock.calls[0][1].headers.Prefer).toContain("ignore-duplicates");
  });

  it("webhook duplikat memakai object R2 yang sama tanpa upload ulang", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "job-1", status: "DONE", r2_key: "wa-inbox/a.jpg", r2_url: "/api/foto?key=a" }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await stagePaymentMedia({
      supabaseUrl: "https://example.supabase.co", serviceKey: "service",
      sourceUrl: "https://fonnte/image.jpeg", phone: "628179527958",
      buffer: Buffer.alloc(2048), mimeType: "image/jpeg",
    });
    expect(result).toMatchObject({ ok: true, duplicate: true, key: "wa-inbox/a.jpg" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("membuat review manual tanpa nominal hanya untuk invoice exact-phone", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: "INV-1", job_id: "JOB-1", total: 200000, phone: "628179527958", status: "UNPAID" }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: "SUG-1", amount: null }] });
    vi.stubGlobal("fetch", fetchMock);
    const result = await ensurePaymentSuggestion({
      supabaseUrl: "https://example.supabase.co", serviceKey: "service",
      job: { id: "job-1", phone: "628179527958", sender_name: "Ibu Dian", r2_url: "/api/foto?key=a" },
      pendingReason: "AI timeout",
    });
    expect(result).toMatchObject({ ok: true, invoice: null, suggestion: { id: "SUG-1" } });
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(payload).toMatchObject({ amount: null, invoice_id: null, media_job_id: "job-1", validation_status: "PENDING" });
  });
});


describe("durable payment retry", () => {
  const job = { id: "j1", phone: "6281234567890", r2_url: "/api/foto?key=proof.jpg", category: "bukti_transfer", transfer_amount: 950000, attempts: 2 };
  const invoices = [500000,450000].map((total,n)=>({id:`I${n}`,phone:job.phone,status:"UNPAID",total}));
  const response = data => ({ok:true,json:async()=>data});
  it("reuses OCR without AI/download and propagates database errors to cron", async () => {
    const mock = vi.fn(async (url, options) => {
      if (url.includes("wa_payment_media_jobs?select")) return response([job]);
      if (options?.method === "PATCH") return response([]);
      if (url.includes("status=eq.PAID")) return response([]);
      if (url.includes("/invoices?")) return response(invoices);
      if (url.includes("payment_suggestions?on_conflict")) return {ok:false,status:400,text:async()=>"42P10"};
      throw new Error("Unexpected network call: " + url);
    });
    vi.stubGlobal("fetch",mock);
    const result=await retryOnePaymentMediaJob({supabaseUrl:"https://db.test",serviceKey:"key"});
    expect(result).toMatchObject({ok:false,suggestion:0,error:expect.stringContaining("42P10")});
    const last=JSON.parse(mock.mock.calls.at(-1)[1].body);
    expect(last).toMatchObject({status:"FAILED_PERMANENT",next_retry_at:null});
  });
  it("records the unique multi-invoice match without assigning the newest invoice", async () => {
    const mock=vi.fn().mockResolvedValueOnce(response(invoices)).mockResolvedValueOnce(response([])).mockImplementationOnce(async(_url,opts)=>response([{id:"s1",...JSON.parse(opts.body)}]));
    vi.stubGlobal("fetch",mock);
    const result=await ensurePaymentSuggestion({supabaseUrl:"https://db.test",serviceKey:"key",job,classification:{amount:950000}});
    expect(result).toMatchObject({ok:true,inserted:true,invoice:null,suggestion:{invoice_id:null,match_source:"wa_image_ai_multi",amount:950000}});
    expect(result.suggestion.raw_message).toContain("I0, I1");
  });
  it.each(["CONFIRMED","DISMISSED"])("does not reopen a %s suggestion on webhook replay", async status => {
    const mock=vi.fn().mockResolvedValueOnce(response(invoices)).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([{id:"s1",status,amount:950000}]));
    vi.stubGlobal("fetch",mock);
    const result=await ensurePaymentSuggestion({supabaseUrl:"https://db.test",serviceKey:"key",job,classification:{amount:950000}});
    expect(result).toMatchObject({ok:true,inserted:false,suggestion:{status}});
    expect(mock).toHaveBeenCalledTimes(4);
    expect(mock.mock.calls[2][1].headers.Prefer).toContain("ignore-duplicates");
  });
  it("only enriches a still-pending AI-timeout fallback",async()=>{
    const mock=vi.fn().mockResolvedValueOnce(response(invoices)).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([{id:"s1",status:"PENDING",match_source:"wa_image_ai_pending"}])).mockResolvedValueOnce(response([{id:"s1",amount:950000}]));
    vi.stubGlobal("fetch",mock);
    const result=await ensurePaymentSuggestion({supabaseUrl:"https://db.test",serviceKey:"key",job,classification:{amount:950000}});
    expect(result.suggestion.amount).toBe(950000);
    expect(mock.mock.calls[4][0]).toContain("status=eq.PENDING&match_source=eq.wa_image_ai_pending");
  });
});

it('does not reuse a settled proof even when the customer has a newer open invoice',async()=>{
  const mock=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>[{id:'NEW',phone:'6281234567890',status:'UNPAID',total:950000}]}).mockResolvedValueOnce({ok:true,json:async()=>[{id:'PAID-1'}]});
  vi.stubGlobal('fetch',mock);
  const result=await ensurePaymentSuggestion({supabaseUrl:'https://db.test',serviceKey:'key',job:{id:'j1',phone:'6281234567890',r2_url:'/api/foto?key=proof.jpg'},classification:{amount:950000}});
  expect(result).toMatchObject({ok:true,alreadySettled:true,inserted:false,invoice:{id:'PAID-1'}});
  expect(mock.mock.calls.every(([,options])=>!options.method)).toBe(true);
});
