-- Migration 097: Log/idempotency table for Google Sheets → orders sync prototype.
-- Setiap baris Sheet yang sudah pernah diimport dicatat di sini (sheet_id + row_hash
-- unik) supaya script sync aman di-run berkali-kali tanpa membuat order duplikat.

CREATE TABLE sheet_schedule_imports (
  id BIGSERIAL PRIMARY KEY,
  sheet_id TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  raw_row JSONB NOT NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'imported', -- imported | skipped | error
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sheet_id, row_hash)
);

ALTER TABLE sheet_schedule_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY sheet_imports_read ON sheet_schedule_imports
  FOR SELECT
  USING ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));

CREATE POLICY sheet_imports_write_service ON sheet_schedule_imports
  FOR ALL
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');
