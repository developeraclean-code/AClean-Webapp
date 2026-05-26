-- Migration 044: Cache untuk merged PDF multi-invoice
-- Konteks: 1 customer punya multiple invoice → 1 PDF gabungan untuk WA reminder.
-- generateMergedInvoicePDFBlob butuh 3-5 detik untuk 2-3 invoice (multiplicative).
-- Tujuan: Cache hasil merged sehingga repeat send instant.
--
-- Strategi: Cache key = hash dari sorted invoice_ids + max(updated_at) member invoices.
-- Setiap salah satu invoice di-update → cache key berbeda → cache miss → regenerate.
-- Plus: trigger eksplisit hapus row cache kalau ada invoice di-update (defensive cleanup).

-- 1. Tabel cache
CREATE TABLE IF NOT EXISTS merged_pdf_cache (
  id BIGSERIAL PRIMARY KEY,
  cache_key TEXT UNIQUE NOT NULL,        -- "merge:id1,id2,id3:2026-05-26T10:00:00Z:nopl"
  invoice_ids TEXT[] NOT NULL,           -- ["INV-001", "INV-002"] — untuk invalidation lookup
  pdf_url TEXT NOT NULL,                 -- R2 URL (via /api/foto?key=...)
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used TIMESTAMPTZ DEFAULT NOW()    -- untuk LRU cleanup job nanti
);

COMMENT ON TABLE merged_pdf_cache IS 'Cache untuk multi-invoice merged PDF (1 customer, beberapa invoice gabungan)';
COMMENT ON COLUMN merged_pdf_cache.cache_key IS 'Format: merge:{sorted_ids_csv}:{max_updated_at}:{variant}';
COMMENT ON COLUMN merged_pdf_cache.invoice_ids IS 'Array invoice IDs yg merged. Pakai GIN index untuk invalidation lookup';

-- 2. GIN index untuk array contains query (cari cache yang involve invoice X)
CREATE INDEX IF NOT EXISTS idx_merged_pdf_cache_invoice_ids
  ON merged_pdf_cache USING GIN (invoice_ids);

CREATE INDEX IF NOT EXISTS idx_merged_pdf_cache_generated_at
  ON merged_pdf_cache(generated_at DESC);

-- 3. Trigger: kalau invoice di-update, hapus semua merged cache yang involve invoice itu.
-- Dipanggil dari trigger BEFORE UPDATE di invoices (migrate 043 sudah ada trg_invoices_updated_at).
CREATE OR REPLACE FUNCTION invalidate_merged_pdf_cache()
RETURNS TRIGGER AS $$
BEGIN
  -- Hapus semua row di merged_pdf_cache yang invoice_ids contains NEW.id
  DELETE FROM merged_pdf_cache WHERE invoice_ids @> ARRAY[NEW.id::text];
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_invalidate_merged ON invoices;
CREATE TRIGGER trg_invoices_invalidate_merged
  AFTER UPDATE ON invoices
  FOR EACH ROW
  WHEN (OLD.updated_at IS DISTINCT FROM NEW.updated_at)
  EXECUTE FUNCTION invalidate_merged_pdf_cache();

-- 4. Trigger juga untuk DELETE invoice (kalau invoice dihapus, merged cache juga harus hilang)
CREATE OR REPLACE FUNCTION invalidate_merged_pdf_cache_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM merged_pdf_cache WHERE invoice_ids @> ARRAY[OLD.id::text];
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_invalidate_merged_delete ON invoices;
CREATE TRIGGER trg_invoices_invalidate_merged_delete
  BEFORE DELETE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION invalidate_merged_pdf_cache_on_delete();
