-- Migration 038: Normalize phone numbers + sync customers from orders
-- Tujuan:
--   1. Normalisasi format phone di tabel customers dan orders → 628xxx
--   2. Upsert semua customer unik dari orders yang belum masuk ke tabel customers
--   3. Update total_orders + last_service untuk semua customer dari data orders
--   4. Isi customer_id di orders yang masih NULL (link ke customer yang sudah ada)

-- ─────────────────────────────────────────
-- HELPER: fungsi normalize phone (JS-compatible)
-- Format: strip non-digit → 08xxx→628xxx, 8xxx→628xxx, 62xxx→62xxx
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION normalize_phone_id(p TEXT) RETURNS TEXT AS $$
DECLARE
  d TEXT;
BEGIN
  IF p IS NULL OR trim(p) = '' THEN RETURN NULL; END IF;
  d := regexp_replace(p, '[^0-9]', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  IF d ~ '^08' THEN RETURN '62' || substring(d FROM 2); END IF;
  IF d ~ '^62' THEN RETURN d; END IF;
  IF d ~ '^8'  THEN RETURN '62' || d; END IF;
  RETURN d;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────
-- STEP 1: Normalize phone di tabel customers
-- Skip baris yang hasil normalisasinya NULL (phone berisi karakter non-digit saja)
-- ─────────────────────────────────────────
UPDATE customers
SET phone = normalize_phone_id(phone)
WHERE phone IS NOT NULL
  AND phone != ''
  AND normalize_phone_id(phone) IS NOT NULL
  AND length(normalize_phone_id(phone)) >= 5
  AND phone IS DISTINCT FROM normalize_phone_id(phone);

-- ─────────────────────────────────────────
-- STEP 2: Normalize phone di tabel orders
-- Skip baris yang hasil normalisasinya NULL (phone kosong / non-digit)
-- ─────────────────────────────────────────
UPDATE orders
SET phone = normalize_phone_id(phone)
WHERE phone IS NOT NULL
  AND phone != ''
  AND normalize_phone_id(phone) IS NOT NULL
  AND length(normalize_phone_id(phone)) >= 5
  AND phone IS DISTINCT FROM normalize_phone_id(phone);

-- ─────────────────────────────────────────
-- STEP 3: Insert customers yang belum ada — DENGAN ID EKSPLISIT
-- DEFAULT customers.id rusak (generate ID duplikat seperti CUST100).
-- Solusi: generate ID sendiri = 'CUST' || (max_num_existing + row_number).
-- Karena satu-satunya trigger di customers cuma updated_at (bukan id),
-- memberi id eksplisit aman & melewati DEFAULT yang rusak.
-- ─────────────────────────────────────────
WITH base AS (
  SELECT COALESCE(MAX(
    CASE WHEN id ~ '^CUST[0-9]+$'
         THEN CAST(substring(id FROM 5) AS BIGINT)
         ELSE 0 END
  ), 0) AS max_num
  FROM customers
),
new_custs AS (
  SELECT
    trim(o.customer)               AS cust_name,
    normalize_phone_id(o.phone)    AS norm_phone,
    MAX(COALESCE(o.address, ''))   AS address,
    COUNT(*)                       AS cnt,
    MIN(o.date)                    AS joined_date,
    MAX(o.date)                    AS last_service
  FROM orders o
  WHERE trim(o.customer) != ''
    AND normalize_phone_id(o.phone) IS NOT NULL
    AND length(normalize_phone_id(o.phone)) >= 5
    AND o.status NOT IN ('CANCELLED', 'DELETED')
  GROUP BY normalize_phone_id(o.phone), trim(o.customer)
)
INSERT INTO customers (id, name, phone, address, notes, is_vip, total_orders, joined_date, last_service)
SELECT
  'CUST' || (base.max_num + ROW_NUMBER() OVER (ORDER BY nc.norm_phone, nc.cust_name)),
  nc.cust_name,
  nc.norm_phone,
  nc.address,
  '',
  false,
  nc.cnt,
  nc.joined_date,
  nc.last_service
FROM new_custs nc
CROSS JOIN base
WHERE NOT EXISTS (
  SELECT 1 FROM customers c
  WHERE c.phone = nc.norm_phone
    AND c.name  = nc.cust_name
);

-- ─────────────────────────────────────────
-- STEP 4: Update total_orders + last_service + joined_date dari data orders aktual
-- Untuk semua customer (lama maupun baru dari step 3)
-- ─────────────────────────────────────────
WITH order_stats AS (
  SELECT
    normalize_phone_id(o.phone)  AS norm_phone,
    trim(o.customer)             AS cust_name,
    COUNT(*)                     AS cnt,
    MAX(o.date)                  AS latest_date,
    MIN(o.date)                  AS earliest_date
  FROM orders o
  WHERE trim(o.customer) != ''
    AND normalize_phone_id(o.phone) IS NOT NULL
    AND o.status NOT IN ('CANCELLED', 'DELETED')
  GROUP BY normalize_phone_id(o.phone), trim(o.customer)
)
UPDATE customers c
SET
  total_orders = s.cnt,
  last_service = s.latest_date,
  joined_date  = COALESCE(c.joined_date, s.earliest_date)
FROM order_stats s
WHERE c.phone = s.norm_phone
  AND c.name  = s.cust_name;

-- ─────────────────────────────────────────
-- STEP 5: Link orders.customer_id yang masih NULL
-- Match berdasarkan phone (normalized) + nama customer
-- ─────────────────────────────────────────
UPDATE orders o
SET customer_id = c.id
FROM customers c
WHERE o.customer_id IS NULL
  AND normalize_phone_id(o.phone) = c.phone
  AND trim(o.customer) = c.name
  AND normalize_phone_id(o.phone) IS NOT NULL
  AND trim(o.customer) != '';

-- ─────────────────────────────────────────
-- STEP 6: Fallback — link by phone saja kalau nama beda tapi customer tunggal di nomor itu
-- (untuk order lama sebelum multi-lokasi, yang cukup di-match by phone)
-- Hanya update kalau satu customer saja yang match phone tersebut (aman, tidak ambigu)
-- ─────────────────────────────────────────
UPDATE orders o
SET customer_id = c.id
FROM customers c
WHERE o.customer_id IS NULL
  AND normalize_phone_id(o.phone) = c.phone
  AND normalize_phone_id(o.phone) IS NOT NULL
  AND (
    SELECT COUNT(*) FROM customers c2 WHERE c2.phone = normalize_phone_id(o.phone)
  ) = 1;

-- ─────────────────────────────────────────
-- STEP 7: FIX ROOT CAUSE — sequence + DEFAULT customers.id
-- DEFAULT lama: 'CUST' || lpad(nextval('customers_seq')::text, 3, '0')
-- Bug: lpad(...,3) MEMOTONG string > 3 char. Saat sequence > 999,
--      nextval=1000 → lpad('1000',3,'0')='100' → 'CUST100' → bentrok ID lama.
--      Inilah penyebab auto-save customer baru selalu gagal PK conflict.
--
-- 7a: Reset sequence ke max ID saat ini (setelah STEP 3 insert 140 customer baru).
--     setval memaksa ke nilai benar baik sequence ketinggalan maupun kelewatan.
-- ─────────────────────────────────────────
SELECT setval('customers_seq', (
  SELECT COALESCE(MAX(
    CASE WHEN id ~ '^CUST[0-9]+$'
         THEN CAST(substring(id FROM 5) AS BIGINT)
         ELSE 0 END
  ), 1)
  FROM customers
));

-- 7b: Ganti DEFAULT — hapus lpad(...,3) yang truncate. ID baru: CUST557, CUST558, ...
--     (tanpa leading-zero; konsisten dengan ID existing ≥100 dan aman lewat 999)
ALTER TABLE customers
  ALTER COLUMN id SET DEFAULT 'CUST' || nextval('customers_seq'::regclass)::text;

-- ─────────────────────────────────────────
-- CLEANUP: hapus fungsi temporary
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS normalize_phone_id(TEXT);

-- ─────────────────────────────────────────
-- VERIFIKASI (jalankan manual setelah migration)
-- ─────────────────────────────────────────
-- 1. Total customer (harusnya ~454 + 140 = ~594)
-- SELECT COUNT(*) AS total_customers FROM customers;
--
-- 2. Order tanpa customer_id (harusnya turun drastis / mendekati 0)
-- SELECT COUNT(*) AS orders_without_customer_id FROM orders WHERE customer_id IS NULL AND phone IS NOT NULL AND phone != '';
--
-- 3. DEFAULT id sudah berubah (tidak ada lpad lagi)
-- SELECT column_default FROM information_schema.columns WHERE table_name='customers' AND column_name='id';
--
-- 4. Sequence sudah di atas max ID
-- SELECT last_value FROM customers_seq;
-- SELECT MAX(CASE WHEN id ~ '^CUST[0-9]+$' THEN CAST(substring(id FROM 5) AS BIGINT) ELSE 0 END) AS max_id FROM customers;
--
-- 5. TEST insert customer baru (pastikan tidak PK conflict) — lalu hapus row test-nya
-- INSERT INTO customers (name, phone) VALUES ('TEST MIGRASI 038', '628000000000') RETURNING id;
-- DELETE FROM customers WHERE phone = '628000000000';
