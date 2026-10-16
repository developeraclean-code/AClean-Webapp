export function paymentMediaState(job) {
  if (job.status === "FAILED_PERMANENT") return {
    label: job.r2_url ? "Perlu pemeriksaan manual" : "File belum diamankan · periksa WA/kirim ulang",
    level: "error",
  };
  if (["RECEIVED", "STORED", "PROCESSING", "FAILED_RETRYABLE"].includes(job.status)) return {
    label: job.r2_url ? "Media aman · pemrosesan/retry tertunda" : "Media diterima · belum aman di R2",
    level: job.r2_url ? "warning" : "error",
  };
  return { label: "Perlu diperiksa admin · bukan konfirmasi pembayaran", level: "warning" };
}

export function paymentWorkerState(health, now = Date.now()) {
  if (health?.enabled === false) return { level: "warning", label: "Deteksi bukti bayar dimatikan di Pengaturan" };
  if (!health?.last_worker_at || now - Date.parse(health.last_worker_at) > 45 * 60_000) {
    return { level: "error", label: "Pemicu retry belum berjalan dalam 45 menit terakhir" };
  }
  if (Number(health.overdue) > 0) return { level: "warning", label: "Ada media menunggu lebih dari 30 menit" };
  return { level: "ok", label: "Penerimaan bukti 24 jam · pemicu retry terpantau" };
}
