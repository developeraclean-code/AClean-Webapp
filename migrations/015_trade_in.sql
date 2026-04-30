-- Migration 015: Trade-In AC Lama + aktifkan discount di invoices
-- Jalankan di Supabase SQL Editor

-- 1. Tambah kolom trade_in (flag boolean)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS trade_in BOOLEAN DEFAULT FALSE;

-- 2. Tambah kolom trade_in_amount (nilai potongan, default 250000)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS trade_in_amount INTEGER DEFAULT 0;

-- 3. Pastikan kolom discount sudah ada (seharusnya sudah, tapi jaga-jaga)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount INTEGER DEFAULT 0;

-- Verifikasi
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'invoices'
  AND column_name IN ('discount', 'trade_in', 'trade_in_amount')
ORDER BY column_name;
