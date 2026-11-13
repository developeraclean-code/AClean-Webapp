import { downloadBufferFromR2 } from "./_r2-upload.js";
import { sniffMediaMimeType } from "./_media-format.js";

const restHeaders = key => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVOICE_ID = /^[A-Za-z0-9_-]{3,80}$/;

async function paymentActor(req, supabaseUrl, serviceKey) {
  if (!req.appClaims?.userId && !req.authUser?.id) return null;
  const id = req.appClaims?.userId || req.authUser.id;
  if (!UUID.test(String(id))) return null;
  const response = await fetch(`${supabaseUrl}/rest/v1/user_profiles?select=role,active&id=eq.${id}&limit=1`, {
    headers: restHeaders(serviceKey), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Profil pemanggil tidak dapat diverifikasi");
  const profile = (await response.json())?.[0];
  return profile?.active === true ? String(profile.role || "").toLowerCase() : null;
}

async function detectionEnabled(supabaseUrl, serviceKey) {
  const response = await fetch(`${supabaseUrl}/rest/v1/app_settings?select=value&key=eq.wa_payment_detect&limit=1`, {
    headers: restHeaders(serviceKey), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Payment detection setting unavailable");
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Payment detection setting invalid");
  return rows[0]?.value !== "false";
}

// Operator requeues one failed media reference. The scheduler then owns the
// download, R2 mirror, AI classification and suggestion; no HTTP request waits
// for WhaCenter or changes an invoice/payment.
export async function paymentMediaRetry(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  res.setHeader("Cache-Control", "no-store");
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: "Database belum dikonfigurasi" });
  try {
    const role = await paymentActor(req, supabaseUrl, serviceKey);
    if (!["owner", "admin"].includes(role)) return res.status(403).json({ error: "Hanya Owner/Admin dapat mengulang media" });
    if (!await detectionEnabled(supabaseUrl, serviceKey)) return res.status(409).json({ error: "Deteksi bukti WA sedang dimatikan" });
    const id = String(req.body?.jobId || "");
    if (!UUID.test(id)) return res.status(400).json({ error: "Job ID tidak valid" });
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/requeue_failed_payment_media_237`, {
      method: "POST", headers: restHeaders(serviceKey), body: JSON.stringify({ p_job_id: id }), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return res.status(response.status === 404 ? 503 : response.status === 400 ? 409 : 503)
      .json({ error: response.status === 404 ? "Migrasi pemulihan media belum tersedia" : "Media tidak dapat diantrekan ulang; periksa file atau status terbaru" });
    const result = await response.json();
    return res.status(result?.queued ? 202 : 409).json(result?.queued
      ? { queued: true, status: "FAILED_RETRYABLE" }
      : { queued: false, error: "Status media sudah berubah; perbarui daftar" });
  } catch { return res.status(503).json({ error: "Gagal mengantrekan ulang media" }); }
}

// The invoice upload already put a file in R2. Verify its exact key and bytes,
// then enqueue it for the existing AI worker without fetching any WA URL.
export async function paymentMediaManualUpload(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  res.setHeader("Cache-Control", "no-store");
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: "Database belum dikonfigurasi" });
  try {
    const role = await paymentActor(req, supabaseUrl, serviceKey);
    if (!["owner", "admin", "finance"].includes(role)) return res.status(403).json({ error: "Akses invoice diperlukan" });
    if (!await detectionEnabled(supabaseUrl, serviceKey)) return res.status(409).json({ error: "Deteksi bukti WA sedang dimatikan; lampirkan manual" });
    const invoiceId = String(req.body?.invoiceId || "");
    const key = String(req.body?.r2Key || "");
    if (!INVOICE_ID.test(invoiceId) || key.length > 200 || !key.startsWith(`laporan/bukti-${invoiceId}/`)
      || !/^\d+_proof_[A-Za-z0-9_-]+_\d+\.jpg$/.test(key.split("/").at(-1))
      || !key.split("/").at(-1).includes(`_proof_${invoiceId}_`)) {
      return res.status(400).json({ error: "Referensi bukti unggahan tidak valid" });
    }
    const invoiceResponse = await fetch(`${supabaseUrl}/rest/v1/invoices?select=id,phone,status,payment_proof_url&id=eq.${encodeURIComponent(invoiceId)}&limit=1`, {
      headers: restHeaders(serviceKey), signal: AbortSignal.timeout(5000),
    });
    if (!invoiceResponse.ok) throw new Error("invoice lookup failed");
    const invoice = (await invoiceResponse.json())?.[0];
    if (!invoice || !["UNPAID", "OVERDUE", "PARTIAL_PAID"].includes(invoice.status) || invoice.payment_proof_url)
      return res.status(409).json({ error: "Invoice sudah berubah; perbarui sebelum melampirkan" });
    const phone = String(invoice.phone || "").replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(phone)) return res.status(409).json({ error: "Nomor invoice belum valid untuk saran AI" });
    const media = await downloadBufferFromR2(key, { timeoutMs: 7000 });
    if (!media.ok) return res.status(503).json({ error: "File unggahan belum dapat dibaca dari R2" });
    const mimeType = media.buffer.length <= 10 * 1024 * 1024 ? sniffMediaMimeType(media.buffer) : null;
    if (!mimeType?.startsWith("image/")) return res.status(422).json({ error: "File bukti harus gambar yang dapat dibuka (maks. 10 MB)" });
    const sourceUrl = `manual-upload:${key}`;
    const proofUrl = `/api/foto?key=${encodeURIComponent(key)}`;
    const saved = await fetch(`${supabaseUrl}/rest/v1/wa_payment_media_jobs?on_conflict=source_url`, {
      method: "POST", headers: { ...restHeaders(serviceKey), Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ source_url: sourceUrl, phone, sender_name: "Unggahan manual", provider: "manual",
        mime_type: mimeType, r2_key: key, r2_url: proofUrl, invoice_id: invoiceId, status: "STORED",
        next_retry_at: new Date().toISOString() }), signal: AbortSignal.timeout(5000),
    });
    if (!saved.ok) throw new Error("queue insert failed");
    const row = (await saved.json())?.[0];
    if (!row) {
      const existing = await fetch(`${supabaseUrl}/rest/v1/wa_payment_media_jobs?select=status&source_url=eq.${encodeURIComponent(sourceUrl)}&limit=1`, {
        headers: restHeaders(serviceKey), signal: AbortSignal.timeout(5000),
      });
      if (!existing.ok) throw new Error("queue lookup failed");
      const status = (await existing.json())?.[0]?.status;
      if (!status) throw new Error("queue lookup empty");
      return res.status(200).json({ queued: ["STORED", "PROCESSING", "FAILED_RETRYABLE", "RECEIVED"].includes(status),
        duplicate: true, status, proofUrl });
    }
    return res.status(202).json({ queued: true, duplicate: false, proofUrl });
  } catch { return res.status(503).json({ error: "Unggahan tersimpan, tetapi antrean AI belum dapat dipastikan" }); }
}
