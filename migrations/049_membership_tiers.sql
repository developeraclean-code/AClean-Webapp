-- Migration 049: Customer Membership Tier (Silver / Gold / Platinum)
-- Tier dihitung dari akumulasi unit AC (Cleaning + Install, status COMPLETED/INVOICE_APPROVED/PAID)
-- Silver: 0-29 unit (no benefit)
-- Gold:   30-49 unit (diskon jasa 5%)
-- Platinum: 50+ unit (diskon jasa 5% + material 5%)

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS total_units_serviced INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS membership_tier TEXT DEFAULT 'silver'
    CHECK (membership_tier IN ('silver', 'gold', 'platinum'));

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS member_discount INT DEFAULT 0;

COMMENT ON COLUMN customers.total_units_serviced IS
  'Akumulasi unit AC dari order Cleaning + Install yang sudah COMPLETED/INVOICE_APPROVED/PAID.';
COMMENT ON COLUMN customers.membership_tier IS
  'silver (0-29 unit), gold (30-49 unit), platinum (50+ unit).';
COMMENT ON COLUMN invoices.member_discount IS
  'Besaran diskon dari membership tier (terpisah dari diskon manual/voucher), untuk audit trail.';

-- Backfill total_units_serviced dari orders yang sudah ada
UPDATE customers c
SET total_units_serviced = COALESCE((
  SELECT SUM(COALESCE(o.units, 1))
  FROM orders o
  WHERE o.customer_id = c.id
    AND o.service IN ('Cleaning', 'Install')
    AND o.status IN ('COMPLETED', 'INVOICE_APPROVED', 'PAID')
), 0);

-- Set tier berdasarkan total_units_serviced hasil backfill
UPDATE customers
SET membership_tier = CASE
  WHEN total_units_serviced >= 50 THEN 'platinum'
  WHEN total_units_serviced >= 30 THEN 'gold'
  ELSE 'silver'
END;
