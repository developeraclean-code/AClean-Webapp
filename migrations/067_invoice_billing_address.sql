-- Migration 067: Tambah kolom billing address ke tabel invoices
-- Untuk mendukung "atas nama" invoice berbeda dari nama customer order
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS address TEXT;
