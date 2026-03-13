// api/ara-chat.js
// POST /api/ara-chat { messages, bizContext, provider, model, brainMd }
// Backend proxy ARA — support Claude, OpenAI, Gemini, Groq

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

## PRICE LIST LIVE (dari Supabase — sudah update: ${new Date().toLocaleString("id-ID")})
${hargaSection}

## DATA BISNIS LIVE (${new Date().toLocaleString("id-ID")})
${JSON.stringify(bizClean, null, 2)}

## INSTRUKSI TOOL — jika user minta update data, balas dengan tag [ACTION]:
- Update invoice  : [ACTION]{"type":"UPDATE_INVOICE","id":"INV-xxx","field":"dadakan","value":50000}[/ACTION]
- Lunas           : [ACTION]{"type":"MARK_PAID","id":"INV-xxx"}[/ACTION]
- Approve invoice : [ACTION]{"type":"APPROVE_INVOICE","id":"INV-xxx"}[/ACTION]
- Kirim reminder  : [ACTION]{"type":"SEND_REMINDER","invoice_id":"INV-xxx"}[/ACTION]
- Update order    : [ACTION]{"type":"UPDATE_ORDER_STATUS","id":"JOBxxxxx","status":"COMPLETED"}[/ACTION]`;
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

async function callGemini(msgs, sys, model) {
  const key = process.env.GEMINI_API_KEY;
  const m   = model||"gemini-2.0-flash-lite"; // gemini-2.0-flash-lite = free tier terbaik 2025
  const r   = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      system_instruction:{parts:[{text:sys}]},
      contents: msgs.map(m=>({role:m.role==="assistant"?"model":"user", parts:[{text:m.content}]}))
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||"Gemini error");
  return d.candidates?.[0]?.content?.parts?.[0]?.text||"";
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
    if (rawProvider && rawProvider !== "claude") return rawProvider; // frontend memilih non-claude → ikuti
    if (rawProvider === "claude" && process.env.ANTHROPIC_API_KEY) return "claude"; // claude dipilih + key ada
    // Fallback: cek env vars yang tersedia
    if (process.env.GEMINI_API_KEY)    return "gemini";
    if (process.env.OPENAI_API_KEY)    return "openai";
    if (process.env.GROQ_API_KEY)      return "groq";
    if (process.env.ANTHROPIC_API_KEY) return "claude";
    return rawProvider || "gemini"; // last resort
  };
  const provider = detectProvider();
  if (!messages?.length) return res.status(400).json({error:"messages wajib diisi"});

  const sys = buildSystem(bizContext, brainMd);

  try {
    let reply = "";
    switch(provider) {
      case "openai": reply = await callOpenAI(messages, sys, model); break;
      case "gemini": reply = await callGemini(messages, sys, model); break;
      case "groq":   reply = await callGroq(messages, sys, model);   break;
      default:       reply = await callClaude(messages, sys, model); break;
    }

    const now = new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    await sb.from("agent_logs").insert({
      time: now, action:"ARA_CHAT",
      detail:`ARA (${provider}) — "${messages.at(-1)?.content?.slice(0,50)}..."`,
      status:"SUCCESS"
    });

    return res.status(200).json({reply, provider});
  } catch(err) {
    const now = new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    await sb.from("agent_logs").insert({time:now,action:"ARA_ERROR",detail:err.message.slice(0,100),status:"ERROR"});
    const friendlyErr = err.message.includes("quota") || err.message.includes("429")
      ? `Rate limit / quota habis untuk provider ${provider}. Coba ganti provider di Pengaturan → ARA Brain, atau tunggu beberapa menit.`
      : err.message.includes("401") || err.message.includes("403") || err.message.includes("API key")
      ? `API Key ${provider} tidak valid atau belum diset di Vercel env vars. Cek GEMINI_API_KEY / ANTHROPIC_API_KEY.`
      : err.message.includes("ANTHROPIC_API_KEY") || err.message.includes("credit")
      ? `Credit Anthropic habis. Ganti provider ke Gemini (gratis) di Pengaturan → ARA Brain.`
      : err.message;
    return res.status(500).json({error: friendlyErr, provider, raw: err.message});
  }
}
