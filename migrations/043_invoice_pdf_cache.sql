-- Migration 043: Cache PDF URL untuk invoice
-- Tujuan: Avoid regenerate PDF setiap akses (3-5 detik @react-pdf/renderer)
-- Pattern: Generate sekali → upload R2 → simpan URL → reuse di akses berikutnya
-- Invalidation: Set pdf_url=NULL saat invoice diedit (handled di src/data/writes.js)

-- 1. Kolom cache PDF
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN invoices.pdf_url IS 'Cached PDF URL di R2 (proxy: /api/foto?key=...). NULL = perlu regenerate';
COMMENT ON COLUMN invoices.pdf_generated_at IS 'Timestamp kapan PDF di-cache. Untuk debugging & TTL future';
COMMENT ON COLUMN invoices.updated_at IS 'Auto-update via trigger. Dipakai sbg version key memory cache PDF di frontend';

-- 2. Backfill updated_at untuk row existing (pakai created_at sebagai baseline)
UPDATE invoices SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL;

-- 3. Trigger untuk auto-update updated_at setiap UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- 4. Index untuk filter invoices yg sudah ada PDF (untuk monitoring)
CREATE INDEX IF NOT EXISTS idx_invoices_pdf_cached
  ON invoices(pdf_generated_at)
  WHERE pdf_url IS NOT NULL;
