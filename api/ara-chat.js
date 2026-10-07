// api/ara-chat.js
// POST /api/ara-chat { messages, bizContext, provider, model, brainMd }
// Backend proxy ARA — support Claude, OpenAI, Groq

import { buildAraSystem, ARA_INTERNAL_DEFAULT } from "../src/lib/araPolicy.js";
import { createClient }                                 from "@supabase/supabase-js";
import { validateInternalToken, checkRateLimit, setCorsHeaders, fetchWithTimeout } from "./_auth.js";
import { logAiUsage, extractAnthropicUsage, extractOpenAIUsage, logStructured } from "./_logger.js";

const sb = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export const buildSystem = (biz, brain, training, prices, message) => buildAraSystem({
  audience: "internal", brain, training, prices, message, context: biz,
}) + `
\nUSULAN TINDAKAN:
Gunakan maksimal 3 tag [ACTION]{"type":"...","id":"..."}[/ACTION] hanya saat diminta pengguna.
Tag hanya membuka usulan review; tidak menjalankan transaksi. Jangan mengklaim berhasil.
Jenis: CREATE_ORDER, BULK_CREATE_ORDER, RESCHEDULE_ORDER, UPDATE_ORDER_STATUS, CANCEL_ORDER, DISPATCH_WA,
CREATE_INVOICE (review Laporan Tim), UPDATE_INVOICE, MARK_PAID, APPROVE_INVOICE, SEND_REMINDER,
MARK_INVOICE_OVERDUE, UPDATE_STOCK, CREATE_EXPENSE, SEND_WA.
Gunakan order_id untuk CREATE_INVOICE/RESCHEDULE_ORDER, invoice_id untuk SEND_REMINDER, id untuk invoice/order lain.
Sertakan nilai yang diusulkan untuk membantu review. Jangan membuat ID atau fakta yang tidak tersedia.
Pembayaran, stok, finalisasi laporan, multi-team, pajak dan DP mengikuti validasi modul resmi.
Data agregat pada konteks berasal dari data yang dimuat browser; jangan menyebutnya total bisnis lengkap.
`;

async function callClaude(msgs, sys, model) {
  const ALLOWED_CLAUDE = ["claude-haiku-4-5"];
  const safeModel = ALLOWED_CLAUDE.includes(model) ? model : "claude-haiku-4-5";
  const apiKey = (process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim();
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
      "x-api-key":apiKey,
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
  const safeModel = model === "gpt-6-luna" ? model : "gpt-6-luna";
  const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.OPENAI_API_KEY},
    body: JSON.stringify({model:safeModel, reasoning_effort:"none", max_completion_tokens:1024, messages:[{role:"system",content:sys},...msgs]})
  }, 30000);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message||"OpenAI error");
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

  const { messages, bizContext={}, provider: rawProvider, model, imageData, imageType } = req.body||{};
  // Pilihan provider eksplisit tidak boleh dialihkan diam-diam ke layanan lain.
  const detectProvider = () => {
    const chosen = rawProvider || "claude";
    if (!["claude", "openai", "groq"].includes(chosen)) return null;
    return chosen;
  };
  const provider = detectProvider();
  if (!provider) return res.status(400).json({ error: "Provider ARA tidak dikenal" });
  const providerKey = { claude: "ANTHROPIC_API_KEY / LLM_API_KEY", openai: "OPENAI_API_KEY", groq: "GROQ_API_KEY" }[provider];
  const hasProviderKey = provider === "claude"
    ? !!(process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY)
    : !!process.env[providerKey];
  if (!hasProviderKey) return res.status(503).json({ error: `${providerKey} belum dikonfigurasi` });
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({error:"messages wajib diisi"});

  let role = req.appClaims?.role;
  if (!role && req.authUser?.id) {
    const { data, error } = await sb.from("user_profiles").select("role").eq("id", req.authUser.id).single();
    if (!error) role = data?.role;
  }
  if (!["Owner", "Admin"].includes(role)) return res.status(403).json({ error: "ARA internal hanya untuk Owner/Admin" });
  if (!Array.isArray(messages) || messages.length > 30 || messages.some(m =>
    !["user", "assistant"].includes(m?.role) || typeof m.content !== "string" || m.content.length > 12000)
    || messages.at(-1)?.role !== "user") return res.status(400).json({ error: "Format percakapan tidak valid" });
  if (imageData && (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(imageType) || typeof imageData !== "string" || imageData.length > 8000000)) {
    return res.status(400).json({ error: "Gambar tidak valid atau terlalu besar" });
  }
  let sys;
  try {
    const [brains, rules, prices] = await Promise.all([
      sb.from("ara_brain").select("key,value").in("key", ["brain_md", "brain_customer"]),
      sb.from("app_settings").select("value").eq("key", "ara_training_rules").maybeSingle(),
      sb.from("harga_layanan").select("service,type,harga").order("service").limit(250),
    ]);
    if (brains.error || rules.error || prices.error) throw new Error("SOP/training/price list belum dapat dimuat. Coba lagi.");
    const saved = Object.fromEntries((brains.data || []).map(x => [x.key, x.value]));
    const brain = saved.brain_md === saved.brain_customer ? ARA_INTERNAL_DEFAULT : saved.brain_md;
    // Saved server configuration is authoritative, not arbitrary client brain/price overrides.
    const { hargaLayanan: _h, priceList: _p, ...context } = bizContext;
    sys = buildSystem(context, brain, rules.data?.value, prices.data || [], messages.at(-1).content);
  } catch (error) { return res.status(503).json({ error: error.message }); }
  const messagesWithImage = imageData ? messages.map((message, index) => {
    if (index !== messages.length - 1 || message.role !== "user") return message;
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    return { ...message, content: [
      { type: "text", text: content },
      { type: "image_url", image_url: { url: `data:${imageType || "image/jpeg"};base64,${imageData}` } },
    ] };
  }) : messages;

  const callStart = Date.now();
  try {
    let callResult = null;
    let usedProvider = provider;

    const runCall = async (p) => {
      switch(p) {
        case "openai":  return await callOpenAI(messagesWithImage, sys, model);
        case "groq":    return await callGroq(messages, sys, model);
        default:        return await callClaude(imageData ? messages.map((message, index) => {
          if (index !== messages.length - 1 || message.role !== "user") return message;
          return { ...message, content: [
            { type: "image", source: { type: "base64", media_type: imageType || "image/jpeg", data: imageData } },
            { type: "text", text: typeof message.content === "string" ? message.content : JSON.stringify(message.content) },
          ] };
        }) : messages, sys, model);
      }
    };

    try {
      callResult = await runCall(provider);
    } catch(primErr) {
      if (rawProvider) throw primErr;
      console.warn(`⚠️ ${provider} failed, trying fallback...`, primErr.message);
      const fallbackOrder = provider==="claude" ? ["openai","groq"] : ["claude","openai","groq"];
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
      ? `Rate limit atau kuota provider ${provider} bermasalah. Periksa hasil uji koneksi dan billing provider.`
      : err.message.includes("401") || err.message.includes("403") || err.message.includes("API key")
      ? `API Key ${provider} tidak valid atau belum diset di Vercel env vars.`
      : err.message.includes("ANTHROPIC_API_KEY") || err.message.includes("credit")
      ? `Credit Anthropic habis. Setup provider lain di Vercel Environment Variables.`
      : `Terjadi kesalahan internal. Coba lagi atau hubungi support.`;
    return res.status(500).json({error: friendlyErr, provider});
  }
}
