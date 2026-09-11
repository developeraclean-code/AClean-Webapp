-- 164 — Baseline pembayaran komisi lama sampai 30 April 2026.
--
-- Keputusan Owner 11 Sep 2026:
-- seluruh komisi dengan tanggal order sampai April 2026 sudah dibayar manual.
-- Catat paid_at sebagai tanggal historis penutupan (bukan waktu migrasi), supaya
-- rekap komisi/payroll minggu berjalan tidak menganggapnya pembayaran baru.
--
-- Idempotent: hanya menyentuh PENDING/ELIGIBLE. PAID lama dan VOID tidak berubah.

BEGIN;

UPDATE order_bonuses
SET status     = 'PAID',
    paid_at    = TIMESTAMPTZ '2026-04-30 23:59:59+07',
    paid_by    = 'Manual — pelunasan s/d April 2026',
    updated_at = NOW()
WHERE order_date <= DATE '2026-04-30'
  AND status IN ('PENDING', 'ELIGIBLE');

COMMIT;

-- Verifikasi:
-- SELECT status, count(*)
-- FROM order_bonuses
-- WHERE order_date <= DATE '2026-04-30'
-- GROUP BY status
-- ORDER BY status;

-- Rollback terarah (hanya baseline dari migrasi ini):
-- UPDATE order_bonuses
-- SET status = 'ELIGIBLE', paid_at = NULL, paid_by = NULL, updated_at = NOW()
-- WHERE order_date <= DATE '2026-04-30'
--   AND status = 'PAID'
--   AND paid_by = 'Manual — pelunasan s/d April 2026'
--   AND paid_at = TIMESTAMPTZ '2026-04-30 23:59:59+07';
