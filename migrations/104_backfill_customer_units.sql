-- Migration 104: backfill total_units_serviced + membership_tier (SUDAH DI-APPLY via MCP)
-- Konteks: bug updateCustomerTierAfterOrder (App.jsx) dulu mencocokkan customer by PHONE saja.
-- Untuk customer multi-lokasi (1 HP banyak record), counter unit nempel ke record PERTAMA,
-- bukan ke lokasi yang benar → muncul "member progress unit" di record yang riwayatnya kosong,
-- sementara record yang punya order tidak dapat unit. Kode sudah diperbaiki (match customer_id
-- lalu nama+phone). Backfill ini menghitung ulang counter dari order asli per customer.
--
-- Matching unit per customer (selaras buildCustomerHistory):
--   order milik customer c jika: o.customer_id = c.id (link permanen),
--   ATAU (o.customer_id IS NULL DAN nama order = nama customer)  [legacy].
-- Hanya service Cleaning/Install, jumlah = SUM(units). Tier: >=50 platinum, >=30 gold, else silver.

WITH correct AS (
  SELECT c.id,
    COALESCE((
      SELECT SUM(COALESCE(o.units,1)) FROM orders o
      WHERE o.service IN ('Cleaning','Install')
        AND ( o.customer_id = c.id
              OR (o.customer_id IS NULL AND lower(trim(o.customer)) = lower(trim(c.name))) )
    ),0)::int AS new_units
  FROM customers c
)
UPDATE customers c
SET total_units_serviced = correct.new_units,
    membership_tier = CASE WHEN correct.new_units >= 50 THEN 'platinum'
                           WHEN correct.new_units >= 30 THEN 'gold'
                           ELSE 'silver' END
FROM correct
WHERE c.id = correct.id
  AND ( c.total_units_serviced IS DISTINCT FROM correct.new_units
        OR COALESCE(c.membership_tier,'silver') IS DISTINCT FROM
           CASE WHEN correct.new_units >= 50 THEN 'platinum'
                WHEN correct.new_units >= 30 THEN 'gold'
                ELSE 'silver' END );
