// Pelaporan error terpusat — supaya error yang dulu "ditelan diam-diam"
// (catch kosong / console.error saja) ikut terdeteksi di Sentry beserta konteks.
//
// Pakai untuk JALUR PENTING (simpan/hapus/upload/bayar) di mana gagal = data
// hilang atau perilaku salah. JANGAN dipakai untuk fallback jinak (mis. parse
// body opsional) yang sengaja diabaikan — itu cukup pakai breadcrumb().
import * as Sentry from "@sentry/react";

// Lapor exception yang sebelumnya disembunyikan. where = label lokasi unik
// (mis. "project.allocateMaterials"), extra = konteks (id, payload ringkas).
export function reportError(where, error, extra = {}) {
  try {
    // tetap log ke console untuk debugging lokal
    // eslint-disable-next-line no-console
    console.error(`[${where}]`, error, extra);
    const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
    Sentry.captureException(err, { tags: { silent_sink: where }, extra });
  } catch {
    /* pelaporan error tidak boleh ikut bikin crash */
  }
}

// Catat jejak (bukan error) untuk no-op yang mencurigakan — mis. operasi yang
// "berhasil" tapi 0 baris kena. Muncul sebagai breadcrumb di event berikutnya.
export function breadcrumb(message, data = {}) {
  try {
    Sentry.addBreadcrumb({ category: "app", level: "warning", message, data });
  } catch { /* no-op */ }
}
