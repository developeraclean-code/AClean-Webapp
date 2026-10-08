import { matchPaymentInvoices, paymentPhoneVariants } from "../src/lib/waPaymentMatch.js";
import { createHash } from "node:crypto";
import { downloadBufferFromR2, downloadToBuffer, uploadBufferToR2 } from "./_r2-upload.js";
import { callVision, getVisionProvider } from "./_vision-provider.js";

export const PAYMENT_MEDIA_PROMPT = `Klasifikasikan gambar ini. Pilih SATU kategori: "bukti_transfer" (struk transfer/screenshot m-banking), "kerusakan_ac", "dokumen", atau "tidak_relevan".
Jika bukti_transfer, pisahkan dengan tepat:
- transfer_amount: nominal yang diterima penerima / nominal transfer, TANPA biaya admin
- fee_amount: biaya admin (0 jika tidak ada)
- total_debit: total yang didebit dari pengirim
- bank: nama bank
- transfer_date: YYYY-MM-DD
Jangan memakai total_debit sebagai transfer_amount. Format JSON SAJA:
{"category":"bukti_transfer","transfer_amount":200000,"fee_amount":2500,"total_debit":202500,"bank":"BCA","transfer_date":"2026-09-29"}`;

const cleanMoney = value => {
  if (value === null || value === undefined || value === "") return null;
  // Nilai invoice AClean memakai Rupiah bulat; titik/koma dari OCR adalah
  // pemisah ribuan ("Rp 200.000"), bukan desimal.
  const number = typeof value === "number"
    ? value
    : Number(String(value).replace(/[^0-9]/g, ""));
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export function normalizePaymentClassification(input) {
  if (!input || typeof input !== "object") return null;
  const category = String(input.category || "").trim().toLowerCase();
  if (!category) return null;
  const transferAmount = cleanMoney(input.transfer_amount ?? input.nominal_transfer ?? input.amount);
  const feeAmount = cleanMoney(input.fee_amount ?? input.admin_fee ?? input.biaya_admin);
  const totalDebit = cleanMoney(input.total_debit ?? input.total_amount);
  return {
    ...input,
    category,
    transfer_amount: transferAmount,
    fee_amount: feeAmount,
    total_debit: totalDebit,
    // Backward compatible dengan pipeline lama. amount selalu nominal transfer.
    amount: transferAmount,
    bank: input.bank ? String(input.bank).trim().slice(0, 100) : null,
    transfer_date: /^\d{4}-\d{2}-\d{2}$/.test(String(input.transfer_date || ""))
      ? String(input.transfer_date) : null,
  };
}

export function parsePaymentClassification(rawText) {
  const match = String(rawText || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return normalizePaymentClassification(JSON.parse(match[0])); }
  catch { return null; }
}

export async function classifyPaymentMedia({ buffer, mimeType, apiKey, timeoutMs = 12000, fetchImpl = fetch }) {
  if (!buffer?.length) return { ok: false, error: "media buffer kosong", retryable: false };
  try {
    const provider = await getVisionProvider();
    const result = await callVision({ imageBase64: Buffer.from(buffer).toString("base64"), mimeType: mimeType || "image/jpeg",
      prompt: PAYMENT_MEDIA_PROMPT, maxTokens: 300, timeoutMs, fetchImpl, provider, claudeApiKey: apiKey });
    const classification = parsePaymentClassification(result.text);
    if (!classification) return { ok: false, error: "Respons AI bukan JSON klasifikasi yang valid", retryable: true, data: result.raw, provider: result.provider, model: result.model };
    return { ok: true, classification, data: result.raw, provider: result.provider, model: result.model, usage: result.usage };
  } catch (error) {
    return { ok: false, error: error?.message || "Klasifikasi media gagal", retryable: true };
  }
}

const restHeaders = (serviceKey, prefer = "return=representation") => ({
  "Content-Type": "application/json",
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  Prefer: prefer,
});

const extensionFor = mimeType => mimeType === "image/png" ? "png"
  : mimeType === "image/webp" ? "webp"
  : mimeType === "image/gif" ? "gif" : "jpg";

export async function registerPaymentMediaReference({ supabaseUrl, serviceKey, sourceUrl, phone, senderName, mimeType }) {
  if (!supabaseUrl || !serviceKey || !sourceUrl || !phone) return { ok: false, error: "parameter queue tidak lengkap" };
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/wa_payment_media_jobs?on_conflict=source_url`, {
      method: "POST",
      headers: restHeaders(serviceKey, "resolution=ignore-duplicates,return=representation"),
      body: JSON.stringify({
        source_url: sourceUrl, phone, sender_name: senderName || null,
        mime_type: mimeType || null, status: "RECEIVED",
        next_retry_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, error: `queue register ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}` };
    let job = (await response.json())?.[0];
    if (!job) {
      const lookup = await fetch(`${supabaseUrl}/rest/v1/wa_payment_media_jobs?select=*&source_url=eq.${encodeURIComponent(sourceUrl)}&limit=1`, {
        headers: restHeaders(serviceKey), signal: AbortSignal.timeout(5000),
      });
      if (lookup.ok) job = (await lookup.json())?.[0];
    }
    return job ? { ok: true, job, duplicate: job.status !== "RECEIVED" } : { ok: false, error: "queue register tidak mengembalikan job" };
  } catch (error) {
    return { ok: false, error: `queue register gagal: ${error?.message || error}` };
  }
}

export async function stagePaymentMedia({ supabaseUrl, serviceKey, sourceUrl, phone, senderName, buffer, mimeType, createdAt }) {
  if (!supabaseUrl || !serviceKey || !sourceUrl || !phone || !buffer?.length) return { ok: false, error: "parameter staging tidak lengkap" };
  try {
  // Webhook provider bisa mengirim event yang sama lebih dari sekali. Cek dulu
  // supaya object R2 dan state terminal tidak ditulis ulang.
  const existingResponse = await fetch(`${supabaseUrl}/rest/v1/wa_payment_media_jobs?select=*&source_url=eq.${encodeURIComponent(sourceUrl)}&limit=1`, {
    headers: restHeaders(serviceKey),
    signal: AbortSignal.timeout(5000),
  });
  if (existingResponse.ok) {
    const existing = (await existingResponse.json())?.[0];
    if (existing?.r2_key && existing?.r2_url) return { ok: true, job: existing, key: existing.r2_key, url: existing.r2_url, duplicate: true };
  }
  const digest = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 24);
  const month = String(createdAt || new Date().toISOString()).slice(0, 7);
  const key = `wa-inbox/${month}/${digest}.${extensionFor(mimeType)}`;
  const upload = await uploadBufferToR2({ buffer: Buffer.from(buffer), key, mimeType: mimeType || "image/jpeg" });
  if (!upload.ok) return { ok: false, error: upload.err || "R2 upload gagal" };

  const response = await fetch(`${supabaseUrl}/rest/v1/wa_payment_media_jobs?on_conflict=source_url`, {
    method: "POST",
    headers: restHeaders(serviceKey, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify({
      source_url: sourceUrl, phone, sender_name: senderName || null,
      mime_type: mimeType || "image/jpeg", r2_key: key, r2_url: upload.url,
      status: "STORED", next_retry_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return { ok: false, error: `queue upsert ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}` };
  const rows = await response.json();
  return { ok: true, job: rows?.[0], key, url: upload.url };
  } catch (error) {
    return { ok: false, error: `staging media gagal: ${error?.message || error}` };
  }
}

export async function updatePaymentMediaJob({ supabaseUrl, serviceKey, id, patch }) {
  if (!id) return { ok: false, error: "job id kosong" };
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/wa_payment_media_jobs?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers: restHeaders(serviceKey, "return=minimal"),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? { ok: true } : { ok: false, error: `queue patch ${response.status}` };
  } catch (error) {
    return { ok: false, error: `queue patch gagal: ${error?.message || error}` };
  }
}

export async function findPaymentInvoiceMatch({ supabaseUrl, serviceKey, phone, amount }) {
  const variants = paymentPhoneVariants(phone);
  if (!variants.length) return matchPaymentInvoices([], phone, amount);
  const filter = variants.map(value => `phone.eq.${encodeURIComponent(value)}`).join(",");
  const invoices = [];
  for (let offset = 0; ; offset += 200) {
    const response = await fetch(`${supabaseUrl}/rest/v1/invoices?select=id,job_id,total,paid_amount,remaining_amount,status,phone&or=(${filter})&status=in.(UNPAID,OVERDUE,PARTIAL_PAID)&order=created_at.desc,id&limit=200&offset=${offset}`, {
      headers: restHeaders(serviceKey), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`invoice lookup ${response.status}`);
    const rows = await response.json();
    invoices.push(...rows);
    if (rows.length < 200) break;
  }
  return matchPaymentInvoices(invoices, phone, amount);
}

export async function findSettledPaymentMedia({ supabaseUrl, serviceKey, job }) {
  const variants = paymentPhoneVariants(job.phone);
  if (!variants.length || !job.r2_url) return null;
  const filter = variants.map(value => `phone.eq.${encodeURIComponent(value)}`).join(",");
  const response = await fetch(`${supabaseUrl}/rest/v1/invoices?select=id&or=(${filter})&status=eq.PAID&payment_proof_url=eq.${encodeURIComponent(job.r2_url)}&limit=1`, {
    headers: restHeaders(serviceKey), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`settled proof lookup ${response.status}`);
  return (await response.json())?.[0] || null;
}

export async function ensurePaymentSuggestion({ supabaseUrl, serviceKey, job, classification = null, pendingReason = null, invoiceMatch = null }) {
  if (!job?.id || !job?.phone || !job?.r2_url) return { ok: false, error: "job media belum lengkap" };
  let match;
  try { match = invoiceMatch || await findPaymentInvoiceMatch({ supabaseUrl, serviceKey, phone: job.phone, amount: classification?.amount }); }
  catch (error) { return { ok: false, error: error.message }; }
  if (classification || !match.candidates.length) {
    try {
      const settled = await findSettledPaymentMedia({ supabaseUrl, serviceKey, job });
      if (settled) return { ok: true, alreadySettled: true, invoice: settled, inserted: false };
    } catch (error) { return { ok: false, error: error.message }; }
  }
  const invoice = match.kind === "single" ? match.invoices[0] : null;
  if (!classification && !match.candidates.length) return { ok: true, skipped: true };
  const payload = {
    media_job_id: job.id,
    phone: job.phone,
    sender_name: job.sender_name || null,
    raw_message: pendingReason ? `Media WA perlu review manual: ${pendingReason}`
      : match.kind === "multi" ? `Saran alokasi ${match.invoices.length} invoice: ${match.invoices.map(i => i.id).join(", ")}. Periksa sebelum konfirmasi.`
      : "Bukti transfer terdeteksi AI. Periksa invoice dan nominal sebelum konfirmasi.",
    amount: classification?.amount ?? null,
    bank: classification?.bank || null,
    transfer_date: classification?.transfer_date || null,
    invoice_id: invoice?.id || null,
    order_id: invoice?.job_id || null,
    match_source: classification ? (match.kind === "multi" ? "wa_image_ai_multi" : "wa_image_ai") : "wa_image_ai_pending",
    status: "PENDING",
    validation_status: "PENDING",
    source: "image",
    image_url: job.r2_url,
  };
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/payment_suggestions?on_conflict=media_job_id`, {
      method: "POST", headers: restHeaders(serviceKey, "resolution=ignore-duplicates,return=representation"), body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, error: `suggestion upsert ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}` };
    let suggestion = (await response.json())?.[0];
    const inserted = !!suggestion;
    if (!suggestion) {
      // A duplicate must never reopen a CONFIRMED/DISMISSED payment.
      const lookup = await fetch(`${supabaseUrl}/rest/v1/payment_suggestions?select=*&media_job_id=eq.${job.id}&limit=1`, {
        headers: restHeaders(serviceKey), signal: AbortSignal.timeout(5000),
      });
      if (!lookup.ok) return { ok: false, error: `suggestion lookup ${lookup.status}` };
      suggestion = (await lookup.json())?.[0];
      // Enrich an AI-timeout fallback only while still pending; conditional PATCH
      // also protects a concurrent admin confirmation.
      if (classification && suggestion?.status === "PENDING" && suggestion.match_source === "wa_image_ai_pending") {
        const enrich = await fetch(`${supabaseUrl}/rest/v1/payment_suggestions?id=eq.${suggestion.id}&status=eq.PENDING&match_source=eq.wa_image_ai_pending`, {
          method: "PATCH", headers: restHeaders(serviceKey), body: JSON.stringify(payload), signal: AbortSignal.timeout(5000),
        });
        if (!enrich.ok) return { ok: false, error: `suggestion enrich ${enrich.status}` };
        suggestion = (await enrich.json())?.[0] || suggestion;
      }
    }
    if (!suggestion) return { ok: false, error: "suggestion tidak ditemukan setelah penyimpanan" };
    return { ok: true, suggestion, invoice, match, inserted };
  } catch (error) {
    return { ok: false, error: `suggestion upsert gagal: ${error?.message || error}` };
  }
}

export async function retryOnePaymentMediaJob({ supabaseUrl, serviceKey, apiKey }) {
  const due = encodeURIComponent(new Date().toISOString());
  let response;
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/wa_payment_media_jobs?select=*&status=in.(RECEIVED,STORED,FAILED_RETRYABLE)&next_retry_at=lte.${due}&attempts=lt.3&order=created_at.asc&limit=1`, {
      headers: restHeaders(serviceKey),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    return { error: `queue fetch gagal: ${error?.message || error}` };
  }
  if (!response.ok) return { error: `queue fetch ${response.status}` };
  const job = (await response.json())?.[0];
  if (!job) return { checked: 0, retried: 0 };
  const attempt = Number(job.attempts || 0) + 1;
  // Tetap berstatus retryable saat proses berjalan. Jika serverless diputus paksa,
  // invocation berikutnya masih dapat mengambil job ini (upsert suggestion tetap idempoten).
  const started = await updatePaymentMediaJob({ supabaseUrl, serviceKey, id: job.id, patch: { attempts: attempt, last_error: null } });
  if (!started.ok) return { ok: false, error: started.error };
  let activeJob = job;
  const cached = job.category === "bukti_transfer" && job.r2_url && Number(job.transfer_amount) > 0
    ? normalizePaymentClassification(job) : null;
  let ai;
  if (cached) ai = { ok: true, classification: cached };
  else {
    let media = job.r2_key
      ? await downloadBufferFromR2(job.r2_key, { timeoutMs: 7000 })
      : await downloadToBuffer(job.source_url, { timeoutMs: 7000 });
    if (media.ok && !job.r2_key) {
      const staged = await stagePaymentMedia({
        supabaseUrl, serviceKey, sourceUrl: job.source_url, phone: job.phone,
        senderName: job.sender_name, buffer: media.buffer,
        mimeType: media.mimeType || job.mime_type, createdAt: job.created_at,
      });
      if (!staged.ok) media = { ok: false, err: staged.error };
      else activeJob = staged.job;
    }
    if (!media.ok) {
      await updatePaymentMediaJob({ supabaseUrl, serviceKey, id: job.id, patch: { status: attempt >= 3 ? "FAILED_PERMANENT" : "FAILED_RETRYABLE", last_error: media.err, next_retry_at: new Date(Date.now() + attempt * 3600000).toISOString() } });
      return { checked: 1, retried: 0, failed: 1, error: media.err };
    }
    ai = await classifyPaymentMedia({ buffer: media.buffer, mimeType: activeJob.mime_type || media.mimeType, apiKey, timeoutMs: 9000 });
  }
  if (!ai.ok) {
    const fallback = await ensurePaymentSuggestion({ supabaseUrl, serviceKey, job: activeJob, pendingReason: ai.error });
    const exhaustedStatus = fallback?.suggestion ? "PENDING_REVIEW" : "FAILED_PERMANENT";
    await updatePaymentMediaJob({ supabaseUrl, serviceKey, id: job.id, patch: {
      status: attempt >= 3 ? exhaustedStatus : "FAILED_RETRYABLE",
      last_error: fallback.error || ai.error,
      next_retry_at: attempt >= 3 ? null : new Date(Date.now() + attempt * 3600000).toISOString(),
    } });
    return { checked: 1, retried: 1, pendingReview: fallback?.suggestion ? 1 : 0, error: fallback.error || ai.error };
  }
  const c = ai.classification;
  if (c.category !== "bukti_transfer") {
    await updatePaymentMediaJob({ supabaseUrl, serviceKey, id: job.id, patch: { status: "IGNORED", category: c.category, next_retry_at: null } });
    return { checked: 1, retried: 1, ignored: 1 };
  }
  const suggestion = await ensurePaymentSuggestion({ supabaseUrl, serviceKey, job: activeJob, classification: c });
  const saved = await updatePaymentMediaJob({ supabaseUrl, serviceKey, id: job.id, patch: {
    status: suggestion.ok ? "DONE" : attempt >= 3 ? "FAILED_PERMANENT" : "FAILED_RETRYABLE", category: c.category,
    transfer_amount: c.amount, fee_amount: c.fee_amount, total_debit: c.total_debit,
    bank: c.bank, transfer_date: c.transfer_date, invoice_id: suggestion.invoice?.id || null,
    last_error: suggestion.ok ? null : suggestion.error,
    next_retry_at: suggestion.ok || attempt >= 3 ? null : new Date(Date.now() + attempt * 3600000).toISOString(),
  } });
  return { ok: suggestion.ok && saved.ok, checked: 1, retried: 1, suggestion: suggestion.suggestion ? 1 : 0, alreadySettled: suggestion.alreadySettled === true, invoiceId: suggestion.invoice?.id || null, error: suggestion.error || saved.error || null };
}
