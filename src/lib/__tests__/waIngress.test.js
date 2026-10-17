import { afterEach, describe, expect, it, vi } from "vitest";
import { captureWaIngress, downloadIngressMedia, normalizeWaIngress, readWaIngressHealth, safeFonnteMediaUrl } from "../../../api/_wa-ingress.js";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const sample = { device: "628000000001", sender: "628000000002", type: "image", url: "https://api.fonnte.com/t/proof.jpg", timestamp: "1792197446" };
describe("inbound WA normalization", () => {
  it.each(["image", "Image", "imageMessage", "photo"])("captures %s without a caption", type => {
    const event = normalizeWaIngress({ ...sample, type });
    expect(event).toMatchObject({ type: "image", processable: true, capture_media: true, phone: sample.sender });
    expect(event.message).toContain(sample.url);
  });
  it.each(["video", "audio", "sticker"])("records %s without pretending it is an AI payment image", type => {
    expect(normalizeWaIngress({ ...sample, type })).toMatchObject({ type, processable: false, capture_media: false, review_reason: null });
  });
  it("accepts the from alias and a WhatsApp JID", () => {
    expect(normalizeWaIngress({ ...sample, sender: undefined, from: "628000000002@s.whatsapp.net" }).phone).toBe(sample.sender);
  });
  it("accepts plain text aliases without turning structured objects into customer messages", () => {
    expect(normalizeWaIngress({ sender: sample.sender, text: "Sudah transfer" })).toMatchObject({ message: "Sudah transfer", processable: true });
    expect(normalizeWaIngress({ sender: sample.sender, message: {} })).toMatchObject({ message: null, processable: false });
  });
  it("quarantines unresolved LID and unknown JID without guessing customer digits", () => {
    for (const sender of ["98765432112345@lid", "628000000002@evil.invalid"]) {
      expect(normalizeWaIngress({ ...sample, sender })).toMatchObject({ phone: null, processable: false, capture_media: true });
    }
    expect(normalizeWaIngress({ ...sample, sender: "98765432112345@lid", from: sample.sender }).phone).toBe(sample.sender);
  });
  it("does not turn group IDs into phone numbers", () => {
    expect(normalizeWaIngress({ ...sample, sender: "120000@g.us", member: sample.sender })).toMatchObject({ is_group: true, phone: null, capture_media: false, processable: true });
  });
  it("stores missing or unsafe image URLs for review, not a silent successful AI result", () => {
    for (const url of [undefined, "http://127.0.0.1/x.jpg", "https://evil.invalid/photo.jpg"]) {
      const event = normalizeWaIngress({ ...sample, url });
      expect(event.review_reason).toBeTruthy(); expect(event.processable).toBe(false); expect(event.media_url).toBeNull();
    }
  });
  it("recognizes safe image URLs in legacy text messages", () => {
    expect(normalizeWaIngress({ sender: sample.sender, type: "text", message: sample.url })).toMatchObject({ type: "image", capture_media: true });
  });
  it.each(["Pagi Tas 1", "Pulang Tas 5", "Material Pagi"])("keeps operational photo %s on its existing pipeline", caption => {
    expect(normalizeWaIngress({ ...sample, caption }).capture_media).toBe(false);
  });
  it("has stable keys across delivery retries but not across different messages", () => {
    expect(normalizeWaIngress(sample).event_key).toBe(normalizeWaIngress({ ...sample, secret: "not persisted" }).event_key);
    expect(normalizeWaIngress(sample).event_key).not.toBe(normalizeWaIngress({ ...sample, timestamp: "1792197447" }).event_key);
    const text = { sender: sample.sender, message: "Ok" };
    expect(normalizeWaIngress(text).event_key).not.toBe(normalizeWaIngress(text).event_key);
  });
  it("does not persist tokens, unknown metadata or full oversized values", () => {
    const event = normalizeWaIngress({ ...sample, secret: "private", token: "private", metadata: { secret: "private" }, message: "x".repeat(10000) });
    expect(JSON.stringify(event.payload)).not.toContain("private");
    expect(event.payload.message.length).toBe(8192); expect(event.processable).toBe(false);
  });
  it.each(["https://api.fonnte.com.evil.invalid/a.jpg", "https://user:pass@api.fonnte.com/a.jpg", "https://api.fonnte.com:444/a.jpg", "file:///x", "http://api.fonnte.com/a.jpg"])("rejects unsafe source %s", url => {
    expect(safeFonnteMediaUrl(url)).toBeNull();
  });
});

describe("durable receipt contract", () => {
  it("waits for the capture RPC, never asks it to alter payment status", async () => {
    const event = normalizeWaIngress(sample);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ receipt_id: "1", received_at: "2026-10-17T00:37:26Z", message_id: "5", duplicate: false }) });
    const result = await captureWaIngress(event, { supabaseUrl: "https://db.invalid", serviceKey: "test", fetchImpl });
    expect(result.message_id).toBe("5"); expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain("/rpc/capture_wa_webhook_214");
    expect(JSON.parse(options.body)).toEqual({ p_event: event });
  });
  it.each([503, 404, 500])("does not acknowledge an unavailable database RPC (%s)", async status => {
    await expect(captureWaIngress(normalizeWaIngress(sample), { supabaseUrl: "https://db.invalid", serviceKey: "test", fetchImpl: async () => ({ ok: false, status }) })).rejects.toThrow("belum tersimpan");
  });
  it("does not accept a malformed or incomplete success response", async () => {
    for (const result of [{}, { receipt_id: "1", received_at: "now", duplicate: false }]) {
      await expect(captureWaIngress(normalizeWaIngress(sample), { supabaseUrl: "https://db.invalid", serviceKey: "test", fetchImpl: async () => ({ ok: true, json: async () => result }) })).rejects.toThrow();
    }
  });
});

describe("bounded media download", () => {
  it("does not discard a small but non-empty receipt", async () => {
    const bytes = Buffer.alloc(500, 1);
    const fetchImpl = vi.fn(async () => new Response(bytes, { headers: { "content-type": "image/jpeg" } }));
    expect((await downloadIngressMedia(sample.url, { fetchImpl })).buffer.length).toBe(500);
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
  });
  it("rejects advertised oversized media before reading it", async () => {
    await expect(downloadIngressMedia(sample.url, { fetchImpl: async () => new Response("x", { headers: { "content-length": "11000000" } }) })).rejects.toThrow("10 MB");
  });
  it("enforces the bound even without a Content-Length", async () => {
    await expect(downloadIngressMedia(sample.url, { maxBytes: 10, fetchImpl: async () => new Response(Buffer.alloc(20)) })).rejects.toThrow("10 MB");
  });
  it("keeps failed and empty downloads visible for retry", async () => {
    await expect(downloadIngressMedia(sample.url, { fetchImpl: async () => new Response(null, { status: 404 }) })).rejects.toThrow("HTTP 404");
    await expect(downloadIngressMedia(sample.url, { fetchImpl: async () => new Response("") })).rejects.toThrow("kosong");
  });
});

it("exposes bounded intake diagnostics without raw payloads or credentials",async()=>{
  const result=await readWaIngressHealth({supabaseUrl:"https://db.invalid",serviceKey:"key",fetchImpl:async()=>new Response(JSON.stringify({last_received_at:"2026-10-17T00:37:26Z",review_count:21,recent_received:200,
    incidents:Array.from({length:25},(_,id)=>({id,sender:"unknown@lid",msg_type:"image",intake_error:"URL media belum tersedia",created_at:"2026-10-17T00:37:26Z",payload:{secret:"PRIVATE"},source_url:"PRIVATE"}))}))});
  expect(result).toMatchObject({available:true,review_count:21});expect(result.incidents).toHaveLength(20);expect(JSON.stringify(result)).not.toContain("PRIVATE");
});
it("does not confuse an unreadable capture monitor with zero intake problems",async()=>{
  expect(await readWaIngressHealth({supabaseUrl:"https://db.invalid",serviceKey:"key",fetchImpl:async()=>new Response("{}",{status:404})})).toMatchObject({available:false});
});
