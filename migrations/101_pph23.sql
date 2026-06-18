-- 101_pph23.sql — Dukungan PPh 23 (2,5%) gross-up untuk invoice.
-- AClean Non-PKP (tidak terbitkan PPN). Saat customer memotong PPh 23, nilai
-- di-grossup agar AClean tetap terima full price list:
--   DPP        = total_net / (1 - rate)         (rate default 0.025)
--   pph23_amount = DPP - total_net
--   total (yang dibayar ke AClean / receivable) TETAP = total_net (price list)
--
-- pph23        : apakah invoice ini kena potong PPh 23
-- pph23_amount : nominal PPh 23 yang dipotong customer (disetor ke negara)
-- Jalankan manual di Supabase SQL Editor.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pph23 boolean DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pph23_amount numeric DEFAULT 0;

-- Rate global (configurable di Settings). Disimpan di app_settings.
INSERT INTO app_settings (key, value)
VALUES ('pph23_rate', '0.025')
ON CONFLICT (key) DO NOTHING;
