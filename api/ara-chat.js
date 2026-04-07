// api/ara-chat.js
// POST /api/ara-chat { messages, bizContext, provider, model, brainMd }
// Backend proxy ARA — support Claude, OpenAI, Minimax, Groq

import { createClient }                                 from "@supabase/supabase-js";
import { validateInternalToken, checkRateLimit, setCorsHeaders } from "./_auth.js";

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const buildSystem = (biz, brain) => {
  // ── Format hargaLayanan jadi teks yang mudah dibaca ARA ──
  const hargaSection = biz.hargaLayanan && biz.hargaLayanan.length > 0
    ? biz.hargaLayanan.map(r => `  - ${r.service} | ${r.type}: ${r.formatted}`).join("\n")
    : "  (Price list belum dimuat dari Supabase)";

  // Hapus hargaLayanan & priceList dari JSON utama agar tidak redundan & tidak terlalu panjang
  const { hargaLayanan: _h, priceList: _p, ...bizClean } = biz;

  return `${brain}

## IDENTITAS
Kamu adalah ARA (Aclean Robot Assistant). Bantu Owner & Admin kelola bisnis servis AC.
Jawab Bahasa Indonesia, ringkas, profesional.

## ⚠️ ATURAN HARGA — WAJIB IKUTI
SELALU gunakan harga dari seksi "PRICE LIST LIVE" di bawah ini.
JANGAN gunakan harga dari brain.md atau memori lama.
Harga ini sudah di-update langsung oleh Owner dari tampilan Price List.

## PRICE LIST LIVE (dari Supabase — ${new Date().toLocaleString("id-ID")})
${hargaSection}

## DATA BISNIS LIVE (${new Date().toLocaleString("id-ID")})
${JSON.stringify(bizClean, null, 2)}

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
- Edit field  : [ACTION]{"type":"UPDATE_INVOICE","id":"INV-xxx","field":"dadakan","value":50000}[/ACTION]
  Field valid : labor | material | dadakan | discount | notes | due
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
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{"Content-Type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
    body: JSON.stringify({model: model||"claude-sonnet-4-6", max_tokens:1024, system:sys, messages:msgs})
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||"Claude error");
  return d.content?.map(c=>c.text||"").join("")||"";
}

async function callOpenAI(msgs, sys, model) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.OPENAI_API_KEY},
    body: JSON.stringify({model:model||"gpt-4o", max_tokens:1024, messages:[{role:"system",content:sys},...msgs]})
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||"OpenAI error");
  return d.choices?.[0]?.message?.content||"";
}

async function callMinimax(msgs, sys, model) {
  const key      = process.env.MINIMAX_API_KEY;
  const groupId  = process.env.MINIMAX_GROUP_ID || "";
  const r = await fetch("https://api.minimaxi.chat/v1/text/chatcompletion_v2", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
    body: JSON.stringify({
      model: model||"MiniMax-M2.5",
      max_tokens: 1024,
      messages: [{role:"system",content:sys}, ...msgs],
      ...(groupId ? { group_id: groupId } : {})
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.base_resp?.status_msg || d.error?.message || "Minimax error");
  return d.choices?.[0]?.message?.content||"";
}

async function callGroq(msgs, sys, model) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.GROQ_API_KEY},
    body: JSON.stringify({model:model||"llama-3.3-70b-versatile", max_tokens:1024, messages:[{role:"system",content:sys},...msgs]})
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||"Groq error");
  return d.choices?.[0]?.message?.content||"";
}

export default async function handler(req, res) {
  // ── SEC-02: CORS ──
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({error:"Method not allowed"});

  // ── SEC-02: Rate limit 30 req/menit per IP (ARA lebih ketat karena costly) ──
  if (!checkRateLimit(req, res, 30, 60000)) return;

  // ── SEC-02: Validasi internal token ──
  if (!validateInternalToken(req, res)) return;

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

    if (rawProvider && rawProvider !== "claude") {
      console.log(`[ARA-CHAT] Using frontend provider: ${rawProvider}`);
      return rawProvider; // frontend memilih non-claude → ikuti
    }
    if (rawProvider === "claude" && process.env.ANTHROPIC_API_KEY) {
      console.log("[ARA-CHAT] Using frontend Claude + key exists");
      return "claude"; // claude dipilih + key ada
    }
    // Fallback: cek env vars yang tersedia
    if (process.env.MINIMAX_API_KEY) {
      console.log("[ARA-CHAT] Fallback: Using Minimax (env var available)");
      return "minimax";
    }
    if (process.env.OPENAI_API_KEY) {
      console.log("[ARA-CHAT] Fallback: Using OpenAI (env var available)");
      return "openai";
    }
    if (process.env.GROQ_API_KEY) {
      console.log("[ARA-CHAT] Fallback: Using Groq (env var available)");
      return "groq";
    }
    if (process.env.ANTHROPIC_API_KEY) {
      console.log("[ARA-CHAT] Fallback: Using Claude (env var available)");
      return "claude";
    }
    const lastResort = rawProvider || "minimax";
    console.log(`[ARA-CHAT] Last resort provider: ${lastResort}`);
    return lastResort;
  };
  const provider = detectProvider();
  if (!messages?.length) return res.status(400).json({error:"messages wajib diisi"});

  const sys = buildSystem(bizContext, brainMd);

  try {
    let reply = "";
    let usedProvider = provider;

    try {
      switch(provider) {
        case "openai":  reply = await callOpenAI(messages, sys, model);  break;
        case "minimax": reply = await callMinimax(messages, sys, model); break;
        case "groq":    reply = await callGroq(messages, sys, model);    break;
        default:        reply = await callClaude(messages, sys, model);  break;
      }
    } catch(primErr) {
      console.warn(`⚠️ ${provider} failed, trying fallback...`, primErr.message);
      // Fallback chain: try other providers if primary fails
      const fallbackOrder = provider==="minimax" ? ["claude","openai","groq"] : ["minimax","claude","openai","groq"];
      for (const fbProvider of fallbackOrder) {
        if (fbProvider === provider) continue; // skip primary
        try {
          usedProvider = fbProvider;
          switch(fbProvider) {
            case "openai":  reply = await callOpenAI(messages, sys, model);  break;
            case "minimax": reply = await callMinimax(messages, sys, model); break;
            case "groq":    reply = await callGroq(messages, sys, model);    break;
            default:        reply = await callClaude(messages, sys, model);  break;
          }
          console.log(`✅ Fallback to ${fbProvider} success`);
          break;
        } catch(fbErr) {
          console.warn(`❌ ${fbProvider} also failed:`, fbErr.message);
          continue;
        }
      }
      if (!reply) throw primErr; // re-throw if all fallbacks fail
    }

    const now = new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    await sb.from("agent_logs").insert({
      time: now, action:"ARA_CHAT",
      detail:`ARA (${usedProvider}${usedProvider!==provider?" [fallback dr "+provider+"]":""}) — "${messages.at(-1)?.content?.slice(0,50)}..."`,
      status:"SUCCESS"
    });

    return res.status(200).json({reply, provider: usedProvider, primaryProvider: provider});
  } catch(err) {
    const now = new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    await sb.from("agent_logs").insert({time:now,action:"ARA_ERROR",detail:err.message.slice(0,100),status:"ERROR"});
    const friendlyErr = err.message.includes("quota") || err.message.includes("429")
      ? `Rate limit / quota habis untuk semua provider. Tunggu beberapa menit dan coba lagi.`
      : err.message.includes("401") || err.message.includes("403") || err.message.includes("API key")
      ? `API Key ${provider} tidak valid atau belum diset di Vercel env vars.`
      : err.message.includes("ANTHROPIC_API_KEY") || err.message.includes("credit")
      ? `Credit Anthropic habis. Setup provider lain di Vercel Environment Variables.`
      : err.message;
    return res.status(500).json({error: friendlyErr, provider, raw: err.message});
  }
}
