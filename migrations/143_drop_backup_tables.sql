-- Migration 143: Hapus 3 tabel backup lama (hasil audit keamanan 22-23 Agu 2026).
--
-- Keputusan Owner 23 Agu 2026. Ketiganya tidak berbahaya (RLS aktif tanpa policy →
-- tak bisa diakses aplikasi maupun API), jadi ini murni kerapian. Isi masing-masing
-- DICATAT DI SINI sebelum dibuang supaya rekam jejaknya tetap ada di git.
--
-- ═══ 1. _archive_service_reports_deduped_20260414 (12 baris) — DUPLIKAT ═══
-- Laporan kembar yang dibuang saat dedup 14 Apr 2026. Terverifikasi: 0 dari 12 id
-- masih ada di service_reports (memang dihapus), TAPI 12 dari 12 job_id-nya tetap
-- punya laporan hidup. Jadi tiap job tetap ada laporannya — ini hanya salinan kembar.
--
-- ═══ 2. _customer_merge_backup_20260612 (60 baris) — DUPLIKAT ═══
-- Snapshot customer sebelum penggabungan 12 Jun 2026. Terverifikasi: 29 baris
-- customer-nya masih hidup dgn id sama; 31 sisanya sudah digabung dan SEMUANYA punya
-- penerus yang hidup. Tiga yang sempat terlihat "hilang" ternyata hanya berpindah:
--   CUST168 IBU MARLYNA INTAN      → CUST182 KOST KANAYA (IBU MARLINA), nomor sama
--   CUST640 BAPAK INDRA JELITA     → CUST186, nomor berganti ke 6281311333397
--   CUST454 PT. ONE 3 JAYA INDONESIA → CUST107, nomor 628567976881, 5 order aktif
--
-- ═══ 3. _miss_link_delete_backup_20260615 (3 baris) — BUKAN duplikat ═══
-- Satu-satunya salinan sebuah pekerjaan yang dihapus 15 Jun 2026:
--   Customer : IBU NELLY CHALCEDONY (Pondok Hijau Golf, Summarecon Gading)
--   Tanggal  : 2 April 2026 · teknisi Aji, helper Yusuf
--   Order    : JOB769527242           — Cleaning AC Split 0.5-1PK, PAID
--   Laporan  : LPR_JOB769527242_3AHL  — VERIFIED
--   Invoice  : INV-20260402-CHMEZ     — Rp 170.000, PAID
-- Sebab dihapus dulu: kolom phone berisi "769527242" — bukan nomor telepon, melainkan
-- angka yang sama dengan nomor job JOB769527242, sehingga order tak bisa tertaut ke
-- customer mana pun ("miss link").
-- Konsekuensi yang SUDAH disampaikan ke Owner sebelum penghapusan: omset April 2026
-- tercatat kurang Rp 170.000 dari yang benar-benar diterima, dan job itu tidak masuk
-- statistik Aji & Yusuf. Owner memutuskan tetap dihapus — customer sudah tidak servis lagi.
--
-- PELAJARAN: kalau ketemu order yang kolom phone-nya identik dengan nomor job-nya
-- sendiri, itu bug pengisian field — PERBAIKI nomornya, jangan hapus ordernya, supaya
-- transaksi lunas tidak hilang dari pembukuan.
--
-- Idempotent: IF EXISTS.

DROP TABLE IF EXISTS public._archive_service_reports_deduped_20260414;
DROP TABLE IF EXISTS public._customer_merge_backup_20260612;
DROP TABLE IF EXISTS public._miss_link_delete_backup_20260615;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--  WHERE n.nspname='public' AND c.relkind='r' AND relname LIKE '\_%';   -- harus 0

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- Tidak ada. Isi ketiganya hilang permanen; pemulihan hanya lewat backup DB
-- (Supabase PITR / backup mingguan R2) sebelum 23 Agu 2026.
