-- Tambah kolom repair_gratis ke tabel invoices
-- NULL = berbayar, 'gratis-garansi' = gratis karena garansi aktif, 'gratis-customer' = arrangement customer
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS repair_gratis TEXT DEFAULT NULL;
COMMENT ON COLUMN invoices.repair_gratis IS 'NULL = berbayar, gratis-garansi = gratis karena garansi aktif, gratis-customer = arrangement customer';
