-- 149 — Garis mulai metode material baru: semua yang tertunggak s/d 25 Agu 2026 ditutup.
--
-- KEPUTUSAN OWNER (25 Agu 2026)
-- "anggap semua job per 25 Agustus sudah clear dan terinput, biar kita mulai baru
--  dengan metode baru setelah commit dan push, sehingga tidak ada kerancuan."
--
-- Metode baru yang mulai berlaku 26 Agu 2026:
--   - semua pintu masuk bermuara ke SESI MATERIAL HARIAN
--   - pemotongan stok HANYA lewat Konfirmasi Material, dan qty terpakai wajib
--     dibagi ke job (satu transaksi stok per job, bukan satu untuk sehari)
--   - sesi yang sudah dikonfirmasi bisa dibuka lagi untuk koreksi (stok dibalik)
--   - admin bisa membuat sesi mewakili teknisi yang lupa mengisi
--
-- TIDAK ADA STOK YANG BERUBAH DI MIGRASI INI. Semua hanya penutupan antrean.
--
-- 1. 766 foto material menunggu di antrean Pending AI Material — sebagian besar
--    dari pekerjaan yang sudah lama selesai dan sudah ditagih. Ditutup dengan
--    status tersendiri ('closed_baseline'), BUKAN 'rejected', supaya jelas ini
--    keputusan garis mulai dan bukan penolakan satu per satu.
-- 2. 2 baris "material dibawa" yang masih menggantung ditandai dikembalikan.
--    Tabel ini memang tidak pernah memotong stok, jadi ini murni kerapian —
--    sekaligus mencegah cron auto-return menandainya "lupa dilaporkan" besok.
-- 3. Sesi pagi/pulang/pakai: tidak ada yang menunggu konfirmasi (sudah diperiksa,
--    0 baris), jadi tidak ada yang perlu ditutup.
--
-- CATATAN untuk rekam jejak: 16 dari 38 sesi yang sudah memotong stok tercatat
-- TANPA job sama sekali (temuan audit 25 Agu). Sengaja TIDAK diutak-atik di sini —
-- datanya memang tidak pernah ada. Kalau nanti ingin dirapikan, jalurnya lewat
-- tombol "Buka Koreksi" di Konfirmasi Material, satu per satu dan sadar.

BEGIN;

UPDATE ai_extractions
   SET status = 'closed_baseline',
       notes  = coalesce(notes, '') || ' [baseline 26 Agu 2026: antrean lama ditutup, mulai metode baru]'
 WHERE intent = 'material'
   AND status = 'pending'
   AND created_at < '2026-08-26';

UPDATE job_materials_brought
   SET status = 'RETURNED',
       updated_at = now(),
       notes = coalesce(notes, '') || ' | baseline 26 Agu 2026: ditutup sebelum metode baru'
 WHERE status = 'BROUGHT'
   AND brought_at < '2026-08-26';

COMMIT;
