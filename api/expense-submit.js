// api/expense-submit.js
// POST /api/expense-submit — teknisi/helper input pengeluaran (Bensin/Parkir) dari dashboard.
// Tiap foto = 1 expense. AI vision baca tanggal + nominal struk:
//   - tanggal == hari ini DAN nominal cocok → AUTO APPROVED (langsung ke Biaya)
//   - selisih → PENDING_AI (review manual Owner/Admin di tab Pending AI)
// Foto disimpan ke R2 (folder expenses/...), di-purge cron 30 hari.
// Dedup hash foto (anti double-claim). WA notif Owner saat ada PENDING_AI.

import { createHash } from "node:crypto";
import { validateInternalToken, checkRateLimit, setCorsHeaders } from "./_auth.js";
import { uploadBufferToR2, hasR2Config } from "./_r2-upload.js";
import { classifyImage } from "./_ai-vision.js";
import { expenseDuplicateExists } from "./_expense-dedup.js";

const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_KEY;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN || "";
const OWNER_PHONE = process.env.OWNER_PHONE || "";
const H = { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json" };
const REST = (p) => `${SU}/rest/v1/${p}`;

// Vercel maxDuration diatur di vercel.json (60s) — vision 5 foto paralel ~15s.
const SUB_LIMITS = { "Bensin Motor": 3, "Parkir": 5 };
const todayJkt = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }); // YYYY-MM-DD WIB

function slugify(s) { return String(s || "teknisi").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30); }
function parseAmt(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.abs(Math.round(v));
  const digits = String(v || "").replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

async function sendWA(phone, message) {
  if (!FONNTE_TOKEN || !phone) return false;
  try {
    const r = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { "Authorization": FONNTE_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ target: phone, message }),
    });
    return r.ok;
  } catch { return false; }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!await checkRateLimit(req, res, 20, 60000)) return;
  if (!await validateInternalToken(req, res)) return;
  if (!SU || !SK) return res.status(500).json({ error: "Server config error" });

  const b = req.body || {};
  const category = b.category;
  const teknisiName = (b.teknisi_name || "").trim();
  const teknisiPhone = b.teknisi_phone || null;
  const items = Array.isArray(b.items) ? b.items : [];

  if (!SUB_LIMITS[category]) return res.status(400).json({ error: "Kategori harus 'Bensin Motor' atau 'Parkir'" });
  if (!teknisiName) return res.status(400).json({ error: "teknisi_name wajib" });
  if (items.length === 0) return res.status(400).json({ error: "Minimal 1 foto" });
  if (items.length > SUB_LIMITS[category]) return res.status(400).json({ error: `Maksimal ${SUB_LIMITS[category]} foto untuk ${category}` });
  if (!hasR2Config()) return res.status(500).json({ error: "R2 belum dikonfigurasi" });

  const today = todayJkt();
  const monthStr = today.slice(0, 7);
  const tekSlug = slugify(teknisiName);

  // Proses tiap foto paralel
  const results = await Promise.all(items.map(async (item, idx) => {
    const out = { idx, status: null, verdict: null, reason: null, amount: parseAmt(item.amount), expense_id: null };
    try {
      const typedAmount = parseAmt(item.amount);
      if (!typedAmount || typedAmount < 1000) { out.status = "ERROR"; out.reason = "Nominal tidak valid"; return out; }
      if (!item.base64) { out.status = "ERROR"; out.reason = "Foto kosong"; return out; }

      const buffer = Buffer.from(item.base64, "base64");
      if (buffer.length < 1024) { out.status = "ERROR"; out.reason = "Foto terlalu kecil"; return out; }
      const mimeType = item.mimeType || "image/jpeg";

      // ── Dedup hash (anti double-claim, window 30 hari) ──
      const hash = createHash("sha256").update(buffer).digest("hex");
      const dedupKey = "tekexp:" + hash;
      const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const dupRes = await fetch(REST(`ai_extractions?source_ref=eq.${encodeURIComponent(dedupKey)}&created_at=gte.${cutoff30}&select=id&limit=1`), { headers: H });
      const dupRows = dupRes.ok ? await dupRes.json() : [];
      if (dupRows.length > 0) { out.status = "DUPLICATE"; out.reason = "Foto struk ini sudah pernah diupload"; return out; }

      // ── Cross-source dedup: nama + nominal + tanggal sama (channel lain spt WA grup) ──
      if (await expenseDuplicateExists({ SU, SK, teknisiName, amount: typedAmount, date: today, subcategory: category })) {
        out.status = "DUPLICATE"; out.reason = "Biaya dgn nama, kategori, nominal & tanggal sama sudah tercatat (mungkin dari WA grup)"; return out;
      }

      // ── Upload R2 ──
      const ext = mimeType.includes("png") ? "png" : "jpg";
      const r2Key = `expenses/${monthStr}/${tekSlug}/${today}_${hash.slice(0, 10)}.${ext}`;
      const up = await uploadBufferToR2({ buffer, key: r2Key, mimeType });
      const r2Url = up.ok ? up.url : null;

      // ── AI Vision: baca tanggal + nominal struk ──
      const groupCfg = { ai_expense_enabled: true, ai_payment_enabled: false };
      const cls = await classifyImage({ imageBase64: item.base64, mimeType, groupCfg, sender: { name: teknisiName, phone: teknisiPhone }, messageText: category });

      let aiDate = null, aiAmount = 0, confidence = "LOW", model = cls.model || "claude-haiku-4-5", extracted = {};
      let tokensIn = cls.tokensIn || 0, tokensOut = cls.tokensOut || 0, costUsd = cls.costUsd || 0;
      if (!cls.error && cls.data) {
        extracted = cls.data;
        aiDate = cls.data.date || null;
        aiAmount = parseAmt(cls.data.amount);
        confidence = cls.confidence || "LOW";
      }

      // ── Verdict: tanggal match DAN nominal cocok ──
      const dateMatch = aiDate && aiDate === today;
      const amountTol = Math.max(1000, Math.round(typedAmount * 0.05)); // toleransi OCR 5% / Rp1000
      const amountMatch = aiAmount > 0 && Math.abs(aiAmount - typedAmount) <= amountTol;

      let validation, reason;
      if (cls.error) {
        validation = "PENDING_AI"; reason = "AI gagal baca foto — perlu review manual";
      } else if (dateMatch && amountMatch) {
        validation = "APPROVED"; reason = null;
      } else {
        validation = "PENDING_AI";
        const probs = [];
        if (!aiDate) probs.push("tanggal struk tidak terbaca");
        else if (!dateMatch) probs.push(`tanggal struk ${aiDate} ≠ hari ini`);
        if (!aiAmount) probs.push("nominal struk tidak terbaca");
        else if (!amountMatch) probs.push(`nominal struk Rp${aiAmount.toLocaleString("id-ID")} ≠ input Rp${typedAmount.toLocaleString("id-ID")}`);
        reason = probs.join(" · ") || "perlu review manual";
      }

      // ── Insert ai_extractions ──
      const aiBody = {
        source: "teknisi_dashboard", source_ref: dedupKey,
        sender_phone: teknisiPhone, sender_name: teknisiName,
        message_text: category, image_url: null, r2_url: r2Url,
        intent: "expense", confidence,
        extracted, model, tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: costUsd,
        status: validation === "APPROVED" ? "approved" : "pending",
        linked_table: "expenses", linked_id: null, notes: reason,
      };
      const aiRes = await fetch(REST("ai_extractions"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(aiBody) });
      const aiRow = aiRes.ok ? (await aiRes.json())[0] : null;
      const extractionId = aiRow?.id || null;

      // ── Insert expenses ──
      const expBody = {
        category: "petty_cash", subcategory: category,
        amount: typedAmount, date: today,
        description: `${category} (input teknisi)${reason ? " — " + reason : ""}`,
        teknisi_name: teknisiName, created_by: teknisiName,
        validation_status: validation, ai_extraction_id: extractionId,
      };
      const expRes = await fetch(REST("expenses"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(expBody) });
      const expRow = expRes.ok ? (await expRes.json())[0] : null;
      if (!expRow) { out.status = "ERROR"; out.reason = "Gagal simpan ke Biaya"; return out; }
      out.expense_id = expRow.id;

      // Link balik ai_extractions.linked_id
      if (extractionId) {
        await fetch(REST("ai_extractions?id=eq." + extractionId), { method: "PATCH", headers: H, body: JSON.stringify({ linked_id: expRow.id }) });
      }

      out.status = validation === "APPROVED" ? "APPROVED" : "PENDING_REVIEW";
      out.verdict = validation;
      out.reason = reason;
      return out;
    } catch (e) {
      out.status = "ERROR"; out.reason = e.message;
      return out;
    }
  }));

  // ── WA notif Owner kalau ada yang perlu review ──
  const needReview = results.filter(r => r.status === "PENDING_REVIEW");
  const approved = results.filter(r => r.status === "APPROVED");
  if (needReview.length > 0 && OWNER_PHONE) {
    const totalReview = needReview.reduce((s, r) => s + r.amount, 0);
    const lines = needReview.map(r => `• Rp${r.amount.toLocaleString("id-ID")} — ${r.reason}`).join("\n");
    await sendWA(OWNER_PHONE,
      `🔎 *Pengeluaran Perlu Review*\n\nTeknisi: ${teknisiName}\nKategori: ${category}\n${needReview.length} item (Rp${totalReview.toLocaleString("id-ID")}) tidak lolos auto-approve:\n\n${lines}\n\nCek di menu Biaya → tab Pending AI.`
    );
  }

  return res.status(200).json({
    ok: true,
    summary: {
      total: results.length,
      approved: approved.length,
      need_review: needReview.length,
      duplicate: results.filter(r => r.status === "DUPLICATE").length,
      error: results.filter(r => r.status === "ERROR").length,
    },
    results,
  });
}
