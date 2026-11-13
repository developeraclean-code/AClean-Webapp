# Sentry pada Coolify / Supabase self-hosted

Diperbarui 12 November 2026. Panduan ini membedakan kode yang siap dirilis dari
konfigurasi runtime yang benar-benar telah diperiksa.

## Bukti saat pemeriksaan

Produksi `app.aclean.id` sehat pada source `d03d85e`, tetapi `SENTRY_DSN` runtime
kosong dan DSN frontend tidak ditemukan dalam asset hasil build. Karena itu
keberadaan SDK dalam repo **belum berarti error produksi terkirim**.
Dua DSN yang sudah tersedia secara lokal menerima event INFO sintetis (HTTP 200).
Pemeriksaan tersebut tidak membuktikan event muncul di dashboard, aturan alert,
email penerima, atau instrumentasi container produksi.

Bukti tanpa secret: [monitoring-readonly.json](../deliverables/voucher-hardening-2026-11-12/monitoring-readonly.json)
dan [sentry-ingestion.json](../deliverables/voucher-hardening-2026-11-12/sentry-ingestion.json).

## Konfigurasi deployment

| Variabel | Coolify build | Coolify runtime | Kegunaan |
| --- | --- | --- | --- |
| `VITE_SENTRY_DSN` | Ya | Tidak diperlukan | Di-embed Vite ke frontend; perubahan membutuhkan rebuild. DSN publik proyek React, bukan auth token Sentry. |
| `SENTRY_DSN` | Tidak | Ya | Inisialisasi SDK Node dalam container API. |
| `VITE_SENTRY_ENVIRONMENT` | Ya | Tidak diperlukan | `staging` atau `production` pada frontend. |
| `SENTRY_ENVIRONMENT` | Tidak | Ya | `staging` atau `production` pada backend, agar hasil build staging tidak berlabel production. |
| `SOURCE_COMMIT` | Tidak diperlukan | Ya | SHA source aktual dari Coolify untuk backend dan health. |
| `ACLEAN_BUILD_SHA` | Ya | Ya | Isi SHA yang sama dengan pin kandidat; build ARG ini menjadi `VITE_APP_BUILD_SHA` untuk release frontend. |

Gunakan DSN proyek/environment yang benar pada staging dan production. Jangan
menambahkan auth token Sentry ke `VITE_*`. Koneksi akun Sentry untuk membaca
project/events berbeda dari DSN penerimaan dan memerlukan otorisasi tersendiri.
Tidak perlu menginstal Sentry pada server PostgreSQL: SDK menangkap kegagalan
aplikasi/API; uptime eksternal mengamati jalur health Auth dan Database API.

Patch ini memasang `beforeSend` bersama untuk menghapus payload bisnis, user,
header, query, capability portal, variabel lokal, dan breadcrumb console/DOM.
Pesan exception dibuat generik; jenis error dan frame kode tetap tersedia.
Performance tracing dimatikan agar payload tersebut tidak ikut mengirim data
bisnis dan tidak menambah sampling transaksi pada VPS. Source map upload dan
alert dashboard belum dikonfigurasi melalui patch ini.

## Verifikasi

1. Periksa keberadaan DSN dan scope build/runtime tanpa mencetak nilainya.
2. Build/deploy kandidat, cocokkan source container, release frontend, dan
   `/api/health?component=app` dengan SHA yang dirilis.
3. Jalankan probe INFO sintetis tanpa pelanggan/credential, pastikan HTTP 200.
   Script lokal: `node scripts/check-sentry-ingestion.mjs /path/to/existing.env`.
   Script tidak memuat environment ke shell dan hanya mencetak event ID/status.
4. Dengan akses dashboard yang disetujui, cari event ID dan cocokkan project,
   environment, release; periksa aturan alert serta penerima. Tidak ada endpoint
   publik baru yang sengaja memicu error.
5. Untuk menguji alert, gunakan mekanisme test pada layanan monitoring; jangan
   mematikan produksi atau menciptakan transaksi pelanggan untuk pengujian.

Referensi SDK resmi: [Node](https://docs.sentry.io/platforms/javascript/guides/node/)
dan [filtering](https://docs.sentry.io/platforms/javascript/configuration/filtering/).
