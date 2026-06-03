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

// Accept either:
//   { imageUrl }                          — Anthropic fetches by URL (fragile kalau Fonnte TTL habis)
//   { imageBase64, mimeType }             — kirim base64 langsung (tahan TTL Fonnte)
export async function classifyImage({ imageUrl, imageBase64, mimeType, groupCfg, sender, messageText }) {
  const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "no_anthropic_key" };
  if (!imageUrl && !imageBase64) return { error: "no_image" };

  const prompt = buildPrompt(groupCfg);
  const userText = messageText ? `Caption WhatsApp: "${messageText}"\n\nKlasifikasikan foto.` : "Klasifikasikan foto.";

  const imageContent = imageBase64
    ? { type: "image", source: { type: "base64", media_type: mimeType || "image/jpeg", data: imageBase64 } }
    : { type: "image", source: { type: "url", url: imageUrl } };

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 600,
    system: prompt,
    messages: [{
      role: "user",
      content: [
        imageContent,
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

  // Log cost ke ai_usage SEKARANG (sebelum parse) — tetap track meski hasil parse fail
  const SU0 = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK0 = process.env.SUPABASE_SERVICE_KEY;
  const logUsage = (extra = {}) => {
    if (!SU0 || !SK0) return;
    fetch(SU0 + "/rest/v1/ai_usage", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SK0, Authorization: "Bearer " + SK0, Prefer: "return=minimal" },
      body: JSON.stringify({
        provider: "claude",
        model: ANTHROPIC_MODEL,
        feature: "wa-group-vision",
        input_tokens: tokensIn,
        output_tokens: tokensOut,
        cost_usd: costUsd,
        user_name: sender?.name || null,
        metadata: { group_id: groupCfg?.group_id, ...extra },
      }),
    }).catch(() => {});
  };

  const text = response?.content?.[0]?.text || "";
  let parsed = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (e) {
    logUsage({ status: "parse_failed" });
    return { error: "parse_failed", raw: text.slice(0, 300), tokensIn, tokensOut, costUsd };
  }
  if (!parsed) { logUsage({ status: "no_json" }); return { error: "no_json", raw: text.slice(0, 300), tokensIn, tokensOut, costUsd }; }

  // Normalisasi intent + confidence (handle case variation dari AI)
  const intent = String(parsed.intent || "unknown").toLowerCase().trim();
  const validIntents = new Set(["expense", "material", "payment", "unknown"]);
  const confRaw = String(parsed.confidence || "LOW").toUpperCase().trim();
  const validConf = new Set(["HIGH", "MEDIUM", "LOW"]);
  const result = {
    intent: validIntents.has(intent) ? intent : "unknown",
    confidence: validConf.has(confRaw) ? confRaw : "LOW",
    data: parsed.data || {},
    reasoning: parsed.reasoning || null,
    tokensIn, tokensOut, costUsd,
    model: ANTHROPIC_MODEL,
  };
  logUsage({ intent: result.intent, confidence: result.confidence });
  return result;
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

  // Material intent — auto-tag ke job_materials_brought dgn dedup per (job, material_type, today)
  let materialJobId = null;
  let materialSkipped = null;
  let materialInsertedCount = 0;
  let materialDupCount = 0;
  if (classification.intent === "material" && groupCfg.ai_material_enabled) {
    const d = classification.data || {};
    const items = Array.isArray(d.items) ? d.items : [];
    if (items.length === 0) {
      // AI bilang material tapi tidak extract item — flag untuk Owner review
      materialSkipped = "AI tidak bisa extract item material";
    } else if (items.length > 0) {
      // Find sender's today job (Asia/Jakarta = UTC+7)
      const todayJkt = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
      const orderUrl = SU + "/rest/v1/orders?select=id,customer,teknisi,teknisi2,teknisi3,helper,helper2,helper3,team_slot,date,status"
        + "&date=eq." + encodeURIComponent(todayJkt)
        + "&status=in.(SCHEDULED,IN_PROGRESS,ON_SITE,WORKING)&limit=50";
      let todayOrders = [];
      try {
        const r = await fetch(orderUrl, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
        if (r.ok) todayOrders = await r.json();
      } catch (_) {}
      const sLow = String(sender.name || "").toLowerCase();
      const senderJobs = todayOrders.filter(o => {
        const slots = [o.teknisi, o.teknisi2, o.teknisi3, o.helper, o.helper2, o.helper3];
        return slots.some(s => s && String(s).toLowerCase() === sLow);
      });
      if (senderJobs.length === 1) {
        const job = senderJobs[0];
        materialJobId = job.id;
        // Dedup: per (job_id, material_type, today)
        const startToday = todayJkt + "T00:00:00Z";
        const endToday   = todayJkt + "T23:59:59Z";
        for (const it of items) {
          const matType = String(it.type || "").toLowerCase();
          if (!matType) continue;
          // Cek existing
          const dupUrl = SU + "/rest/v1/job_materials_brought?select=id,brought_by"
            + "&job_id=eq." + encodeURIComponent(job.id)
            + "&material_type=eq." + encodeURIComponent(matType)
            + "&brought_at=gte." + encodeURIComponent(startToday)
            + "&brought_at=lte." + encodeURIComponent(endToday)
            + "&status=neq.RETURNED&limit=1";
          let existing = [];
          try {
            const dr = await fetch(dupUrl, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
            if (dr.ok) existing = await dr.json();
          } catch (_) {}
          if (existing.length > 0) {
            materialDupCount++;
            materialSkipped = `${matType} sudah dicatat oleh ${existing[0].brought_by || "tim"}`;
            continue;
          }
          materialInsertedCount++;
          const matBody = {
            job_id: job.id,
            material_type: matType,
            inventory_name: [it.brand, it.size].filter(Boolean).join(" ") || `${matType} (AI)`,
            qty_estimate: Number(it.qty) || 1,
            brought_at: new Date().toISOString(),
            brought_by: sender.name,
            status: "BROUGHT",
            notes: `[AI vision] ${classification.reasoning || ""}`.trim(),
          };
          await fetch(SU + "/rest/v1/job_materials_brought", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
            body: JSON.stringify(matBody),
          }).catch(() => {});
        }
        // Patch ai_extractions linked_id
        await fetch(SU + "/rest/v1/ai_extractions?id=eq." + extractionId, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK },
          body: JSON.stringify({ linked_table: "job_materials_brought", linked_id: job.id, notes: classification.reasoning + (materialSkipped ? " | DEDUP: " + materialSkipped : "") }),
        }).catch(() => {});
      } else {
        // 0 atau >1 job → notes saja (ambiguous), Owner review manual via MatTrack
        await fetch(SU + "/rest/v1/ai_extractions?id=eq." + extractionId, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK },
          body: JSON.stringify({ notes: (classification.reasoning || "") + ` | AMBIGUOUS: ${senderJobs.length} job today` }),
        }).catch(() => {});
      }
    }
  }

  return { extractionId, expenseId, paymentSuggestionId, materialJobId, materialSkipped, materialInsertedCount, materialDupCount };
}
