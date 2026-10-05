// Provider vision terpisah dari ARA. Default tetap Claude sampai Owner mengubahnya.
export const OPENAI_VISION_MODEL = "gpt-6-luna";
export const CLAUDE_VISION_MODEL = "claude-haiku-4-5";

let cachedProvider = "claude";
let cacheUntil = 0;

export async function getVisionProvider({ fetchImpl = fetch, now = Date.now() } = {}) {
  if (now < cacheUntil) return cachedProvider;
  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SU || !SK) return cachedProvider;
  try {
    const r = await fetchImpl(`${SU}/rest/v1/app_settings?key=eq.vision_provider&select=value`, {
      headers: { apikey: SK, Authorization: `Bearer ${SK}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) throw new Error(`settings HTTP ${r.status}`);
    const rows = await r.json();
    cachedProvider = rows?.[0]?.value === "openai" ? "openai" : "claude";
    cacheUntil = now + 30_000;
  } catch (error) {
    // Jangan diam-diam memakai provider lain ketika setting gagal dibaca.
    throw new Error(`AI Vision provider setting unavailable: ${error.message}`);
  }
  return cachedProvider;
}

export async function callVision({ imageBase64, imageUrl, mimeType = "image/jpeg", prompt, system, maxTokens = 600, timeoutMs = 25000, fetchImpl = fetch, provider: forcedProvider, claudeApiKey }) {
  if (!imageBase64 && !imageUrl) throw new Error("vision image missing");
  const provider = forcedProvider || await getVisionProvider({ fetchImpl });
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY belum dikonfigurasi untuk AI Vision");
    const url = imageBase64 ? `data:${mimeType};base64,${imageBase64}` : imageUrl;
    const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: OPENAI_VISION_MODEL,
        reasoning_effort: "none",
        max_completion_tokens: maxTokens,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url, detail: "high" } },
          ] },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`OpenAI vision HTTP ${r.status}: ${data.error?.code || data.error?.message || "unknown"}`);
    return {
      provider, model: OPENAI_VISION_MODEL,
      text: data.choices?.[0]?.message?.content || "",
      usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 }, raw: data,
    };
  }
  const key = (claudeApiKey || process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY belum dikonfigurasi untuk AI Vision");
  const image = imageBase64
    ? { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } }
    : { type: "image", source: { type: "url", url: imageUrl } };
  const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: CLAUDE_VISION_MODEL, max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: [image, { type: "text", text: prompt }] }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude vision HTTP ${r.status}: ${data.error?.type || data.error?.message || "unknown"}`);
  return { provider, model: CLAUDE_VISION_MODEL, text: (data.content || []).map(c => c.text || "").join(""), usage: data.usage || {}, raw: data };
}
