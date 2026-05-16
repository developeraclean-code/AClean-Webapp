-- Migration 032: Voucher Loyalty Improvements
-- Tambah kolom tracking di customer_vouchers dan customers
-- untuk mendukung redemption flow, win-back, dan expiry reminder

ALTER TABLE customer_vouchers ADD COLUMN IF NOT EXISTS trigger text DEFAULT 'milestone';
ALTER TABLE customer_vouchers ADD COLUMN IF NOT EXISTS milestone_at int;
ALTER TABLE customer_vouchers ADD COLUMN IF NOT EXISTS is_valid boolean DEFAULT true;
ALTER TABLE customer_vouchers ADD COLUMN IF NOT EXISTS reminder_sent boolean DEFAULT false;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_winback_sent date;

-- Index untuk query expiry reminder (cron harian)
CREATE INDEX IF NOT EXISTS idx_vouchers_expiry ON customer_vouchers(expires_at) WHERE claimed_at IS NULL AND is_valid = true;

-- Index untuk win-back (cari customer inactive)
CREATE INDEX IF NOT EXISTS idx_customers_last_service ON customers(last_service);
