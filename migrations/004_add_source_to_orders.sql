-- Migration 004: Tambah kolom source ke tabel orders
-- Digunakan untuk membedakan asal order: whatsapp, website, atau null (legacy)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT DEFAULT NULL;
COMMENT ON COLUMN orders.source IS 'Origin of order: whatsapp, website, or null (legacy/manual via panel)';
