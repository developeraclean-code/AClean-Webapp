import { createHash } from "node:crypto";
import { ARA_POLICY_VERSION, assessCustomerReply, buildAraSystem, buildCustomerHistory, customerDecision, fallbackCustomerReply, formatAraCustomerReply } from "../src/lib/araPolicy.js";
import { deliverWorkspaceMessage, dispatchWorkspaceMessage } from "./_wa-workspace.js";
import { logAiUsageRest } from "./_logger.js";

export function araReviewId(phone, sourceKey) {
  const hex = createHash("sha256").update(`ara-v1:${phone}:${sourceKey}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export async function generateCustomerReply({ provider, system, history, fetchImpl = fetch, recordUsage = logAiUsageRest }) {
  const openai = provider === "openai";
  const key = openai ? process.env.OPENAI_API_KEY : (process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY);
  if (!key) throw new Error(`API key ${provider} belum tersedia`);
  const model = openai ? "gpt-6-luna" : "claude-haiku-4-5";
  const started = Date.now();
  try {
    const response = await fetchImpl(openai ? "https://api.openai.com/v1/chat/completions" : "https://api.anthropic.com/v1/messages", {
      method: "POST", headers: openai ? { "Content-Type": "application/json", Authorization: `Bearer ${key}` } : { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(openai ? { model, reasoning_effort: "none", max_completion_tokens: 700, messages: [{ role: "system", content: system }, ...history] } : { model, max_tokens: 700, system, messages: history }),
      signal: AbortSignal.timeout(18000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Provider ${provider} HTTP ${response.status} (${data.error?.code || data.error?.type || "error"})`);
    const reply = openai ? data.choices?.[0]?.message?.content : data.content?.filter(c => c.type === "text").map(c => c.text).join("\n");
    if (typeof reply !== "string" || !reply.trim()) throw new Error("Provider memberikan jawaban kosong");
    await recordUsage({ SU: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, SK: process.env.SUPABASE_SERVICE_KEY, provider, model, feature: "wa-ara-customer", duration_ms: Date.now() - started, usage: openai ? { input_tokens: data.usage?.prompt_tokens, output_tokens: data.usage?.completion_tokens } : data.usage });
    return reply.trim();
  } catch (error) {
    await recordUsage({ SU: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, SK: process.env.SUPABASE_SERVICE_KEY, provider, model, feature: "wa-ara-customer", duration_ms: Date.now() - started, error: error.message });
    throw error;
  }
}

// All generated content goes to review. Only deterministic greeting/thanks may auto-send.
export async function processAraCustomer({ db, phone, message, sourceKey, chatbotOn, autoOn, internal = false, generate = generateCustomerReply, deliver = deliverWorkspaceMessage }) {
  if ((!chatbotOn && !autoOn) || internal || !String(message || "").trim()) return { replied: false, skipped: true };
  if (!/^[0-9]{8,15}$/.test(phone) || !sourceKey) throw new Error("Identitas pesan ARA tidak valid");
  const id = araReviewId(phone, sourceKey);
  const { error: claimError } = await db.from("wa_ara_reviews").insert({ id, phone, policy_version: ARA_POLICY_VERSION });
  if (claimError?.code === "23505") return { replied: false, replayed: true, review_id: id };
  if (claimError) throw new Error(`Antrean ARA belum siap: ${claimError.message}`);
  const save = async patch => {
    const { error } = await db.from("wa_ara_reviews").update(patch).eq("id", id);
    if (error) throw new Error(`Status ARA gagal disimpan: ${error.message}`);
  };
  let attemptedSend = false;
  try {
    const [settings, brains, prices, history] = await Promise.all([
      db.from("app_settings").select("key,value").in("key", ["llm_provider", "wa_ara_mode", "ara_training_rules", "wa_chatbot_enabled", "wa_autoreply_enabled"]),
      db.from("ara_brain").select("value").eq("key", "brain_customer").maybeSingle(),
      db.from("harga_layanan").select("service,type,harga").order("service").limit(250),
      db.from("wa_messages").select("role,content").eq("phone", phone).order("created_at", { ascending: false }).limit(12),
    ]);
    if (settings.error || brains.error || prices.error || history.error) throw new Error("Data SOP/training/harga/riwayat belum dapat dimuat");
    const cfg = Object.fromEntries((settings.data || []).map(x => [x.key, x.value]));
    if (cfg.wa_chatbot_enabled !== "true" && cfg.wa_autoreply_enabled !== "true") {
      await save({ status: "DISMISSED", reasons: ["Balasan telah dinonaktifkan"] });
      return { replied: false, skipped: true, review_id: id };
    }
    const decision = customerDecision(message);
    const system = buildAraSystem({ brain: brains.data?.value, training: cfg.ara_training_rules, message, prices: prices.data || [] });
    let reply = decision.reply;
    let reasons = [];
    if (!reply && chatbotOn && cfg.wa_chatbot_enabled === "true") {
      try { reply = await generate({ provider: cfg.llm_provider === "openai" ? "openai" : "claude", system, history: buildCustomerHistory(history.data || [], message) }); }
      catch (error) { reasons.push(error.message); }
    }
    reply ||= fallbackCustomerReply(decision.intent);
    const assessment = assessCustomerReply(reply, prices.data || [], message);
    if (!assessment.ok) { reasons.push(...assessment.reasons); reply = decision.reply || fallbackCustomerReply(decision.intent); }
    if (decision.review) reasons.push("Perlu pemeriksaan Admin: " + decision.intent);
    reply = formatAraCustomerReply(reply);
    const autoSafe = cfg.wa_ara_mode === "auto_safe" && !decision.review && !!decision.reply && assessment.ok && !reasons.length;
    await save({ status: autoSafe ? "GENERATING" : "PENDING", reply, intent: decision.intent, reasons });
    if (!autoSafe) return { replied: false, review_id: id, pending: true };
    // Recheck the kill switch immediately before any external send.
    const latest = await db.from("app_settings").select("key,value").in("key", ["wa_ara_mode", "wa_chatbot_enabled", "wa_autoreply_enabled"]);
    const flags = Object.fromEntries((latest.data || []).map(x => [x.key, x.value]));
    if (latest.error || flags.wa_ara_mode !== "auto_safe" || (flags.wa_chatbot_enabled !== "true" && flags.wa_autoreply_enabled !== "true")) {
      await save({ status: "PENDING", reasons: ["Pengiriman otomatis dibatalkan; perlu tinjau Admin"] });
      return { replied: false, review_id: id, pending: true };
    }
    attemptedSend = true;
    const row = await dispatchWorkspaceMessage(db, id, { phone, kind: "TEXT", message: reply, customer_id: null, document_id: null, url: null, filename: null }, "ARA", deliver);
    await save({ status: row.status === "ACCEPTED" ? "ACCEPTED" : row.status === "FAILED" ? "FAILED" : "UNCERTAIN", reasons: [...reasons, ...(row.error ? [row.error] : [])] });
    return { replied: row.status === "ACCEPTED", delivery: row.status, review_id: id, audit_pending: !!row.audit_pending };
  } catch (error) {
    await save({ status: attemptedSend ? "UNCERTAIN" : "FAILED", reasons: [error.message] }).catch(saveError => console.error("[ARA_REVIEW_AUDIT_FAILED]", saveError.message));
    throw error;
  }
}
