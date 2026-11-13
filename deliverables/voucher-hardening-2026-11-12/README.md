# Bukti kandidat voucer dan monitoring

Laporan implementasi: [VOUCHER_HARDENING_2026-11-12.md](../../docs/VOUCHER_HARDENING_2026-11-12.md).
Semua tes bisnis memakai orang/nomor/credential fiktif. Probe produksi hanya
membaca metadata/health/agregat, tanpa memutasi pelanggan atau mengirim WA.

- `browser-results.json`: alur UI → API → SQL lokal.
- `db-results.log`: transaksi, hak akses, cancel, pajak, pagination dan total nol.
- `native-results.log`: koneksi PostgreSQL bersamaan, dedup dan otomasi.
- `unit-tests.log`, `checks.log`, `build.log`: validasi umum kandidat final.
- `monitoring-readonly.json`: snapshot konfigurasi runtime dan health produksi;
  bukan inspeksi akun uptime eksternal.
- `sentry-ingestion.json`: dua event INFO sintetis melalui SDK lokal ke DSN
  existing. HTTP 200 tidak sama dengan verifikasi dashboard/notifikasi.

Definisi empat fungsi guard invoice aktual beserta trigger terkait disimpan
pada `scripts/fixtures/voucher-production-guards.sql` tanpa data pelanggan.
Matriks role/unit/API/otomasi/privacy berada pada `src/lib/__tests__/voucher*.test.js`
dan `sentryPrivacy.test.js`. Tes browser tidak menyentuh jaringan Supabase/WA.

Adapter HTTP dapat diuji ulang dengan `node --test deliverables/voucher-hardening-2026-11-12/http-test.mjs`.
