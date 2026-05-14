-- Migration 027: Tambah FK constraint orders.parent_job_id → orders.id
-- Migration 026 DO block tidak menambahkan FK karena kolom parent_job_id sudah pre-exist
-- (dipakai untuk Complain→Repair flow). Tambah FK terpisah agar tidak ada orphan.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_parent_job_id_fkey'
      AND conrelid = 'orders'::regclass
  ) THEN
    -- NOT VALID supaya existing data tidak diblock; langsung VALIDATE setelahnya
    ALTER TABLE orders
      ADD CONSTRAINT orders_parent_job_id_fkey
      FOREIGN KEY (parent_job_id) REFERENCES orders(id) ON DELETE SET NULL
      NOT VALID;
    ALTER TABLE orders VALIDATE CONSTRAINT orders_parent_job_id_fkey;
  END IF;
END $$;
