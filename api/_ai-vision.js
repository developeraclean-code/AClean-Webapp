// AI Vision classifier — Phase 1
// Dipanggil dari webhook grup saat ada image + group punya AI feature toggle ON.
// Output: saves to ai_extractions + creates pending row di expenses / payment_suggestions
// sesuai intent yang dideteksi.

const ANTHROPIC_MODEL = "claude-haiku-4-5";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// Pricing (per 1M tokens, USD) — claude-haiku-4-5
const PRICE_IN_PER_MTOK  = 1.00;
const PRICE_OUT_PER_MTOK = 5.00;

function buildPrompt(groupCfg) {
  const enabled = [];
  if (groupCfg.ai_expense_enabled)   enabled.push('"expense" — foto struk / nota / kwitansi belanja operasional');
  if (groupCfg.ai_material_enabled)  enabled.push('"material" — foto material yang dibawa teknisi (tabung freon, gulungan pipa, gulungan kabel)');
  if (groupCfg.ai_payment_enabled)   enabled.push('"payment" — bukti transfer / screenshot mutasi bank / setor tunai');

  const intentList = enabled.length > 0 ? enabled.join("\n") : '(tidak ada AI intent aktif untuk grup ini)';

  return `Kamu adalah AI klasifikasi foto WhatsApp bisnis AC service di Indonesia.
Klasifikasikan foto ini ke salah satu intent berikut:
${intentList}
"unknown" — bukan salah satu di atas

Output WAJIB JSON valid (tidak ada prefix/suffix lain), struktur:
{
  "intent": "expense" | "material" | "payment" | "unknown",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "data": { ...field sesuai intent... },
  "reasoning": "1-2 kalimat alasan singkat"
}

Field per intent:
- expense: {
    amount: number,
    merchant: string,
    date: "YYYY-MM-DD"|null,
    category: "petty_cash"|"material_purchase",  // WAJIB salah satu dari 2
    subcategory: string  // WAJIB salah satu nilai exact dibawah, tidak boleh nilai lain
  }
  Aturan subcategory wajib salah satu:
  - Kalau category="petty_cash": "Bensin Motor", "Perbaikan Motor", "Parkir", "Lain-lain"
    (struk makan/tol/jajan/minum → pakai "Lain-lain")
  - Kalau category="material_purchase": "Pipa AC", "Kabel", "Freon", "Material Lain"
  Pilihan category: foto struk bensin SPBU/parkir/perbaikan motor/jajan/makan → "petty_cash".
  Foto nota toko bangunan/pipa/kabel/freon/material → "material_purchase".
- material: { items: [{ type: "freon"|"pipa"|"kabel"|"lain", brand: string|null, size: string|null, qty: number|null }] }
- payment: { amount: number, bank: string, transfer_date: "YYYY-MM-DD"|null, sender_name: string|null, reference: string|null }

Aturan confidence:
- HIGH: semua field terbaca jelas, struk/bukti tidak blur, nominal jelas
- MEDIUM: 1-2 field tidak jelas atau perlu inference
- LOW: foto blur, partial, atau ambigu

Kalau intent tidak cocok dengan apapun → return intent:"unknown", confidence:"LOW", data:{}`;
}

export async function classifyImage({ imageUrl, groupCfg, sender, messageText }) {
  const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "no_anthropic_key" };
  if (!imageUrl) return { error: "no_image_url" };

  const prompt = buildPrompt(groupCfg);
  const userText = messageText ? `Caption WhatsApp: "${messageText}"\n\nKlasifikasikan foto.` : "Klasifikasikan foto.";

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 600,
    system: prompt,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "url", url: imageUrl } },
        { type: "text", text: userText }
      ]
    }]
  };

  let response;
  try {
    const r = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const errTxt = await r.text().catch(() => "");
      return { error: "anthropic_http_" + r.status, detail: errTxt.slice(0, 300) };
    }
    response = await r.json();
  } catch (e) {
    return { error: "anthropic_fetch", detail: e.message };
  }

  const tokensIn  = response?.usage?.input_tokens  || 0;
  const tokensOut = response?.usage?.output_tokens || 0;
  const costUsd   = (tokensIn / 1_000_000) * PRICE_IN_PER_MTOK + (tokensOut / 1_000_000) * PRICE_OUT_PER_MTOK;

  const text = response?.content?.[0]?.text || "";
  let parsed = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (e) {
    return { error: "parse_failed", raw: text.slice(0, 300), tokensIn, tokensOut, costUsd };
  }
  if (!parsed) return { error: "no_json", raw: text.slice(0, 300), tokensIn, tokensOut, costUsd };

  // Normalisasi intent + confidence (handle case variation dari AI)
  const intent = String(parsed.intent || "unknown").toLowerCase().trim();
  const validIntents = new Set(["expense", "material", "payment", "unknown"]);
  const confRaw = String(parsed.confidence || "LOW").toUpperCase().trim();
  const validConf = new Set(["HIGH", "MEDIUM", "LOW"]);
  return {
    intent: validIntents.has(intent) ? intent : "unknown",
    confidence: validConf.has(confRaw) ? confRaw : "LOW",
    data: parsed.data || {},
    reasoning: parsed.reasoning || null,
    tokensIn, tokensOut, costUsd,
    model: ANTHROPIC_MODEL,
  };
}

// Persist classification + buat pending row sesuai intent.
// Returns { extractionId, expenseId?, paymentSuggestionId? }
export async function persistClassification({ SU, SK, classification, sender, groupCfg, imageUrl, messageText, r2Url = null }) {
  if (!SU || !SK) return { error: "no_supabase_env" };
  if (classification.error) return { error: classification.error, detail: classification.detail };

  // Insert ai_extractions
  const extractBody = {
    source: "wa_group",
    source_ref: groupCfg.group_id,
    group_id: groupCfg.group_id,
    sender_phone: sender.phone,
    sender_name: sender.name,
    message_text: messageText || null,
    image_url: imageUrl,
    r2_url: r2Url,
    intent: classification.intent,
    confidence: classification.confidence,
    extracted: classification.data,
    model: classification.model,
    tokens_in: classification.tokensIn,
    tokens_out: classification.tokensOut,
    cost_usd: classification.costUsd,
    status: "pending",
    notes: classification.reasoning,
  };

  const ex = await fetch(SU + "/rest/v1/ai_extractions", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=representation" },
    body: JSON.stringify(extractBody),
  });
  if (!ex.ok) {
    const t = await ex.text().catch(() => "");
    return { error: "extract_insert_failed", detail: t.slice(0, 300) };
  }
  const extractRow = (await ex.json())[0];
  const extractionId = extractRow.id;

  let expenseId = null, paymentSuggestionId = null;

  // Branch by intent + group toggle
  if (classification.intent === "expense" && groupCfg.ai_expense_enabled) {
    const d = classification.data || {};
    const today = new Date().toISOString().slice(0, 10);
    // Normalisasi category → wajib salah satu dari 2 enum existing app
    const validCats = new Set(["petty_cash", "material_purchase"]);
    const cat = validCats.has(d.category) ? d.category : "petty_cash";
    // Whitelist subcategory — harus match exact dgn ExpensesView.PETTY_CASH_SUBS / MATERIAL_SUBS
    const PETTY = new Set(["Bensin Motor", "Perbaikan Motor", "Parkir", "Kasbon Karyawan", "Lembur", "Bonus", "Lain-lain"]);
    const MAT   = new Set(["Pipa AC", "Kabel", "Freon", "Material Lain"]);
    const rawSub = d.subcategory ? String(d.subcategory).trim() : "";
    const sub = cat === "material_purchase"
      ? (MAT.has(rawSub) ? rawSub : "Material Lain")
      : (PETTY.has(rawSub) ? rawSub : "Lain-lain");
    // Robust amount parse — handle "50.000" / "Rp 50,000" / "50000" / 50000
    const parseAmt = (v) => {
      if (typeof v === "number" && Number.isFinite(v)) return Math.abs(v);
      const digits = String(v || "").replace(/[^\d]/g, "");
      return digits ? parseInt(digits, 10) : 0;
    };
    const descParts = [`[AI] ${d.merchant || "Foto struk"}`];
    if (messageText) descParts.push(messageText);
    const expBody = {
      date: d.date || today,
      category: cat,
      subcategory: sub,
      description: descParts.join(" — "),
      amount: parseAmt(d.amount),
      teknisi_name: sender.name,
      created_by: "wa_group_ai",
      validation_status: "PENDING_AI",
      ai_extraction_id: extractionId,
    };
    const r = await fetch(SU + "/rest/v1/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=representation" },
      body: JSON.stringify(expBody),
    });
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      expenseId = rows[0]?.id || null;
      if (expenseId) {
        fetch(SU + "/rest/v1/ai_extractions?id=eq." + extractionId, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK },
          body: JSON.stringify({ linked_table: "expenses", linked_id: String(expenseId) }),
        }).catch(() => {});
      }
    }
  }

  if (classification.intent === "payment" && groupCfg.ai_payment_enabled) {
    const d = classification.data || {};
    const parseAmtP = (v) => {
      if (typeof v === "number" && Number.isFinite(v)) return Math.abs(v);
      const digits = String(v || "").replace(/[^\d]/g, "");
      return digits ? parseInt(digits, 10) : null;
    };
    const sugBody = {
      phone: sender.phone,
      sender_name: sender.name,
      raw_message: messageText || "(foto bukti — grup)",
      image_url: imageUrl,
      amount: parseAmtP(d.amount),
      bank: d.bank || null,
      transfer_date: d.transfer_date || null,
      status: "PENDING",
      source: "wa_group_ai",
      validation_status: "PENDING",
      ai_extraction_id: extractionId,
    };
    const r = await fetch(SU + "/rest/v1/payment_suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=representation" },
      body: JSON.stringify(sugBody),
    });
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      paymentSuggestionId = rows[0]?.id || null;
      if (paymentSuggestionId) {
        fetch(SU + "/rest/v1/ai_extractions?id=eq." + extractionId, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK },
          body: JSON.stringify({ linked_table: "payment_suggestions", linked_id: String(paymentSuggestionId) }),
        }).catch(() => {});
      }
    }
  }

  // material intent → TODO Phase 1.5: link to job_materials_brought with dedup check
  // (lihat CLAUDE.md memory: dedup per sender+material_type+job_today)

  return { extractionId, expenseId, paymentSuggestionId };
}
