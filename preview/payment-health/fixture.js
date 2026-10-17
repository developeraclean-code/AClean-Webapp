// Synthetic data only: reproduces the 5 archived failures + 6 manual reviews,
// without using customer names, phone numbers or production media URLs.
export function paymentHealthFixture(mode = "idle", now = Date.now()) {
  const timestamp = new Date(now).toISOString();
  const lastRun = { status: "SUCCESS", started_at: new Date(now - 2_000).toISOString(), finished_at: timestamp, checked: 0, retried: 0 };
  const health = {
    enabled: true, generated_at: timestamp, last_worker_at: timestamp,
    waiting: 0, overdue: 0, unsecured: 0, failed: 5, recent_failed: 0, review: 76,
    last_run: lastRun, last_run_error: false,
    ingress: { available: true, last_received_at: timestamp, recent_received: 250, review_count: 0, incidents: [] },
    incidents: [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `ARCHIVE-${i}`, sender_name: `Media arsip contoh ${i + 1}`, phone: `62800000000${i}`, status: "FAILED_PERMANENT", attempts: 0,
        created_at: "2026-10-05T03:25:59Z", last_error: "URL sumber mengembalikan HTTP 404; file belum pernah tersimpan di R2. Periksa arsip WA/kirim ulang.", has_suggestion: false })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `REVIEW-${i}`, sender_name: `Media tinjauan contoh ${i + 1}`, phone: `62800000001${i}`, status: "PENDING_REVIEW", attempts: 0,
        created_at: "2026-10-16T07:32:31Z", r2_url: "/preview/payment-health/index.html?media=contoh", has_suggestion: true })),
    ],
  };
  if (mode === "waiting") {
    health.waiting = 2; health.unsecured = 1; health.overdue = 1;
    health.last_run = { ...lastRun, checked: 1, retried: 1, suggestion: 1 };
    health.incidents.push(
      { id: "RETRY", sender_name: "Media retry contoh", phone: "628000000020", status: "FAILED_RETRYABLE", r2_url: "/preview/payment-health/index.html?media=contoh", attempts: 1, created_at: timestamp, next_retry_at: new Date(now + 15 * 60_000).toISOString() },
      { id: "RECEIVED", sender_name: "Media baru contoh", phone: "628000000021", status: "RECEIVED", attempts: 0, created_at: timestamp },
    );
  }
  if (mode === "failed") health.last_run = { ...lastRun, status: "FAILED", checked: 1, retried: 0, failed: 1 };
  if (mode === "unavailable") { health.last_run = null; health.last_run_error = true; }
  if (mode === "disabled") { health.enabled = false; health.last_run = { ...lastRun, status: "SKIPPED", reason: "wa_payment_detect_off" }; }
  if (mode === "ingress-review") health.ingress = { ...health.ingress, review_count: 2, incidents: [
    { id: "DEMO-URL", sender: "628000000030", type: "image", reason: "Foto/dokumen diterima tanpa URL Fonnte yang aman; file belum dapat diunduh.", created_at: timestamp },
    { id: "DEMO-LID", sender: "unknown@lid", type: "image", reason: "Identitas pengirim belum dapat dipastikan; jangan menebak nomor dari LID.", created_at: timestamp },
  ] };
  if (mode === "ingress-unavailable") health.ingress = { available: false, error: "Status penerimaan webhook belum tersedia; periksa koneksi/migrasi 214" };
  return health;
}
