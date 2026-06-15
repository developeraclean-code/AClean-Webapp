-- Hapus duplikat order project yang ada (keep row dengan id terkecil per project+date)
DELETE FROM orders
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY project_id, date ORDER BY created_at ASC) AS rn
    FROM orders
    WHERE project_id IS NOT NULL
      AND status != 'CANCELLED'
  ) ranked
  WHERE rn > 1
);

-- Unique partial index: max 1 order aktif per project per hari
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_project_date
  ON orders (project_id, date)
  WHERE project_id IS NOT NULL AND status != 'CANCELLED';
