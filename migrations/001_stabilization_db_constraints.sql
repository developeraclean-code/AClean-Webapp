-- ═══════════════════════════════════════════════════════════════════════════════
-- STABILISASI #1: DB CONSTRAINTS & INTEGRITY
-- File     : migrations/001_stabilization_db_constraints.sql
-- Tanggal  : 2026-04-14
-- Tujuan   : Pindahkan invariant dari frontend ke DB:
--            • UNIQUE service_reports.job_id   (fix root cause double report)
--            • FK invoices.job_id → orders.id
--            • FK service_reports.job_id → orders.id
--            • CHECK enum orders.status, invoices.status
--            • Numeric guard: invoices.total >= 0, expenses.amount > 0
--
-- CARA PAKAI:
--   1. Supabase Dashboard → SQL Editor
--   2. JALANKAN SECTION 1 DULU (AUDIT). Review output.
--      → Kalau semua count = 0, skip Section 2 (cleanup) lanjut Section 3 (apply).
--      → Kalau ada ghost rows / orphan, jalankan Section 2 dulu.
--   3. JALANKAN SECTION 3 (APPLY). Jangan jalankan sebelum audit bersih.
--   4. JALANKAN SECTION 4 (VERIFY) untuk konfirmasi constraint terpasang.
--
-- ROLLBACK:
--   Jalankan Section 5 (di bawah, comment-out default).
-- ═══════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — AUDIT (READ-ONLY, AMAN DIJALANKAN KAPAN SAJA)
-- Output tiap query = jumlah row yang akan diblokir kalau constraint dipasang.
-- Target: semua = 0. Kalau tidak 0, lanjut Section 2 untuk resolve.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1.1  Ghost rows: service_reports dengan job_id duplikat
SELECT 'audit_1.1_duplicate_service_reports' AS check_name,
       COUNT(*) AS total_duplicate_rows,
       COUNT(DISTINCT job_id) AS unique_job_ids_affected
FROM service_reports
WHERE job_id IN (
  SELECT job_id FROM service_reports
  WHERE job_id IS NOT NULL
  GROUP BY job_id
  HAVING COUNT(*) > 1
);

-- 1.2  Detail ghost rows (buat review manual sebelum cleanup)
SELECT 'audit_1.2_duplicate_detail' AS check_name,
       job_id, id, submitted_at, status
FROM service_reports
WHERE job_id IN (
  SELECT job_id FROM service_reports
  WHERE job_id IS NOT NULL
  GROUP BY job_id
  HAVING COUNT(*) > 1
)
ORDER BY job_id, submitted_at DESC NULLS LAST
LIMIT 50;

-- 1.3  Orphan invoices (job_id tidak ada di orders)
SELECT 'audit_1.3_orphan_invoices' AS check_name,
       COUNT(*) AS total
FROM invoices i
WHERE i.job_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = i.job_id);

-- 1.4  Orphan service_reports (job_id tidak ada di orders)
SELECT 'audit_1.4_orphan_service_reports' AS check_name,
       COUNT(*) AS total
FROM service_reports sr
WHERE sr.job_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = sr.job_id);

-- 1.5  Invalid order status values
SELECT 'audit_1.5_invalid_order_status' AS check_name,
       status AS bad_status, COUNT(*) AS total
FROM orders
WHERE status IS NOT NULL
  AND status NOT IN ('PENDING','CONFIRMED','DISPATCHED','ON_SITE','IN_PROGRESS',
                     'REPORT_SUBMITTED','COMPLETED','CANCELLED','PAID','INVOICE_APPROVED')
GROUP BY status;

-- 1.6  Invalid invoice status values
SELECT 'audit_1.6_invalid_invoice_status' AS check_name,
       status AS bad_status, COUNT(*) AS total
FROM invoices
WHERE status IS NOT NULL
  AND status NOT IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT',
                     'UNPAID','PAID','OVERDUE','CANCELLED')
GROUP BY status;

-- 1.6b Invalid service_reports status values
SELECT 'audit_1.6b_invalid_report_status' AS check_name,
       status AS bad_status, COUNT(*) AS total
FROM service_reports
WHERE status IS NOT NULL
  AND status NOT IN ('PENDING','SUBMITTED','VERIFIED','REVISION','REJECTED')
GROUP BY status;

-- 1.7  Negative invoice totals
SELECT 'audit_1.7_negative_invoice_total' AS check_name,
       COUNT(*) AS total
FROM invoices
WHERE total < 0 OR labor < 0 OR material < 0 OR dadakan < 0;

-- 1.8  Zero/negative expense amount
SELECT 'audit_1.8_invalid_expense_amount' AS check_name,
       COUNT(*) AS total
FROM expenses
WHERE amount IS NULL OR amount <= 0;

-- 1.9  Cek apakah constraint sudah pernah dipasang (idempotency guard)
SELECT 'audit_1.9_existing_constraints' AS check_name,
       conname AS constraint_name, contype AS type, conrelid::regclass AS table_name
FROM pg_constraint
WHERE conname IN (
  'uniq_service_reports_job_id',
  'fk_invoices_job',
  'fk_service_reports_job',
  'chk_orders_status',
  'chk_invoices_status',
  'chk_service_reports_status',
  'chk_invoices_total_nonneg',
  'chk_expenses_amount_positive'
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — CLEANUP (DESTRUCTIVE — BACKUP DULU!)
-- Jalankan HANYA kalau audit 1.1-1.8 menunjukkan ada masalah.
-- Setiap statement wrapped dalam transaction agar bisa rollback.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 2.1  Bersihkan duplicate service_reports — keep yang paling baru per job_id
--      Strategi: ROW_NUMBER() by submitted_at DESC, hapus selain yang teratas.
--      Backup dulu ke tabel arsip sebelum delete.
BEGIN;

CREATE TABLE IF NOT EXISTS _archive_service_reports_deduped_20260414 AS
SELECT *, NOW() AS archived_at
FROM service_reports WHERE 1=0;

WITH ranked AS (
  SELECT id, job_id,
         ROW_NUMBER() OVER (PARTITION BY job_id
                            ORDER BY submitted_at DESC NULLS LAST, id DESC) AS rn
  FROM service_reports
  WHERE job_id IS NOT NULL
),
to_archive AS (
  SELECT sr.* FROM service_reports sr
  JOIN ranked r ON r.id = sr.id
  WHERE r.rn > 1
)
INSERT INTO _archive_service_reports_deduped_20260414
SELECT *, NOW() FROM to_archive;

DELETE FROM service_reports
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY job_id
                              ORDER BY submitted_at DESC NULLS LAST, id DESC) AS rn
    FROM service_reports
    WHERE job_id IS NOT NULL
  ) x WHERE rn > 1
);

-- Verifikasi di dalam transaction sebelum commit
SELECT 'cleanup_2.1_result' AS step,
       (SELECT COUNT(*) FROM _archive_service_reports_deduped_20260414) AS archived,
       (SELECT COUNT(*) FROM service_reports sr
        WHERE sr.job_id IN (SELECT job_id FROM service_reports
                            WHERE job_id IS NOT NULL
                            GROUP BY job_id HAVING COUNT(*) > 1)) AS still_duplicate;

-- Kalau archived > 0 DAN still_duplicate = 0 → COMMIT. Kalau ragu → ROLLBACK.
COMMIT;
-- ROLLBACK;

-- 2.2  Orphan invoices — set job_id = NULL (tidak delete, jaga data keuangan)
BEGIN;
UPDATE invoices SET job_id = NULL
WHERE job_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = invoices.job_id);
COMMIT;

-- 2.3  Orphan service_reports — set job_id = NULL juga
BEGIN;
UPDATE service_reports SET job_id = NULL
WHERE job_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = service_reports.job_id);
COMMIT;

-- 2.4  Normalisasi status aneh. HANYA jalankan kalau audit 1.5/1.6 menampilkan value spesifik.
--      CONTOH (sesuaikan dengan hasil audit):
-- BEGIN;
-- UPDATE orders SET status = 'COMPLETED' WHERE status = 'Done';
-- COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — APPLY CONSTRAINTS (hanya setelah audit bersih!)
-- Semua pakai IF NOT EXISTS / guard — aman dijalankan berulang.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 3.1  UNIQUE job_id di service_reports
--      1 job = 1 laporan. Enforce di DB agar frontend bug tidak bikin double lagi.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_service_reports_job_id
  ON service_reports(job_id)
  WHERE job_id IS NOT NULL;

-- 3.2  FK invoices.job_id → orders.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_job'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT fk_invoices_job
      FOREIGN KEY (job_id) REFERENCES orders(id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

-- 3.3  FK service_reports.job_id → orders.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_service_reports_job'
  ) THEN
    ALTER TABLE service_reports
      ADD CONSTRAINT fk_service_reports_job
      FOREIGN KEY (job_id) REFERENCES orders(id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

-- 3.4  CHECK enum orders.status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_status'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT chk_orders_status
      CHECK (status IS NULL OR status IN (
        'PENDING','CONFIRMED','DISPATCHED','ON_SITE','IN_PROGRESS',
        'REPORT_SUBMITTED','COMPLETED','CANCELLED','PAID','INVOICE_APPROVED'
      )) NOT VALID;
    -- NOT VALID = tidak scan row lama. Validate manual nanti kalau yakin:
    -- ALTER TABLE orders VALIDATE CONSTRAINT chk_orders_status;
  END IF;
END $$;

-- 3.5  CHECK enum invoices.status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoices_status'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT chk_invoices_status
      CHECK (status IS NULL OR status IN (
        'DRAFT','PENDING_APPROVAL','APPROVED','SENT',
        'UNPAID','PAID','OVERDUE','CANCELLED'
      )) NOT VALID;
  END IF;
END $$;

-- 3.5b CHECK enum service_reports.status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_service_reports_status'
  ) THEN
    ALTER TABLE service_reports
      ADD CONSTRAINT chk_service_reports_status
      CHECK (status IS NULL OR status IN (
        'PENDING','SUBMITTED','VERIFIED','REVISION','REJECTED'
      )) NOT VALID;
  END IF;
END $$;

-- 3.6  Numeric guard invoices (total/komponen non-negatif)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoices_total_nonneg'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT chk_invoices_total_nonneg
      CHECK (
        (total IS NULL OR total >= 0) AND
        (labor IS NULL OR labor >= 0) AND
        (material IS NULL OR material >= 0) AND
        (dadakan IS NULL OR dadakan >= 0)
      ) NOT VALID;
  END IF;
END $$;

-- 3.7  Numeric guard expenses (amount > 0)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_expenses_amount_positive'
  ) THEN
    ALTER TABLE expenses
      ADD CONSTRAINT chk_expenses_amount_positive
      CHECK (amount IS NULL OR amount > 0) NOT VALID;
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — VERIFY (konfirmasi semua constraint aktif)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT conname AS constraint_name,
       CASE contype
         WHEN 'c' THEN 'CHECK'
         WHEN 'f' THEN 'FOREIGN KEY'
         WHEN 'u' THEN 'UNIQUE'
         WHEN 'p' THEN 'PRIMARY KEY'
         ELSE contype::text
       END AS type,
       conrelid::regclass AS table_name,
       convalidated AS is_validated
FROM pg_constraint
WHERE conname IN (
  'fk_invoices_job',
  'fk_service_reports_job',
  'chk_orders_status',
  'chk_invoices_status',
  'chk_service_reports_status',
  'chk_invoices_total_nonneg',
  'chk_expenses_amount_positive'
)
UNION ALL
SELECT indexname AS constraint_name, 'UNIQUE INDEX' AS type,
       tablename::regclass AS table_name, true AS is_validated
FROM pg_indexes
WHERE indexname = 'uniq_service_reports_job_id'
ORDER BY table_name, constraint_name;

-- Expected: 7 rows (6 constraint + 1 unique index).


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — ROLLBACK (UNCOMMENT KALAU PERLU REVERT)
-- ═══════════════════════════════════════════════════════════════════════════════
-- ALTER TABLE invoices         DROP CONSTRAINT IF EXISTS fk_invoices_job;
-- ALTER TABLE service_reports  DROP CONSTRAINT IF EXISTS fk_service_reports_job;
-- ALTER TABLE orders           DROP CONSTRAINT IF EXISTS chk_orders_status;
-- ALTER TABLE invoices         DROP CONSTRAINT IF EXISTS chk_invoices_status;
-- ALTER TABLE service_reports  DROP CONSTRAINT IF EXISTS chk_service_reports_status;
-- ALTER TABLE invoices         DROP CONSTRAINT IF EXISTS chk_invoices_total_nonneg;
-- ALTER TABLE expenses         DROP CONSTRAINT IF EXISTS chk_expenses_amount_positive;
-- DROP INDEX IF EXISTS uniq_service_reports_job_id;
-- -- Data archive tetap dipertahankan (table _archive_service_reports_deduped_20260414).
