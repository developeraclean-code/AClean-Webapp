-- Migration 162: arsipkan sesi material yang sudah tuntas — garis mulai uji coba admin-only.
--
-- Keputusan Owner 1 Sep 2026. Stok sudah dicocokkan dengan kondisi fisik, dan minggu ini
-- seluruh input dipegang admin. Tab "Selesai" (56 sesi) dan "Ditolak" (53 sesi) dikosongkan
-- supaya percobaan berangkat dari layar bersih.
--
-- DIARSIPKAN, BUKAN DIHAPUS. Alasannya konkret: 37 sesi CONFIRMED memegang deduct_tx_ids,
-- satu-satunya penghubung antara potongan stok dan asalnya. Justru berkat tautan itu 5 m
-- milik PT FORTA LARESE BOGOR bisa dilacak minggu ini. Menghapus barisnya tidak mengubah
-- stok, tapi memutus jejak "potongan ini dari sesi siapa, tanggal berapa" selamanya.
--
-- Owner memilih sesi lama TETAP bisa di-Buka Koreksi, jadi UI menyediakan tombol
-- "Tampilkan arsip" — arsip di sini berarti disembunyikan dari pandangan harian,
-- bukan dikunci.
--
-- Sesi PENDING sengaja TIDAK disentuh (21 baris, semuanya sesi pagi). Sesi pagi memang
-- selamanya PENDING karena yang dikonfirmasi adalah sesi pulang-nya; mengarsipkannya akan
-- membuat sesi Selesai kehilangan acuan "dibawa berapa".
--
-- Tidak menyentuh stok, qty, tautan job, maupun inventory_transactions.
-- Idempotent: hanya mengisi baris yang archived_at-nya masih NULL.

BEGIN;

ALTER TABLE teknisi_material_checkout
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by text;

COMMENT ON COLUMN teknisi_material_checkout.archived_at IS
  'Disembunyikan dari tab harian Konfirmasi Material. NULL = tampil seperti biasa. Bukan penghapusan dan bukan penguncian — sesi terarsip tetap bisa dibuka lewat tombol "Tampilkan arsip".';

CREATE INDEX IF NOT EXISTS idx_tmc_archived_at
  ON teknisi_material_checkout (archived_at) WHERE archived_at IS NULL;

UPDATE teknisi_material_checkout
SET archived_at = now(),
    archived_by = 'Garis mulai uji coba admin-only 1 Sep 2026'
WHERE archived_at IS NULL
  AND confirm_status IN ('CONFIRMED', 'REJECTED');

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- SELECT confirm_status, count(*) FILTER (WHERE archived_at IS NULL) AS tampil,
--        count(*) FILTER (WHERE archived_at IS NOT NULL) AS terarsip
--   FROM teknisi_material_checkout GROUP BY 1 ORDER BY 1;
-- Harapan: PENDING semua tampil; CONFIRMED & REJECTED semua terarsip.

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- UPDATE teknisi_material_checkout SET archived_at = NULL, archived_by = NULL
--  WHERE archived_by = 'Garis mulai uji coba admin-only 1 Sep 2026';
