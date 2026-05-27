// api/ara-chat.js
// POST /api/ara-chat { messages, bizContext, provider, model, brainMd }
// Backend proxy ARA — support Claude, OpenAI, Minimax, Groq

import { createClient }                                 from "@supabase/supabase-js";
import { validateInternalToken, checkRateLimit, setCorsHeaders, fetchWithTimeout } from "./_auth.js";
import { logAiUsage, extractAnthropicUsage, extractOpenAIUsage, logStructured } from "./_logger.js";

const sb = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const buildSystem = (biz, brain) => {
  // ── Format hargaLayanan jadi teks yang mudah dibaca ARA ──
  const hargaSection = biz.hargaLayanan && biz.hargaLayanan.length > 0
    ? biz.hargaLayanan.map(r => `  - ${r.service} | ${r.type}: ${r.formatted}`).join("\n")
    : "  (Price list belum dimuat dari Supabase)";

  // Hapus hargaLayanan & priceList dari JSON utama agar tidak redundan & tidak terlalu panjang
  const { hargaLayanan: _h, priceList: _p, ...bizClean } = biz;

  // Indonesia timezone (UTC+7)
  const localTime = new Date(Date.now() + 7*60*60*1000).toLocaleString("id-ID");

  return `${brain}

## IDENTITAS
Kamu adalah ARA (Aclean Robot Assistant). Bantu Owner & Admin kelola bisnis servis AC.
Jawab Bahasa Indonesia, ringkas, profesional.

## ⚠️ ATURAN HARGA — WAJIB IKUTI
SELALU gunakan harga dari seksi "PRICE LIST LIVE" di bawah ini.
JANGAN gunakan harga dari brain.md atau memori lama.
Harga ini sudah di-update langsung oleh Owner dari tampilan Price List.

## PRICE LIST LIVE (dari Supabase — ${localTime})
${hargaSection}

## DATA BISNIS LIVE (${localTime})
${JSON.stringify(bizClean)}

## ACTION TOOLKIT — gunakan tag [ACTION]...[/ACTION] untuk eksekusi data

### ORDER
- Buat order  : [ACTION]{"type":"CREATE_ORDER","customer":"Nama","phone":"08xxx","address":"Alamat","service":"Cleaning","units":1,"teknisi":"Nama","helper":"Nama","date":"YYYY-MM-DD","time":"HH:MM","notes":""}[/ACTION]
- Bulk order  : [ACTION]{"type":"BULK_CREATE_ORDER","orders":[{"customer":"...","service":"Cleaning","units":1,"teknisi":"...","date":"YYYY-MM-DD","time":"09:00"},{"customer":"...","service":"Install","units":1,"teknisi":"...","date":"YYYY-MM-DD","time":"13:00"}]}[/ACTION]
- Update status:[ACTION]{"type":"UPDATE_ORDER_STATUS","id":"ORD-xxx","status":"CONFIRMED"}[/ACTION]
  Status valid: PENDING | CONFIRMED | IN_PROGRESS | COMPLETED | CANCELLED
- Reschedule  : [ACTION]{"type":"RESCHEDULE_ORDER","id":"ORD-xxx","date":"YYYY-MM-DD","time":"HH:MM","teknisi":"opsional"}[/ACTION]
  → otomatis kirim WA ke customer + teknisi
- Cancel      : [ACTION]{"type":"CANCEL_ORDER","id":"ORD-xxx","reason":"Alasan"}[/ACTION]
- Dispatch WA : [ACTION]{"type":"DISPATCH_WA","order_id":"ORD-xxx"}[/ACTION]

### INVOICE
- Buat invoice: [ACTION]{"type":"CREATE_INVOICE","order_id":"ORD-xxx"}[/ACTION]
- Edit field  : [ACTION]{"type":"UPDATE_INVOICE","id":"INV-xxx","field":"discount","value":50000}[/ACTION]
  Field valid : labor | material | discount | notes | due
- Mark lunas  : [ACTION]{"type":"MARK_PAID","id":"INV-xxx"}[/ACTION]
- Approve     : [ACTION]{"type":"APPROVE_INVOICE","id":"INV-xxx"}[/ACTION]
- Reminder WA : [ACTION]{"type":"SEND_REMINDER","invoice_id":"INV-xxx"}[/ACTION]
- Mark overdue: [ACTION]{"type":"MARK_INVOICE_OVERDUE"}[/ACTION]

### BIAYA / PENGELUARAN
- Catat biaya : [ACTION]{"type":"CREATE_EXPENSE","category":"petty_cash","subcategory":"Bensin Motor","amount":50000,"date":"YYYY-MM-DD","description":"keterangan","teknisi_name":"opsional"}[/ACTION]
  category valid    : petty_cash | material_purchase
  subcategory petty : Bensin Motor | Perbaikan Motor | Parkir | Kasbon Karyawan | Lembur | Bonus | Lain-lain
  subcategory mat   : Pipa AC | Kabel | Freon | Material Lain
- Beli material:[ACTION]{"type":"CREATE_EXPENSE","category":"material_purchase","subcategory":"Freon","amount":900000,"date":"YYYY-MM-DD","item_name":"R32 2kg","freon_type":"R32"}[/ACTION]

### STOK & KOMUNIKASI
- Update stok : [ACTION]{"type":"UPDATE_STOCK","code":"KODE","name":"Nama Item","delta":-2,"reason":"Dipakai job ORD-xxx"}[/ACTION]
- Kirim WA    : [ACTION]{"type":"SEND_WA","phone":"08xxx","message":"Pesan teks"}[/ACTION]

### WORKFLOW CHAIN (berurutan, max 3 action per response)
- Konfirmasi order baru : CREATE_ORDER → DISPATCH_WA
- Selesai job           : UPDATE_ORDER_STATUS(COMPLETED) → CREATE_INVOICE
- Bayar lunas           : MARK_PAID → SEND_WA (konfirmasi ke customer)
- Reschedule massal     : RESCHEDULE_ORDER (otomatis notif WA) — 1 per response`;
};

async function callClaude(msgs, sys, model) {
  const ALLOWED_CLAUDE = ["claude-haiku-4-5"];
  const safeModel = ALLOWED_CLAUDE.includes(model) ? model : "claude-haiku-4-5";
  // Split system prompt: static part (brain + price list) cached, dynamic part not
  // Cache TTL is 5 minutes — saves ~70-80% token cost on repeated ARA/chatbot calls
  const staticBreak = sys.indexOf("## DATA BISNIS LIVE");
  const staticPart  = staticBreak > 0 ? sys.slice(0, staticBreak).trimEnd() : sys;
  const dynamicPart = staticBreak > 0 ? sys.slice(staticBreak) : "";

  const systemBlocks = dynamicPart
    ? [
        { type: "text", text: staticPart, cache_control: { type: "ephemeral" } },
        { type: "text", text: dynamicPart },
      ]
    : sys; // fallback: string biasa jika tidak ada split point

  // LLM calls can take up to 30 seconds
  const r = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-api-key":process.env.ANTHROPIC_API_KEY,
      "anthropic-version":"2023-06-01",
      "anthropic-beta":"prompt-caching-2024-07-31",
    },
    body: JSON.stringify({model: safeModel, max_tokens:1024, system:systemBlocks, messages:msgs})
  }, 30000);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||"Claude error");
  const text = d.content?.map(c=>c.text||"").join("")||"";
  return { text, usage: extractAnthropicUsage(d), model: safeModel };
}

async function callOpenAI(msgs, sys, model) {
  const safeModel = model || "gpt-4o";
  const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.OPENAI_API_KEY},
    body: JSON.stringify({model:safeModel, max_tokens:1024, messages:[{role:"system",content:sys},...msgs]})
  }, 30000);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||"OpenAI error");
  const text = d.choices?.[0]?.message?.content||"";
  return { text, usage: extractOpenAIUsage(d), model: safeModel };
}

async function callMinimax(msgs, sys, model) {
  const key      = process.env.MINIMAX_API_KEY;
  const groupId  = process.env.MINIMAX_GROUP_ID || "";
  const ALLOWED_MINIMAX = ["MiniMax-M2.5"];
  const safeModel = ALLOWED_MINIMAX.includes(model) ? model : "MiniMax-M2.5";
  const r = await fetchWithTimeout("https://api.minimaxi.chat/v1/text/chatcompletion_v2", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
    body: JSON.stringify({
      model: safeModel,
      max_tokens: 1024,
      messages: [{role:"system",content:sys}, ...msgs],
      ...(groupId ? { group_id: groupId } : {})
    })
  }, 30000);
  const d = await r.json();
  if (!r.ok) throw new Error(d.base_resp?.status_msg || d.error?.message || "Minimax error");
  const text = d.choices?.[0]?.message?.content||"";
  return { text, usage: extractOpenAIUsage(d), model: safeModel };
}

async function callGroq(msgs, sys, model) {
  const safeModel = model || "llama-3.3-70b-versatile";
  const r = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.GROQ_API_KEY},
    body: JSON.stringify({model:safeModel, max_tokens:1024, messages:[{role:"system",content:sys},...msgs]})
  }, 30000);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||"Groq error");
  const text = d.choices?.[0]?.message?.content||"";
  return { text, usage: extractOpenAIUsage(d), model: safeModel };
}

export default async function handler(req, res) {
  // ── SEC-02: CORS ──
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({error:"Method not allowed"});

  // ── SEC-02: Rate limit 30 req/menit per IP (ARA lebih ketat karena costly) ──
  // Now supports Vercel KV for distributed rate limiting, falls back to in-memory
  if (!await checkRateLimit(req, res, 30, 60000)) return;

  // ── SEC-02: Validasi internal token ──
  if (!await validateInternalToken(req, res)) return;

  const { messages, bizContext={}, provider: rawProvider, model, brainMd="" } = req.body||{};
  // ── Smart provider fallback: pakai provider dari frontend, tapi fallback ke env yang tersedia ──
  const detectProvider = () => {
    // ── DEBUG: Log provider detection flow ──
    console.log("[ARA-CHAT] Provider detection:", {
      rawProvider,
      model,
      hasMinimaxKey: !!process.env.MINIMAX_API_KEY,
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      hasGroqKey: !!process.env.GROQ_API_KEY
    });

    // Ikuti pilihan frontend jika key tersedia
    if (rawProvider === "claude" && process.env.ANTHROPIC_API_KEY) {
      console.log("[ARA-CHAT] Using Claude (frontend + key exists)");
      return "claude";
    }
    if (rawProvider === "minimax" && process.env.MINIMAX_API_KEY) {
      console.log("[ARA-CHAT] Using Minimax (frontend + key exists)");
      return "minimax";
    }
    if (rawProvider === "openai" && process.env.OPENAI_API_KEY) return "openai";
    if (rawProvider === "groq" && process.env.GROQ_API_KEY) return "groq";
    // Fallback: cek env vars yang tersedia, prioritas claude dulu
    if (process.env.ANTHROPIC_API_KEY) {
      console.log("[ARA-CHAT] Fallback: Using Claude");
      return "claude";
    }
    if (process.env.MINIMAX_API_KEY) {
      console.log("[ARA-CHAT] Fallback: Using Minimax");
      return "minimax";
    }
    if (process.env.OPENAI_API_KEY) return "openai";
    if (process.env.GROQ_API_KEY) return "groq";
    console.log(`[ARA-CHAT] Last resort: ${rawProvider||"claude"}`);
    return rawProvider || "claude";
  };
  const provider = detectProvider();
  if (!messages?.length) return res.status(400).json({error:"messages wajib diisi"});

  const sys = buildSystem(bizContext, brainMd);

  const callStart = Date.now();
  try {
    let callResult = null;
    let usedProvider = provider;

    const runCall = async (p) => {
      switch(p) {
        case "openai":  return await callOpenAI(messages, sys, model);
        case "minimax": return await callMinimax(messages, sys, model);
        case "groq":    return await callGroq(messages, sys, model);
        default:        return await callClaude(messages, sys, model);
      }
    };

    try {
      callResult = await runCall(provider);
    } catch(primErr) {
      console.warn(`⚠️ ${provider} failed, trying fallback...`, primErr.message);
      const fallbackOrder = provider==="claude" ? ["minimax","openai","groq"] : ["claude","minimax","openai","groq"];
      for (const fbProvider of fallbackOrder) {
        if (fbProvider === provider) continue;
        try {
          callResult = await runCall(fbProvider);
          usedProvider = fbProvider;
          console.log(`✅ Fallback to ${fbProvider} success`);
          break;
        } catch(fbErr) {
          console.warn(`❌ ${fbProvider} also failed:`, fbErr.message);
          continue;
        }
      }
      if (!callResult) throw primErr;
    }

    const reply = callResult?.text || "";
    const aiUsage = callResult?.usage || { input_tokens: 0, output_tokens: 0 };
    const actualModel = callResult?.model || model;
    const durationMs = Date.now() - callStart;

    // Log AI usage untuk cost tracking
    await logAiUsage(sb, {
      provider: usedProvider,
      model: actualModel,
      feature: "ara-chat",
      input_tokens: aiUsage.input_tokens,
      output_tokens: aiUsage.output_tokens,
      duration_ms: durationMs,
      metadata: usedProvider !== provider ? { fallback_from: provider } : null,
    });

    // Log structured agent_logs
    await logStructured(sb, {
      action: "ARA_CHAT",
      severity: "info",
      category: "ai",
      detail: `ARA (${usedProvider}${usedProvider!==provider?" [fallback dr "+provider+"]":""}) — "${messages.at(-1)?.content?.slice(0,50)}..."`,
      metadata: { input_tokens: aiUsage.input_tokens, output_tokens: aiUsage.output_tokens, duration_ms: durationMs, model: actualModel },
    });

    return res.status(200).json({reply, provider: usedProvider, primaryProvider: provider, usage: aiUsage});
  } catch(err) {
    // Log error usage + agent_logs
    await logAiUsage(sb, {
      provider,
      model,
      feature: "ara-chat",
      error: err.message,
      duration_ms: Date.now() - callStart,
    });
    await logStructured(sb, {
      action: "ARA_ERROR",
      severity: "error",
      category: "ai",
      detail: err.message.slice(0, 200),
    });
    const friendlyErr = err.message.includes("quota") || err.message.includes("429")
      ? `Rate limit / quota habis untuk semua provider. Tunggu beberapa menit dan coba lagi.`
      : err.message.includes("401") || err.message.includes("403") || err.message.includes("API key")
      ? `API Key ${provider} tidak valid atau belum diset di Vercel env vars.`
      : err.message.includes("ANTHROPIC_API_KEY") || err.message.includes("credit")
      ? `Credit Anthropic habis. Setup provider lain di Vercel Environment Variables.`
      : `Terjadi kesalahan internal. Coba lagi atau hubungi support.`;
    return res.status(500).json({error: friendlyErr, provider});
  }
}
