-- Migration 013: Add UNIQUE constraint on invoices.job_id to prevent duplicate invoices
-- Cleanup duplicate invoices first (keep the one with highest total or latest created_at)
DELETE FROM invoices
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY job_id
             ORDER BY
               CASE WHEN status = 'PAID' THEN 0 ELSE 1 END,
               total DESC,
               created_at DESC
           ) AS rn
    FROM invoices
    WHERE job_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Add UNIQUE constraint
ALTER TABLE invoices
  ADD CONSTRAINT invoices_job_id_unique UNIQUE (job_id);
