export function paymentMediaState(job = {}) {
  if (job.status === "FAILED_PERMANENT") return {
    group: "failed",
    label: job.r2_url ? "Perlu pemeriksaan manual" : "File belum diamankan · periksa WA/kirim ulang",
    level: "error",
    explanation: "Pemrosesan otomatis sudah berhenti untuk media ini; tidak masuk antrean retry aktif.",
    action: job.r2_url ? job.has_suggestion ? "Buka media tersimpan dan periksa manual di Pending AI." : "Buka media tersimpan. Jika ini bukti bayar, lampirkan secara manual pada invoice yang benar." : "Periksa arsip WA. Jika ini bukti bayar, unggah ulang melalui Lampirkan Bukti pada invoice yang benar.",
  };
  if (["RECEIVED", "STORED", "PROCESSING", "FAILED_RETRYABLE"].includes(job.status)) return {
    group: "retry",
    label: job.status === "PROCESSING" ? "Sedang diproses otomatis" : job.r2_url ? "Media aman · menunggu pemrosesan/retry" : "Media diterima · belum aman di R2",
    level: job.r2_url ? "warning" : "error",
    explanation: job.status === "PROCESSING" ? "Worker sedang menangani media ini." : "Masih dalam antrean otomatis; jadwal retry bukan jaminan waktu selesai.",
    action: job.r2_url ? "File sudah tersimpan. Tunggu hasil pemrosesan atau periksa file bila diperlukan." : "File belum tersimpan di R2. Simpan salinan WA bila masih tersedia.",
  };
  if (job.status === "PENDING_REVIEW") return {
    group: "admin", label: "Perlu diperiksa admin · bukan konfirmasi pembayaran", level: "warning",
    explanation: "Sudah masuk tinjauan manual, bukan antrean retry otomatis.",
    action: job.r2_url ? "Buka Pending AI untuk memeriksa media, invoice, pengirim dan nominalnya." : "Periksa arsip WA dan ketersediaan file sebelum memverifikasi pembayaran.",
  };
  if (["DONE", "IGNORED"].includes(job.status)) return {
    group: "complete", label: "Pemrosesan media selesai", level: "ok",
    explanation: "Tidak lagi menunggu retry. Ini bukan penetapan invoice lunas.", action: "Periksa riwayat invoice jika ingin memastikan status pembayarannya.",
  };
  return { group: "unknown", label: "Status media belum dikenali", level: "warning", explanation: "Status ini belum dapat dipastikan dari data yang tersedia.", action: "Perbarui status; jangan langsung menganggap media selesai atau invoice lunas." };
}

export function paymentWorkerState(health, now = Date.now()) {
  if (health?.enabled === false) return { level: "warning", label: "Deteksi bukti bayar dimatikan di Pengaturan" };
  const lastWorker = Date.parse(health?.last_worker_at);
  if (!Number.isFinite(lastWorker) || lastWorker > now + 5 * 60_000 || now - lastWorker > 45 * 60_000) {
    return { level: "error", label: "Pemicu retry belum berjalan dalam 45 menit terakhir" };
  }
  if (Number(health.overdue) > 0) return { level: "warning", label: "Ada media menunggu lebih dari 30 menit" };
  return { level: "ok", label: "Pemicu retry aktif · pemeriksaan berkala 24 jam" };
}

export function paymentWorkerResult(health, now = Date.now()) {
  if (health?.last_run_error) return { level: "warning", label: "Hasil pemeriksaan belum dapat dibaca", detail: "Angka antrean tetap tersedia. Perbarui status untuk mencoba membaca hasil lagi." };
  const run = health?.last_run;
  if (!run) return { level: "warning", label: "Belum ada hasil pemeriksaan tercatat", detail: "Heartbeat pemicu tidak sama dengan hasil pemrosesan media." };
  if (run.status === "RUNNING") {
    const started = Date.parse(run.started_at);
    const delayed = !Number.isFinite(started) || now - started > 5 * 60_000 || started > now + 5 * 60_000;
    return { level: "warning", label: delayed ? "Pemeriksaan belum selesai · perlu dipantau" : "Pemeriksaan sedang berjalan", detail: "Hasil akhir belum tercatat. Perbarui status setelah proses selesai." };
  }
  if (run.status === "SKIPPED") return {
    level: "warning", label: "Pemrosesan dilewati",
    detail: run.reason === "wa_payment_detect_off" ? "Deteksi bukti bayar sedang dimatikan di Pengaturan." : "Pemicu berjalan, tetapi tidak menjalankan pemrosesan media pada pemeriksaan ini.",
  };
  if (["FAILED", "TIMEOUT"].includes(run.status)) return {
    level: run.pendingReview > 0 ? "warning" : "error",
    label: run.pendingReview > 0 ? "Pemrosesan belum tuntas · masuk tinjauan admin" : run.status === "TIMEOUT" ? "Pemeriksaan melewati batas waktu" : "Pemeriksaan terakhir gagal",
    detail: run.pendingReview > 0 ? "Kandidat tinjauan manual tersedia. Periksa media sebelum memverifikasi pembayaran." : "Periksa rincian antrean di bawah. Status ini tidak mengubah pembayaran atau invoice.",
  };
  if (run.status !== "SUCCESS") return { level: "warning", label: "Hasil pemeriksaan belum dikenali", detail: "Perbarui status; hasil belum dapat dinyatakan berhasil." };
  if (run.pendingReview > 0) return { level: "warning", label: "Media masuk tinjauan admin", detail: "Pemrosesan selesai, tetapi media masih perlu diperiksa manual." };
  if (run.failed > 0) return { level: "warning", label: "Ada media belum berhasil diproses", detail: "Pemicu selesai, tetapi ada kegagalan media. Periksa rincian di bawah." };
  if (run.suggestion > 0) return { level: "ok", label: "Bukti tersedia untuk ditinjau", detail: "Kandidat bukti sudah tersedia. Ini bukan konfirmasi pembayaran lunas." };
  if (run.ignored > 0) return { level: "ok", label: "Media selesai diklasifikasi", detail: "Media tidak memerlukan retry bukti bayar; bukan konfirmasi pembayaran." };
  if (run.alreadySettled) return { level: "ok", label: "Media terkait invoice yang sudah diselesaikan", detail: "Tidak membuat konfirmasi pembayaran baru. Periksa riwayat invoice untuk detailnya." };
  if (run.checked === 0 && run.retried === 0) return { level: "ok", label: "Berhasil · antrean retry kosong", detail: "Tidak ada media yang perlu dicoba ulang pada pemeriksaan ini." };
  return { level: "ok", label: "Pemeriksaan berhasil", detail: run.checked > 0 ? `${run.checked} media diperiksa pada proses ini. Periksa rincian untuk tindak lanjut.` : "Rincian jumlah media pada proses ini tidak tersedia." };
}
