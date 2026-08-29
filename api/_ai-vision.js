// AI Vision classifier — Phase 1
// Dipanggil dari webhook grup saat ada image + group punya AI feature toggle ON.
// Output: saves to ai_extractions + creates pending row di expenses / payment_suggestions
// sesuai intent yang dideteksi.

import { expenseDuplicateExists, buildExpenseDedupKey } from "./_expense-dedup.js";
import { calcAiCost } from "./_logger.js";
import * as Sentry from "@sentry/node";

// Helper: ganti `.catch(() => {})` agar exception ke-track di Sentry
const sentryCatch = (op, extra) => (e) => {
  try { Sentry.captureException(e, { tags: { op }, extra: extra || {} }); } catch (_) {}
};

const ANTHROPIC_MODEL = "claude-haiku-4-5";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// Harga diambil dari tabel tunggal di _logger.js (dulu diduplikasi di sini → rawan drift).

// Gating confidence — draft (expense/payment) hanya dibuat bila confidence >= ambang.
const CONF_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3 };
function meetsMinConfidence(conf, min) {
  return (CONF_RANK[String(conf || "LOW").toUpperCase()] || 1) >= (CONF_RANK[String(min || "MEDIUM").toUpperCase()] || 2);
}

// Sanitasi tanggal dari AI — model kadang balas "unknown"/"tidak tersedia"/teks
// lain alih-alih null. Kalau string non-tanggal itu masuk ke kolom `date`,
// Postgres tolak (22007) & SELURUH insert payment_suggestions gagal → bukti bayar
// customer hilang. Terima hanya YYYY-MM-DD valid; selain itu null. (Insiden 9-15 Agu 2026)
export function safeDateStr(v) {
  if (!v || typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : s;
}

function buildPrompt(groupCfg) {
  // Prompt disusun HANYA dari intent yang aktif di grup ini. Blok aturan & spesifikasi
  // field untuk intent yang OFF tidak ikut dikirim — dulu seluruh 90 baris dikirim
  // apa pun togglenya, padahal hasil intent yang OFF tetap dibuang oleh gate
  // `groupCfg.ai_*_enabled` di persistClassification(). Itu murni token terbakar.
  const onExp = !!groupCfg.ai_expense_enabled;
  const onMat = !!groupCfg.ai_material_enabled;
  const onPay = !!groupCfg.ai_payment_enabled;

  const enabled = [];
  if (onExp) enabled.push('"expense" — foto struk / nota / kwitansi belanja operasional');
  if (onMat) enabled.push('"material" — foto material yang dibawa teknisi (tabung freon, gulungan pipa, gulungan kabel)');
  if (onPay) enabled.push('"payment" — bukti transfer / screenshot mutasi bank / setor tunai');
  const intentList = enabled.length > 0 ? enabled.join("\n") : '(tidak ada AI intent aktif untuk grup ini)';

  // Enum intent di output JSON ikut menyempit → model tidak bisa memilih intent mati.
  const intentEnum = [
    ...(onExp ? ['"expense"'] : []),
    ...(onMat ? ['"material"'] : []),
    ...(onPay ? ['"payment"'] : []),
    '"unknown"',
  ].join(" | ");

  // ── Aturan prioritas — hanya yang relevan, dinomori ulang otomatis ──
  const rules = [];
  if (onPay) rules.push(`Kalau foto = bukti pembayaran MASUK ke kita (screenshot transfer BERHASIL /
   mutasi bank bertanda kredit-masuk / bukti setor tunai — umumnya customer membayar
   tagihan) → "payment". Ini UANG MASUK, bukan pembelian. Ciri: tampilan m-banking/e-wallet
   "Transfer Berhasil/Sukses", ada nominal + bank/tujuan, TIDAK ada daftar barang yang dibeli.${onExp ? '\n   Aturan expense di bawah TIDAK berlaku untuk ini.' : ''}`);
  if (onExp) rules.push(`${onPay ? "Selain payment di atas: ada" : "Ada"} NOMINAL RUPIAH, atau kata beli/pembelian/bayar/transfer/tf/
   harga/nota/bon/faktur/kwitansi/struk untuk UANG KELUAR (tim membeli barang/jasa)
   → "expense".${onMat ? ` Ini berlaku WALAUPUN barangnya material
   (pipa/kabel/freon/plastik/sparepart) — pembelian material tetap UANG KELUAR.
   Contoh: "mohon diproses pembelian plastic cuci senilai 882.000" → expense, bukan material.` : ""}`);
  if (onMat) rules.push(`"material" HANYA untuk laporan STOK MURNI tanpa nominal apa pun — barang dibawa,
   dipakai, sisa, atau dikembalikan ke kantor.
   Contoh: "pipa A16 sisa 5m kembali kantor", "freon R32 sisa 3,1kg terpakai 500gram".`);
  if (onExp && onMat) rules.push(`Kalau ragu antara expense dan material, dan ada angka yang tampak seperti rupiah
   → pilih "expense" (lebih aman: uang tidak boleh hilang dari pencatatan).`);
  const rulesText = rules.length
    ? "ATURAN PRIORITAS INTENT (penting, urutan menentukan):\n" +
      rules.map((r, i) => `${i + 1}. ${r}`).join("\n") + "\n\n"
    : "";

  // ── Spesifikasi field — hanya intent aktif ──
  const fields = [];
  if (onExp) fields.push(`- expense: {
    merchant: string,
    date: "YYYY-MM-DD"|null,   // tanggal STRUK. Jangan mengarang — null kalau tidak terbaca.
    items: [{                   // satu entri per pengeluaran. Nota 1 barang → 1 entri.
      amount: number,           // nominal BARIS INI saja, bukan total nota
      item_name: string,        // nama barang/jasa singkat apa adanya dari nota/caption,
                                // mis "Kapasitor 15uF", "Duct Tape lem 1 roll", "Bensin", "Parkir"
      qty: number|null,         // JUMLAH barang baris ini kalau tertulis di nota. ANGKA MURNI.
      unit: string|null,        // satuan qty apa adanya dari nota: "meter","kg","roll","tabung","pcs","set"
      unit_price: number|null,  // harga SATUAN kalau nota mencantumkannya terpisah dari total
      category: "petty_cash"|"material_purchase",
      subcategory: string       // WAJIB salah satu nilai exact dibawah, tidak boleh nilai lain
    }]
  }
  PENTING — kalau satu foto/caption memuat BEBERAPA pengeluaran berbeda
  (contoh: "isi bensin 15.000, parkir apartemen 5.000"), buat SATU entri items[] untuk
  MASING-MASING. Jangan digabung jadi satu, dan jangan hanya ambil yang pertama.
  Kalau beberapa baris nota adalah barang sejenis dalam satu pembelian
  (contoh nota toko: pipa + duct tape + bracket), boleh digabung jadi 1 entri
  dengan amount = total nota dan item_name berisi ringkasan barangnya.

  qty/unit/unit_price PENTING untuk material — tanpa qty, nota "Kabel 3x1,5 Rp 255.000"
  tidak bisa diturunkan jadi harga per meter dan biaya material job jadi tak terhitung.
  Isi qty HANYA kalau benar-benar tertulis/terbaca (angka di kolom qty, atau "2 roll",
  "33 mtr", "1,0 PCS"). JANGAN mengarang qty — null lebih baik daripada tebakan.
  Kalau nota menyebut harga satuan DAN total, isi unit_price dari harga satuan dan
  amount dari total baris itu. Kalau satu entri menggabungkan beberapa barang berbeda,
  biarkan qty/unit/unit_price null.

  Aturan subcategory wajib salah satu:
  - Kalau category="petty_cash": "Bensin Motor", "Perbaikan Motor", "Parkir", "Lain-lain"
    (struk makan/tol/jajan/minum → pakai "Lain-lain")
  - Kalau category="material_purchase": "Pipa AC", "Kabel", "Freon", "Material Lain"
    (HANYA 4 nilai itu. Barang apa pun di luar pipa/kabel/freon — kapasitor, duct tape,
     bracket, sparepart, alat — pakai "Material Lain". Detail barangnya taruh di item_name.)
  Pilihan category: foto struk bensin SPBU/parkir/perbaikan motor/jajan/makan → "petty_cash".
  Foto nota toko bangunan/pipa/kabel/freon/material → "material_purchase".`);
  if (onMat) fields.push(`- material: { items: [{ type: "freon"|"pipa"|"kabel"|"lain", brand: string|null, size: string|null,
                        qty: number|null, kind: "dibawa"|"terpakai"|"sisa" }] }
  ARAH (kind) WAJIB diisi — ini menentukan stok bertambah atau berkurang:
  - "dibawa"   : barang dibawa dari kantor ke lokasi ("bawa pipa A4 7 meter")
  - "terpakai" : habis dipakai di pekerjaan ("terpakai 5 meter di ibu cassy")
  - "sisa"     : kembali ke kantor / tidak jadi dipakai ("sisa 2 meter", "kembali
                 kantor", "tidak terpakai 4,8kg") — ini KEBALIKAN dari "dibawa",
                 jangan pernah ditandai "dibawa"
  Kalau satu caption menyebut pemakaian DAN sisa sekaligus
  ("pipa A4 7 meter terpakai 5 meter tersisa 2 meter"), buat DUA entri items[]:
  satu {qty: 5, kind: "terpakai"} dan satu {qty: 2, kind: "sisa"}. Jangan pilih salah satu.
  qty WAJIB berupa ANGKA murni dan size hanya untuk ukuran/tipe (A4, 1/4, R32).
  Berat/panjang JANGAN ditaruh di size: "kembali tidak terpakai 4.8kg" →
  {qty: 4.8, size: "R32", kind: "sisa"}, BUKAN {qty: 1, size: "4.8kg"}.`);
  if (onPay) fields.push(`- payment: { amount: number, bank: string, transfer_date: "YYYY-MM-DD"|null, sender_name: string|null, reference: string|null }`);
  const fieldsText = fields.length ? "Field per intent:\n" + fields.join("\n") + "\n\n" : "";

  return `Kamu adalah AI klasifikasi foto WhatsApp bisnis AC service di Indonesia.
Klasifikasikan foto ini ke salah satu intent berikut:
${intentList}
"unknown" — bukan salah satu di atas

${rulesText}Output WAJIB JSON valid (tidak ada prefix/suffix lain), struktur:
{
  "intent": ${intentEnum},
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "data": { ...field sesuai intent... },
  "reasoning": "1-2 kalimat alasan singkat"
}

${fieldsText}Aturan confidence:
- HIGH: semua field terbaca jelas, struk/bukti tidak blur, nominal jelas
- MEDIUM: 1-2 field tidak jelas atau perlu inference
- LOW: foto blur, partial, atau ambigu

Kalau intent tidak cocok dengan apapun → return intent:"unknown", confidence:"LOW", data:{}`;
}

// Accept either:
//   { imageUrl }                          — Anthropic fetches by URL (fragile kalau Fonnte TTL habis)
//   { imageBase64, mimeType }             — kirim base64 langsung (tahan TTL Fonnte)
export async function classifyImage({ imageUrl, imageBase64, mimeType, groupCfg, sender, messageText }) {
  const apiKey = (process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim();
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
  const costUsd   = calcAiCost({ model: ANTHROPIC_MODEL, input_tokens: tokensIn, output_tokens: tokensOut });

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
        // caption_len / has_caption: dipakai menilai apakah pre-filter "lewati foto
        // tanpa caption" aman. Intent `unknown` TIDAK pernah masuk ai_extractions
        // (di-skip di _handlers/wa.js:1053) — tanpa jejak di sini, 30% belanja yang
        // terbuang itu tak bisa dianalisa sama sekali. Sengaja HANYA panjang + boolean,
        // isi pesannya tidak disalin ke sini.
        metadata: {
          group_id: groupCfg?.group_id,
          has_caption: !!(messageText && String(messageText).trim()),
          caption_len: messageText ? String(messageText).trim().length : 0,
          ...extra,
        },
      }),
    }).catch(sentryCatch("ai_usage_log", { feature: "wa-group-vision" }));
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
    // Sentry capture — AI cost terbayar tapi extract hilang = uang terbakar tanpa data
    try {
      const Sentry = await import("@sentry/node");
      Sentry.captureMessage(`[AI_EXTRACT_INSERT_FAIL] HTTP ${ex.status}: ${t.slice(0, 300)}`, {
        level: "warning",
        tags: { op: "ai_extractions_insert", http_status: String(ex.status), intent: classification.intent },
        extra: { sender_name: sender.name, group_id: groupCfg.group_id, confidence: classification.confidence },
      });
    } catch (_) {}
    return { error: "extract_insert_failed", detail: t.slice(0, 300) };
  }
  const extractRow = (await ex.json())[0];
  const extractionId = extractRow.id;

  let expenseId = null, paymentSuggestionId = null;

  // ── GATE CONFIDENCE (configurable app_settings.ai_min_confidence, default MEDIUM) ──
  // Draft expense/payment HANYA dibuat bila confidence >= ambang. LOW → tidak dibuat,
  // hanya tersimpan di ai_extractions utk review → kurangi draft keliru.
  const isDraftIntent = classification.intent === "expense" || classification.intent === "payment";
  let minConf = "MEDIUM";
  if (isDraftIntent) {
    try {
      const sr = await fetch(SU + "/rest/v1/app_settings?key=eq.ai_min_confidence&select=value", { headers: { apikey: SK, Authorization: "Bearer " + SK } });
      const rows = await sr.json().catch(() => []);
      const v = String(rows?.[0]?.value || "").toUpperCase();
      if (["LOW", "MEDIUM", "HIGH"].includes(v)) minConf = v;
    } catch (_) {}
  }
  const confOK = meetsMinConfidence(classification.confidence, minConf);
  if (isDraftIntent && !confOK) {
    await fetch(SU + "/rest/v1/agent_logs", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK },
      body: JSON.stringify({
        action: "AI_LOW_CONFIDENCE_SKIP", severity: "info", category: "ai",
        detail: `Foto ${classification.intent} dari ${sender.name || sender.phone} confidence ${classification.confidence} < ${minConf} → draft TIDAK dibuat (tersimpan di ai_extractions ${extractionId} untuk review).`,
      }),
    }).catch(sentryCatch("ai_low_conf_skip", { extractionId, intent: classification.intent }));
  }

  // Branch by intent + group toggle
  if (classification.intent === "expense" && groupCfg.ai_expense_enabled && confOK) {
    const d = classification.data || {};
    const today = new Date().toISOString().slice(0, 10);
    // Whitelist subcategory — harus match exact dgn ExpensesView.PETTY_CASH_SUBS / MATERIAL_SUBS.
    // Sengaja TIDAK diperluas (keputusan Owner 12 Agu 2026): material di luar pipa/kabel/
    // freon tetap "Material Lain", detail barangnya masuk ke kolom item_name.
    const PETTY = new Set(["Bensin Motor", "Perbaikan Motor", "Parkir", "Kasbon Karyawan", "Lembur", "Bonus", "Lain-lain"]);
    const MAT   = new Set(["Pipa AC", "Kabel", "Freon", "Material Lain"]);
    const validCats = new Set(["petty_cash", "material_purchase"]);
    // Robust amount parse — handle "50.000" / "Rp 50,000" / "50000" / 50000
    const parseAmt = (v) => {
      if (typeof v === "number" && Number.isFinite(v)) return Math.abs(v);
      const digits = String(v || "").replace(/[^\d]/g, "");
      return digits ? parseInt(digits, 10) : 0;
    };

    // Qty TIDAK boleh lewat parseAmt: parseAmt membuang semua non-digit, jadi "4,8 kg"
    // jadi 48 dan "1,0 PCS" jadi 10 — qty material justru sering pecahan (freon 0,7 kg,
    // pipa 7,5 m). Koma desimal ala Indonesia dinormalkan ke titik.
    const parseQty = (v) => {
      if (typeof v === "number" && Number.isFinite(v)) return Math.abs(v);
      const m = String(v || "").replace(/\./g, "").replace(/,/g, ".").match(/\d+(\.\d+)?/);
      const n = m ? parseFloat(m[0]) : 0;
      return Number.isFinite(n) ? n : 0;
    };

    // Date guard: AI bisa salah baca tanggal struk (mis. tahun 2025, atau DD-MM tertukar
    // jadi MM-DD). Toleransi 30 hari ke BELAKANG saja — struk tidak mungkin dari masa
    // depan, jadi tanggal > hari ini SELALU fallback ke today. (Bug nyata 10 Agu 2026:
    // nota tersimpan bertanggal 19 Agu karena guard lama pakai selisih ABSOLUT ±30 hari,
    // sehingga tanggal masa depan ikut lolos dan biaya mendarat di bulan yang salah.)
    let safeDate = today;
    if (d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      const aiTs = Date.parse(d.date + "T00:00:00+07:00");
      const todayTs = Date.parse(today + "T00:00:00+07:00");
      if (Number.isFinite(aiTs)) {
        const selisihHari = (todayTs - aiTs) / 86400000; // positif = di masa lalu
        if (selisihHari >= 0 && selisihHari <= 30) safeDate = d.date;
      }
    }

    // Normalisasi ke array item. Bentuk lama (satu expense flat) tetap didukung supaya
    // respons AI yang belum mengikuti skema baru tidak hilang begitu saja.
    const rawItems = Array.isArray(d.items) && d.items.length > 0
      ? d.items
      : [{ amount: d.amount, item_name: d.item_name, category: d.category, subcategory: d.subcategory }];

    const insertedIds = [];
    for (const it of rawItems) {
      const cat = validCats.has(it?.category) ? it.category : (validCats.has(d.category) ? d.category : "petty_cash");
      const rawSub = it?.subcategory ? String(it.subcategory).trim() : "";
      const sub = cat === "material_purchase"
        ? (MAT.has(rawSub) ? rawSub : "Material Lain")
        : (PETTY.has(rawSub) ? rawSub : "Lain-lain");
      const aiAmount = parseAmt(it?.amount);
      if (!aiAmount) continue; // baris tanpa nominal tidak berguna sebagai biaya
      const itemName = String(it?.item_name || "").trim().slice(0, 120) || null;
      // qty/unit/unit_price hanya berguna untuk material — dipakai modal "Tautkan ke Stok"
      // sebagai prefill, BUKAN untuk menambah stok otomatis (keputusan Owner 28 Agu 2026:
      // AI nota bisa salah baca, & banyak barang langsung dipakai di job, bukan masuk gudang).
      const qtyNum = cat === "material_purchase" ? parseQty(it?.qty) : 0;
      const unitStr = cat === "material_purchase" && it?.unit
        ? String(it.unit).trim().slice(0, 20) : null;
      const unitPriceAI = cat === "material_purchase" ? parseAmt(it?.unit_price) : 0;

      const descParts = [`[AI] ${d.merchant || "Foto struk"}`];
      if (itemName) descParts.push(itemName);
      if (messageText) descParts.push(messageText);

      // ── Cross-source dedup: nama + nominal + tanggal + subcategory ──
      // Kunci SENGAJA tidak menyertakan item_name: formatnya harus tetap sama dengan
      // jalur text-pattern WA & input dashboard, kalau tidak biaya yang sama dari 2
      // channel lolos dua-duanya. Konsekuensinya, 2 baris dgn nominal DAN subcategory
      // identik dalam satu nota akan dianggap duplikat (hanya 1 tersimpan) — dipilih
      // sadar: lebih aman kurang catat daripada dobel catat di jalur uang.
      if (await expenseDuplicateExists({ SU, SK, teknisiName: sender.name, amount: aiAmount, date: safeDate, subcategory: sub })) {
        console.log("[AI_VISION_EXPENSE] skip duplikat:", sender.name, aiAmount, safeDate, sub);
        continue;
      }
      const expBody = {
        date: safeDate,
        category: cat,
        subcategory: sub,
        item_name: itemName,
        description: descParts.join(" — "),
        amount: aiAmount,
        qty: qtyNum > 0 ? qtyNum : null,
        unit: unitStr,
        // Harga satuan: pakai yang tertulis di nota; kalau tidak ada tapi qty terbaca,
        // turunkan dari total ÷ qty. Nol tetap disimpan null — jangan mengaku tahu harga.
        unit_cost: unitPriceAI > 0 ? unitPriceAI : (qtyNum > 0 ? Math.round((aiAmount / qtyNum) * 100) / 100 : null),
        teknisi_name: sender.name,
        created_by: "wa_group_ai",
        validation_status: "PENDING_AI",
        ai_extraction_id: extractionId,
        dedup_key: buildExpenseDedupKey({ teknisiName: sender.name, amount: aiAmount, date: safeDate, subcategory: sub }),
      };
      const r = await fetch(SU + "/rest/v1/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=representation" },
        body: JSON.stringify(expBody),
      });
      if (r.status === 409) {
        console.log("[AI_VISION_EXPENSE] skip duplikat (DB constraint):", sender.name, aiAmount, safeDate);
      } else if (r.ok) {
        const rows = await r.json().catch(() => []);
        if (rows[0]?.id) insertedIds.push(rows[0].id);
      }
    }
    if (rawItems.length > 1) {
      console.log(`[AI_VISION_EXPENSE] nota multi-item: ${insertedIds.length}/${rawItems.length} baris tersimpan`);
    }
    // expenseId = baris pertama (kompatibilitas pemanggil & link ai_extractions).
    expenseId = insertedIds[0] || null;
    if (expenseId) {
      fetch(SU + "/rest/v1/ai_extractions?id=eq." + extractionId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK },
        body: JSON.stringify({ linked_table: "expenses", linked_id: String(expenseId) }),
      }).catch(sentryCatch("ai_extract_link_expense", { extractionId, expenseId }));
    }
  }

  if (classification.intent === "payment" && groupCfg.ai_payment_enabled && confOK) {
    const d = classification.data || {};

    // ── GUARD UMUR BUKTI BAYAR ──────────────────────────────────────────────
    // Tolak bukti bayar yang transfer_date-nya terlalu lama (mis. bon/struk lama
    // 1 tahun yang difoto ulang) → cegah masuk payment suggestion keliru.
    // Window configurable via app_settings.payment_max_age_days (default 30 hari).
    // transfer_date null/tak terbaca → tetap diproses (tak bisa tentukan umur).
    const maxAgeDays = await (async () => {
      try {
        const sr = await fetch(SU + "/rest/v1/app_settings?key=eq.payment_max_age_days&select=value", { headers: { apikey: SK, Authorization: "Bearer " + SK } });
        const rows = await sr.json().catch(() => []);
        const v = parseInt(rows?.[0]?.value, 10);
        return Number.isFinite(v) && v > 0 ? v : 30;
      } catch { return 30; }
    })();
    let tooOld = false;
    if (d.transfer_date) {
      const td = new Date(String(d.transfer_date) + "T00:00:00Z");
      if (!isNaN(td.getTime())) {
        const ageDays = Math.floor((Date.now() - td.getTime()) / 86400000);
        if (ageDays > maxAgeDays) tooOld = true;
      }
    }
    if (tooOld) {
      await fetch(SU + "/rest/v1/agent_logs", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK },
        body: JSON.stringify({
          action: "PAYMENT_SUGGESTION_SKIPPED_OLD", severity: "info", category: "payment",
          detail: `Bukti bayar dari ${sender.name || sender.phone} tgl ${d.transfer_date} > ${maxAgeDays} hari (kemungkinan bon lama) → TIDAK dibuat payment suggestion.`,
        }),
      }).catch(sentryCatch("ai_payment_skip_old", { phone: sender.phone, transfer_date: d.transfer_date }));
    }

    const parseAmtP = (v) => {
      if (typeof v === "number" && Number.isFinite(v)) return Math.abs(v);
      const digits = String(v || "").replace(/[^\d]/g, "");
      return digits ? parseInt(digits, 10) : null;
    };
    if (!tooOld) {
    const sugBody = {
      phone: sender.phone,
      sender_name: sender.name,
      raw_message: messageText || "(foto bukti — grup)",
      image_url: imageUrl,
      amount: parseAmtP(d.amount),
      bank: d.bank || null,
      transfer_date: safeDateStr(d.transfer_date),
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
        }).catch(sentryCatch("ai_extract_link_payment", { extractionId, paymentSuggestionId }));
      }
    }
    } // end if (!tooOld)
  }

  // Material intent — OBSERVE-ONLY mode (per Owner directive 2026-06-06).
  // STOP auto-INSERT ke job_materials_brought karena risiko salah-link tinggi.
  // Hasil AI hanya disimpan di ai_extractions (status=pending). Owner approve manual
  // via tab "Pending Material" di MatTrack → tombol Link to Job → commit job_materials_brought.
  //
  // Enrich notes dgn carrier hint (Gap 1 parser) + candidate jobs hari ini → bantu Owner pilih.
  let materialJobId = null;          // tetap dipertahankan untuk API compat (selalu null sekarang)
  let materialSkipped = null;
  let materialInsertedCount = 0;     // selalu 0 sekarang
  let materialDupCount = 0;
  let materialPendingForOwner = false;
  if (classification.intent === "material" && groupCfg.ai_material_enabled) {
    const d = classification.data || {};
    const items = Array.isArray(d.items) ? d.items : [];
    if (items.length === 0) {
      // AI bilang material tapi tidak extract item — flag untuk Owner review
      materialSkipped = "AI tidak bisa extract item material";
    } else if (items.length > 0) {
      // Enrich notes — TIDAK insert ke job_materials_brought.
      // Owner approve manual via tab "Pending Material" di UI.
      materialPendingForOwner = true;
      const todayJkt = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
      // CATATAN: dulu difilter status=in.(SCHEDULED,IN_PROGRESS,ON_SITE,WORKING) —
      // keempat nilai itu TIDAK PERNAH ADA di tabel orders (yang dipakai: PENDING,
      // CONFIRMED, REPORT_SUBMITTED, INVOICE_APPROVED, COMPLETED, PAID, CANCELLED).
      // Akibatnya todayOrders selalu kosong, sehingga carrier hint & sender jobs
      // SELALU melaporkan "no job match" / 0 sejak fitur ini dibuat.
      // Sekarang hanya CANCELLED yang dibuang. Rentang dilebarkan ke H-1 karena
      // foto material sering dikirim lewat tengah malam untuk pekerjaan kemarin.
      const kemarinJkt = new Date(Date.parse(todayJkt + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
      const orderUrl = SU + "/rest/v1/orders?select=id,customer,teknisi,teknisi2,teknisi3,helper,helper2,helper3,team_slot,date,status"
        + "&date=gte." + encodeURIComponent(kemarinJkt)
        + "&date=lte." + encodeURIComponent(todayJkt)
        + "&status=neq.CANCELLED&limit=100";
      let todayOrders = [];
      try {
        const r = await fetch(orderUrl, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
        if (r.ok) todayOrders = await r.json();
      } catch (_) {}

      // Carrier hint — parse "dibawa <X>" dari messageText (Gap 1 parser)
      let carrierHintName = null;
      let carrierHintMatched = null;
      let carrierJobs = [];
      try {
        const { parseCarrierFromCaption, matchCarrierName } = await import("./_shadow-parsers.js");
        const c = parseCarrierFromCaption(messageText || "");
        if (c) {
          carrierHintName = c.carrier_main_token;
          const mr = await matchCarrierName({ SU, SK, mainToken: c.carrier_main_token });
          if (mr.matched) {
            carrierHintMatched = mr.matched.name;
            const lowMatch = carrierHintMatched.toLowerCase();
            carrierJobs = todayOrders.filter(o => {
              const slots = [o.teknisi, o.teknisi2, o.teknisi3, o.helper, o.helper2, o.helper3];
              return slots.some(s => s && String(s).toLowerCase() === lowMatch);
            }).map(o => ({ id: o.id, customer: o.customer, status: o.status }));
          }
        }
      } catch (_) {}

      // Sender jobs (fallback hint kalau no carrier)
      const sLow = String(sender.name || "").toLowerCase();
      const senderJobs = todayOrders.filter(o => {
        const slots = [o.teknisi, o.teknisi2, o.teknisi3, o.helper, o.helper2, o.helper3];
        return slots.some(s => s && String(s).toLowerCase() === sLow);
      }).map(o => ({ id: o.id, customer: o.customer, status: o.status }));

      const hintNote = [
        carrierHintMatched ? `CARRIER_HINT: ${carrierHintMatched} (jobs: ${carrierJobs.length})` : (carrierHintName ? `CARRIER_RAW: ${carrierHintName} (no_match)` : null),
        `SENDER_JOBS: ${senderJobs.length}`,
      ].filter(Boolean).join(" | ");

      await fetch(SU + "/rest/v1/ai_extractions?id=eq." + extractionId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK },
        body: JSON.stringify({
          notes: (classification.reasoning || "") + ` | ${hintNote}`,
          extracted: {
            ...d,
            _candidates: { carrier_jobs: carrierJobs, sender_jobs: senderJobs, carrier_hint: carrierHintMatched || carrierHintName },
          },
        }),
      }).catch(sentryCatch("ai_extract_material_observation", { extractionId }));
    }
  }

  return { extractionId, expenseId, paymentSuggestionId, materialJobId, materialSkipped, materialInsertedCount, materialDupCount, materialPendingForOwner };
}
