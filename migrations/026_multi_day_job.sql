-- Migration 026: Multi-day job support
-- Order induk: is_multi_day = true, parent_job_id = null
-- Order lanjutan: is_multi_day = true, parent_job_id = <id order induk>
-- parent_job_id sudah ada di kolom fetch tapi belum ada sebagai kolom DB yang dikonfirmasi

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_multi_day boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS day_number integer DEFAULT 1;

-- parent_job_id mungkin sudah ada dari penggunaan di complain→repair flow
-- Tambah FK jika belum ada
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'parent_job_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN parent_job_id text REFERENCES orders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index untuk query child orders dari parent
CREATE INDEX IF NOT EXISTS idx_orders_parent_job_id ON orders(parent_job_id) WHERE parent_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_is_multi_day ON orders(is_multi_day) WHERE is_multi_day = true;

COMMENT ON COLUMN orders.is_multi_day IS 'true jika order ini adalah bagian dari pekerjaan multi-hari';
COMMENT ON COLUMN orders.day_number IS 'Urutan hari: 1=hari pertama, 2=hari kedua, dst';
COMMENT ON COLUMN orders.parent_job_id IS 'ID order induk (hari pertama). Null untuk order induk.';
