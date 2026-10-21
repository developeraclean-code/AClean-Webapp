import { matchPaymentInvoices, paymentPhoneVariants } from "../src/lib/waPaymentMatch.js";
import { createHash, randomUUID } from "node:crypto";
import { downloadBufferFromR2, downloadToBuffer, uploadBufferToR2 } from "./_r2-upload.js";
import { callVision, getVisionProvider } from "./_vision-provider.js";
import { isPaymentEvidenceClassification } from "../src/lib/paymentMediaPolicy.js";

export const PAYMENT_MEDIA_PROMPT = `Klasifikasikan gambar ini. Pilih SATU kategori: "bukti_transfer" (bukti pembayaran BERHASIL: transfer bank, m-banking, QRIS, e-wallet, virtual account, setor tunai, atau mutasi kredit), "kerusakan_ac", "dokumen", atau "tidak_relevan".
Fokus HANYA bukti uang sudah dibayar/diterima. Foto AC/unit/kerusakan/pekerjaan, chat biasa, ulasan Google/bintang, iklan dan katalog BUKAN pembayaran walaupun pengirim punya tagihan atau gambar berisi angka/harga.
Tagihan/invoice/quotation, permintaan pembayaran, saldo rekening, dan layar transfer gagal/pending/belum dikonfirmasi BUKAN bukti_transfer. Gunakan "dokumen" untuk invoice/quotation; "kerusakan_ac" untuk foto unit; "tidak_relevan" untuk review Google/chat/iklan.
Jika bentuk dokumennya jelas bukti transfer BERHASIL tetapi nominal buram/terpotong, tetap pilih "bukti_transfer" dengan transfer_amount:null. Jangan menebak angka, jangan menganggap harga invoice atau jumlah unit sebagai nominal transfer. Jika jenis bukti pun tidak dapat dipastikan, pilih "dokumen". Sertakan document_type: "payment_receipt", "invoice", "ac_photo", "review", "other".
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
  // pemisah ribuan ("Rp 200.000"), kecuali dua digit terakhir yang
  // jelas merupakan sen ("Rp 200.000,00" atau "Rp 200,000.00").
  const raw = typeof value === "number" ? "" : String(value).replace(/[^0-9.,]/g, "");
  const normalized = /[.,]\d{2}$/.test(raw) && (/[.,]\d{3}[.,]\d{2}$/.test(raw) || /[.,]00$/.test(raw))
    ? raw.slice(0, -3) : raw;
  if (typeof value !== "number" && !/\d/.test(normalized)) return null;
  const number = typeof value === "number"
    ? value
    : Number(normalized.replace(/[^0-9]/g, ""));
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export function normalizePaymentClassification(input) {
  if (!input || typeof input !== "object") return null;
  const rawCategory = String(input.category || "").trim().toLowerCase();
  if (!rawCategory) return null;
  const category = ["bukti_transfer", "kerusakan_ac", "dokumen", "tidak_relevan"].includes(rawCategory)
    ? rawCategory : "dokumen"; // kategori tak dikenal bukan bukti pembayaran
  const nonPayment = ["invoice", "quotation", "ac_photo", "review", "other", "failed_transfer", "pending_transfer"].includes(input.document_type);
  const transferAmount = cleanMoney(input.transfer_amount ?? input.nominal_transfer ?? input.amount);
  const feeAmount = cleanMoney(input.fee_amount ?? input.admin_fee ?? input.biaya_admin);
  const totalDebit = cleanMoney(input.total_debit ?? input.total_amount);
  return {
    ...input,
    category: nonPayment && category === "bukti_transfer" ? "dokumen" : category,
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
  : mimeType === "image/gif" ? "gif"
  : mimeType === "application/pdf" ? "pdf" : "jpg";

export function hasPaymentMediaHint(message) {
  return /bukti\s*(?:bayar|transfer|pembayaran|tf)\b|(?:lampir\w*|terlampir|kirim\w*|ini|berikut)\s+bukti(?:nya)?\b|\b(?:bayar|transfer|tf|lunas|pembayaran|tagihan|struk|receipt)\b/i.test(String(message || ""));
}

export function manualPaymentReviewReason({ category }) {
  // Neither captions nor a failed invoice lookup may override visual classification.
  // A receipt with unreadable amount remains category bukti_transfer (reviewed normally).
  if (category === "bukti_transfer") return "Bukti pembayaran teridentifikasi; periksa nominal sebelum konfirmasi.";
  return null;
}

export async function registerPaymentMediaReference({ supabaseUrl, serviceKey, sourceUrl, phone, senderName, mimeType }) {
  if (!supabaseUrl || !serviceKey || !sourceUrl || !phone) return { ok: false, error: "parameter queue tidak lengkap" };
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/wa_payment_media_jobs?on_conflict=source_url`, {
      method: "POST",
      headers: restHeaders(serviceKey, "resolution=ignore-duplicates,return=representation"),
      body: JSON.stringify({
        source_url: sourceUrl, phone, sender_name: senderName || null,
        mime_type: mimeType || null, status: "RECEIVED",
        next_retry_at: new Date(Date.now() + 120_000).toISOString(), updated_at: new Date().toISOString(),
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

export async function stagePaymentMedia({ supabaseUrl, serviceKey, sourceUrl, phone, senderName, buffer, mimeType, createdAt, leaseToken }) {
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
  // Short-lived quarantine, not an archive of every customer unit photo.
  const key = `wa-staging/${month}/${digest}.${extensionFor(mimeType)}`;
  const upload = await uploadBufferToR2({ buffer: Buffer.from(buffer), key, mimeType: mimeType || "image/jpeg" });
  if (!upload.ok) return { ok: false, error: upload.err || "R2 upload gagal" };

  const response = await fetch(`${supabaseUrl}/rest/v1/wa_payment_media_jobs?on_conflict=source_url`, {
    method: "POST",
    headers: restHeaders(serviceKey, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify({
      source_url: sourceUrl, phone, sender_name: senderName || null,
      mime_type: mimeType || "image/jpeg", r2_key: key, r2_url: upload.url,
      status: leaseToken ? "PROCESSING" : "STORED",
      next_retry_at: new Date(Date.now() + 120_000).toISOString(), updated_at: new Date().toISOString(),
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

export async function updatePaymentMediaJob({ supabaseUrl, serviceKey, id, patch, leaseToken }) {
  if (!id) return { ok: false, error: "job id kosong" };
  try {
    const filter = leaseToken ? `&lease_token=eq.${encodeURIComponent(leaseToken)}` : "";
    const response = await fetch(`${supabaseUrl}/rest/v1/wa_payment_media_jobs?id=eq.${encodeURIComponent(id)}${filter}`, {
      method: "PATCH", headers: restHeaders(serviceKey, leaseToken ? "return=representation" : "return=minimal"),
      body: JSON.stringify({ ...patch, ...(leaseToken ? { lease_token: null, lease_expires_at: null } : {}), updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, error: `queue patch ${response.status}` };
    if (leaseToken && !(await response.json())?.length) return { ok: false, error: "Lease antrean berubah; hasil worker lama tidak ditimpa" };
    return { ok: true };
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

export async function preservePaymentEvidence({ supabaseUrl, serviceKey, job, mediaBuffer, leaseToken }) {
  if (!job?.r2_key?.startsWith("wa-staging/")) return { ok: true, job };
  if (!/^wa-staging\/\d{4}-\d{2}\/[a-f0-9]{24}\.(jpg|png|gif|webp|pdf)$/.test(job.r2_key)) return { ok: false, error: "Key staging tidak valid" };
  const media = mediaBuffer?.length ? { ok: true, buffer: mediaBuffer } : await downloadBufferFromR2(job.r2_key, { timeoutMs: 7000 });
  if (!media.ok) return { ok: false, error: media.err };
  const key = job.r2_key.replace(/^wa-staging\//, "wa-inbox/");
  const upload = await uploadBufferToR2({ buffer: media.buffer, key, mimeType: job.mime_type || "image/jpeg" });
  if (!upload.ok) return { ok: false, error: upload.err };
  try {
    // Do not release a retry worker's lease while copying evidence.
    const response = await fetch(`${supabaseUrl}/rest/v1/wa_payment_media_jobs?id=eq.${encodeURIComponent(job.id)}&r2_key=eq.${encodeURIComponent(job.r2_key)}${leaseToken ? `&lease_token=eq.${encodeURIComponent(leaseToken)}` : ""}`, {
      method: "PATCH", headers: restHeaders(serviceKey), body: JSON.stringify({ r2_key: key, r2_url: upload.url }), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, error: `preserve proof ${response.status}` };
    const row = (await response.json())?.[0];
    return row ? { ok: true, job: { ...job, ...row, r2_key: key, r2_url: upload.url } } : { ok: false, error: "Referensi media berubah saat menyimpan bukti" };
  } catch (error) { return { ok: false, error: error.message }; }
}

export async function ensurePaymentSuggestion({ supabaseUrl, serviceKey, job, classification = null, pendingReason = null, invoiceMatch = null, forceReview = false, mediaBuffer, leaseToken }) {
  const evidence = { ...classification, category: classification?.category || job?.category };
  // Only an identified receipt qualifies; an amount by itself proves nothing.
  if (!isPaymentEvidenceClassification(evidence)) return { ok: true, skipped: true, reason: "not_payment_evidence" };
  if (!job?.id || !job?.phone || !job?.r2_url) return { ok: false, error: "job media belum lengkap" };
  const preserved = await preservePaymentEvidence({ supabaseUrl, serviceKey, job, mediaBuffer, leaseToken });
  if (!preserved.ok) return preserved;
  job = preserved.job;
  let match;
  let lookupWarning = null;
  try { match = invoiceMatch || await findPaymentInvoiceMatch({ supabaseUrl, serviceKey, phone: job.phone, amount: classification?.amount }); }
  catch (error) {
    // Gagal mencari invoice tidak boleh membuang bukti yang sudah aman di R2.
    // Simpan sebagai review tanpa auto-link; admin tetap memeriksa kecocokannya.
    match = matchPaymentInvoices([], job.phone, classification?.amount);
    lookupWarning = `Pencocokan invoice gagal: ${error.message}`;
  }
  if (classification || !match.candidates.length) {
    try {
      const settled = await findSettledPaymentMedia({ supabaseUrl, serviceKey, job });
      if (settled) return { ok: true, alreadySettled: true, invoice: settled, inserted: false };
    } catch (error) { lookupWarning = `Pemeriksaan bukti terpakai gagal: ${error.message}`; }
  }
  const invoice = !forceReview && match.kind === "single" ? match.invoices[0] : null;
  if (!classification && !forceReview && !match.candidates.length) return { ok: true, skipped: true };
  const payload = {
    media_job_id: job.id,
    phone: job.phone,
    sender_name: job.sender_name || null,
    raw_message: pendingReason ? `Media WA perlu review manual: ${pendingReason}${lookupWarning ? ` · ${lookupWarning}` : ""}`
      : match.kind === "multi" ? `Saran alokasi ${match.invoices.length} invoice: ${match.invoices.map(i => i.id).join(", ")}. Periksa sebelum konfirmasi.`
      : `Bukti transfer terdeteksi AI. Periksa invoice dan nominal sebelum konfirmasi.${lookupWarning ? ` ${lookupWarning}` : ""}`,
    amount: classification?.amount ?? null,
    bank: classification?.bank || null,
    transfer_date: classification?.transfer_date || null,
    invoice_id: invoice?.id || null,
    order_id: invoice?.job_id || null,
    match_source: forceReview ? "wa_image_review" : classification ? (match.kind === "multi" ? "wa_image_ai_multi" : "wa_image_ai") : "wa_image_ai_pending",
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
      if (classification && suggestion?.status === "PENDING" && ["wa_image_ai_pending", "wa_image_review"].includes(suggestion.match_source)) {
        const enrich = await fetch(`${supabaseUrl}/rest/v1/payment_suggestions?id=eq.${suggestion.id}&status=eq.PENDING&match_source=eq.${suggestion.match_source}`, {
          method: "PATCH", headers: restHeaders(serviceKey), body: JSON.stringify(payload), signal: AbortSignal.timeout(5000),
        });
        if (!enrich.ok) return { ok: false, error: `suggestion enrich ${enrich.status}` };
        suggestion = (await enrich.json())?.[0] || suggestion;
      }
    }
    if (!suggestion) return { ok: false, error: "suggestion tidak ditemukan setelah penyimpanan" };
    return { ok: true, suggestion, invoice, match, inserted, evidenceUrl: job.r2_url };
  } catch (error) {
    return { ok: false, error: `suggestion upsert gagal: ${error?.message || error}` };
  }
}

export async function retryOnePaymentMediaJob({ supabaseUrl, serviceKey, apiKey }) {
  let job;
  const leaseToken = randomUUID();
  try {
    // Atomic SKIP LOCKED claim, no fail-open fallback to unleased SELECT/PATCH.
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_wa_payment_media`, {
      method: "POST", headers: restHeaders(serviceKey), body: JSON.stringify({ p_lease_token: leaseToken }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { error: `queue claim ${response.status}; periksa migrasi 210` };
    job = await response.json();
  } catch (error) {
    return { error: `queue fetch gagal: ${error?.message || error}` };
  }
  if (!job) return { checked: 0, retried: 0 };
  const attempt = Number(job.attempts || 1);
  const finish = patch => updatePaymentMediaJob({ supabaseUrl, serviceKey, id: job.id, leaseToken, patch });
  let activeJob = job;
  if (["kerusakan_ac", "dokumen", "tidak_relevan"].includes(job.category)) {
    const saved = await finish({ status: "IGNORED", next_retry_at: null, last_error: null });
    return { ok: saved.ok, checked: 1, retried: 0, ignored: 1, error: saved.error || null };
  }
  const cached = job.category === "bukti_transfer" && job.r2_url
    ? normalizePaymentClassification(job) : null;
  let ai;
  if (cached) ai = { ok: true, classification: cached };
  else if (job.retry_exhausted) ai = { ok: false, error: "Retry AI habis setelah worker terputus; periksa media secara manual" };
  else {
    let media = job.r2_key
      ? await downloadBufferFromR2(job.r2_key, { timeoutMs: 7000 })
      : await downloadToBuffer(job.source_url, { timeoutMs: 7000 });
    if (media.ok && !job.r2_key) {
      const staged = await stagePaymentMedia({
        supabaseUrl, serviceKey, sourceUrl: job.source_url, phone: job.phone,
        senderName: job.sender_name, buffer: media.buffer,
        mimeType: media.mimeType || job.mime_type, createdAt: job.created_at, leaseToken,
      });
      if (!staged.ok) media = { ok: false, err: staged.error };
      else activeJob = staged.job;
    }
    if (!media.ok) {
      const saved = await finish({ status: attempt >= 3 ? "FAILED_PERMANENT" : "FAILED_RETRYABLE", last_error: media.err,
        next_retry_at: attempt >= 3 ? null : new Date(Date.now() + 15 * 60_000 * 2 ** (attempt - 1)).toISOString() });
      return { ok: saved.ok, checked: 1, retried: 0, failed: 1, error: saved.error || media.err };
    }
    ai = await classifyPaymentMedia({ buffer: media.buffer, mimeType: activeJob.mime_type || media.mimeType, apiKey, timeoutMs: 9000 });
  }
  if (!ai.ok) {
    const saved = await finish({
      status: attempt >= 3 ? "FAILED_PERMANENT" : "FAILED_RETRYABLE",
      last_error: ai.error,
      next_retry_at: attempt >= 3 ? null : new Date(Date.now() + 15 * 60_000 * 2 ** (attempt - 1)).toISOString(),
    });
    return { ok: false, checked: 1, retried: 1, failed: 1, error: saved.error || ai.error };
  }
  const c = ai.classification;
  if (c.category !== "bukti_transfer") {
    const ignored = await finish({ status: "IGNORED", category: c.category, next_retry_at: null });
    return { ok: ignored.ok, checked: 1, retried: 1, ignored: 1, error: ignored.error || null };
  }
  const suggestion = await ensurePaymentSuggestion({ supabaseUrl, serviceKey, job: activeJob, classification: c, leaseToken });
  const saved = await finish({
    status: suggestion.ok ? "DONE" : attempt >= 3 ? "FAILED_PERMANENT" : "FAILED_RETRYABLE", category: c.category,
    transfer_amount: c.amount, fee_amount: c.fee_amount, total_debit: c.total_debit,
    bank: c.bank, transfer_date: c.transfer_date, invoice_id: suggestion.invoice?.id || null,
    last_error: suggestion.ok ? null : suggestion.error,
    next_retry_at: suggestion.ok || attempt >= 3 ? null : new Date(Date.now() + 15 * 60_000 * 2 ** (attempt - 1)).toISOString(),
  });
  return { ok: suggestion.ok && saved.ok, checked: 1, retried: 1, suggestion: suggestion.suggestion ? 1 : 0, alreadySettled: suggestion.alreadySettled === true, invoiceId: suggestion.invoice?.id || null, error: suggestion.error || saved.error || null };
}
