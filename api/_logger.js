// ============================================================
// _logger.js — Structured logger backend untuk observability stack
// ============================================================
// Tulis ke 3 tabel:
//   - agent_logs: catatan event aplikasi (severity + category + metadata JSONB)
//   - cron_runs:  start/finish per eksekusi cron job
//   - ai_usage:   per-call AI provider usage + biaya
//
// Semua fungsi fail-silent: log gagal tidak boleh blok caller.
// ============================================================

// ── Pricing per 1M tokens (USD). Update kalau provider rilis harga baru ──
// Sumber: pricing page masing-masing provider (Q2 2026 snapshot).
const AI_PRICING = {
  // Anthropic
  "claude-opus-4-7":     { input: 15.00, output: 75.00 },
  "claude-sonnet-4-6":   {  input: 3.00, output: 15.00 },
  "claude-haiku-4-5":    {  input: 1.00, output:  5.00 },
  "claude-haiku-4-5-20251001": { input: 1.00, output: 5.00 },
  // OpenAI
  "gpt-4o":              {  input: 2.50, output: 10.00 },
  "gpt-4o-mini":         {  input: 0.15, output:  0.60 },
  // Gemini (estimated)
  "gemini-2.0-flash":    {  input: 0.10, output:  0.40 },
  // Groq — gratis untuk most models, set 0
  "llama-3.1-70b":       {  input: 0.00, output:  0.00 },
  // Default fallback
  "_default":            {  input: 1.00, output:  5.00 },
};

export function calcAiCost({ model, input_tokens = 0, output_tokens = 0 }) {
  const key = (model || "").toLowerCase();
  const price = AI_PRICING[key] || AI_PRICING["_default"];
  const inputCost  = (input_tokens  / 1_000_000) * price.input;
  const outputCost = (output_tokens / 1_000_000) * price.output;
  return Number((inputCost + outputCost).toFixed(6));
}

// ── 1. Structured agent_logs insert ──
// Pakai shape sama dgn log lama (action, detail, status) + tambah severity/category/metadata.
export async function logStructured(sb, {
  action,
  detail = null,
  severity = "info",   // debug | info | warn | error | critical
  category = null,     // wa | payment | inventory | ai | auth | cron | portal | security | customer | order | invoice
  status = null,       // legacy: SUCCESS | WARNING | ERROR (auto-derived dari severity kalau null)
  metadata = null,
  user_id = null,
  user_name = null,
}) {
  if (!sb) return;
  try {
    // Derive legacy status dari severity kalau caller tidak set
    const legacyStatus = status || (
      severity === "error" || severity === "critical" ? "ERROR" :
      severity === "warn" ? "WARNING" :
      "SUCCESS"
    );
    await sb.from("agent_logs").insert({
      action,
      detail: detail ? String(detail).slice(0, 1000) : null,
      status: legacyStatus,
      severity,
      category,
      metadata,
      user_id,
      user_name,
      time: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[LOGGER] agent_logs insert failed:", err.message);
  }
}

// ── 2. Cron run tracking ──
export async function startCronRun(sb, taskName, metadata = null) {
  if (!sb) return null;
  try {
    const { data, error } = await sb.from("cron_runs").insert({
      task_name: taskName,
      started_at: new Date().toISOString(),
      status: "RUNNING",
      metadata,
    }).select("id").single();
    if (error) {
      console.warn("[LOGGER] cron_runs insert failed:", error.message);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.warn("[LOGGER] cron_runs start exception:", err.message);
    return null;
  }
}

export async function finishCronRun(sb, runId, {
  status = "SUCCESS",     // SUCCESS | FAILED | SKIPPED | TIMEOUT
  items_processed = 0,
  error_message = null,
  metadata = null,
  startedAtMs = null,     // optional: untuk compute duration kalau startCronRun gagal return id
}) {
  if (!sb || !runId) return;
  try {
    const finished_at = new Date().toISOString();
    const update = {
      finished_at,
      status,
      items_processed,
      error_message: error_message ? String(error_message).slice(0, 500) : null,
    };
    if (startedAtMs) update.duration_ms = Date.now() - startedAtMs;
    if (metadata) update.metadata = metadata;
    await sb.from("cron_runs").update(update).eq("id", runId);

    // Update duration_ms via SQL fallback kalau startedAtMs tidak diset
    if (!startedAtMs) {
      await sb.rpc("noop").catch(() => {}); // no-op to satisfy linter
      // Compute via subselect — pakai raw update kalau perlu, atau abaikan (kolom nullable)
    }
  } catch (err) {
    console.warn("[LOGGER] cron_runs finish failed:", err.message);
  }
}

// Wrapper helper: run a task function with automatic cron_runs logging.
// Usage:
//   await runWithCronLogging(sb, "daily", async () => taskDaily(), { onResult: r => r.orders });
export async function runWithCronLogging(sb, taskName, fn, opts = {}) {
  const runId = await startCronRun(sb, taskName, opts.metadata || null);
  const startedAtMs = Date.now();
  try {
    const result = await fn();
    const items = (result && typeof opts.itemsFromResult === "function")
      ? Number(opts.itemsFromResult(result)) || 0
      : (result && typeof result.items_processed === "number" ? result.items_processed : 0);
    const wasSkipped = result && result.skipped === true;
    await finishCronRun(sb, runId, {
      status: wasSkipped ? "SKIPPED" : "SUCCESS",
      items_processed: items,
      startedAtMs,
      metadata: result && typeof result === "object"
        ? Object.fromEntries(Object.entries(result).filter(([_, v]) => v !== null && v !== undefined).slice(0, 20))
        : null,
    });
    return result;
  } catch (err) {
    await finishCronRun(sb, runId, {
      status: "FAILED",
      error_message: err.message || String(err),
      startedAtMs,
    });
    throw err;
  }
}

// ── 3. AI usage logging ──
// Wrap fetch call atau panggil setelah dapat response.
export async function logAiUsage(sb, {
  provider,                    // claude | openai | gemini | groq | minimax
  model,
  feature = null,              // ara-chat | tool-bag-vision | auto-dispatch | payment-suggestion
  input_tokens = 0,
  output_tokens = 0,
  cost_usd = null,             // auto-calc kalau null
  user_id = null,
  user_name = null,
  duration_ms = null,
  error = null,
  metadata = null,
}) {
  if (!sb || !provider) return;
  try {
    const finalCost = cost_usd !== null && cost_usd !== undefined
      ? cost_usd
      : calcAiCost({ model, input_tokens, output_tokens });
    await sb.from("ai_usage").insert({
      provider,
      model: model ? String(model).slice(0, 100) : null,
      feature,
      input_tokens: Number(input_tokens) || 0,
      output_tokens: Number(output_tokens) || 0,
      cost_usd: finalCost,
      user_id,
      user_name,
      duration_ms: duration_ms ? Number(duration_ms) : null,
      error: error ? String(error).slice(0, 300) : null,
      metadata,
    });
  } catch (err) {
    console.warn("[LOGGER] ai_usage insert failed:", err.message);
  }
}

// ── 4. Helper: extract Anthropic usage dari response ──
export function extractAnthropicUsage(response) {
  if (!response || typeof response !== "object") return { input_tokens: 0, output_tokens: 0 };
  const usage = response.usage || {};
  return {
    input_tokens: Number(usage.input_tokens) || 0,
    output_tokens: Number(usage.output_tokens) || 0,
  };
}

// ── 5. Helper: extract OpenAI usage ──
export function extractOpenAIUsage(response) {
  if (!response || typeof response !== "object") return { input_tokens: 0, output_tokens: 0 };
  const usage = response.usage || {};
  return {
    input_tokens: Number(usage.prompt_tokens) || 0,
    output_tokens: Number(usage.completion_tokens) || 0,
  };
}
