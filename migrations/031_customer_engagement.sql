-- Phase 2 & 3: Customer feedback (rating) + voucher loyalty

-- ── Tabel rating / feedback pasca-servis ──
CREATE TABLE IF NOT EXISTS customer_feedback (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id    text NOT NULL,
  job_id      text,
  phone       text NOT NULL,
  customer    text,
  teknisi     text,
  rating      int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  service     text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_feedback_order  ON customer_feedback(order_id);
CREATE INDEX IF NOT EXISTS idx_customer_feedback_phone  ON customer_feedback(phone);
CREATE INDEX IF NOT EXISTS idx_customer_feedback_teknisi ON customer_feedback(teknisi);

ALTER TABLE customer_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full" ON customer_feedback FOR ALL USING (true) WITH CHECK (true);

-- ── Tabel voucher loyalty ──
CREATE TABLE IF NOT EXISTS customer_vouchers (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone            text NOT NULL,
  customer_name    text,
  code             text UNIQUE NOT NULL,
  type             text NOT NULL,   -- 'discount_pct' | 'free_unit' | 'free_service'
  value            numeric,         -- 10 = 10%, 1 = 1 unit gratis
  description      text,
  min_orders       int DEFAULT 0,
  expires_at       date,
  claimed_at       timestamptz,
  claimed_order_id text,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_vouchers_phone ON customer_vouchers(phone);
CREATE INDEX IF NOT EXISTS idx_customer_vouchers_code  ON customer_vouchers(code);

ALTER TABLE customer_vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full" ON customer_vouchers FOR ALL USING (true) WITH CHECK (true);

-- ── Kolom tracking di customers (jika belum ada) ──
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_orders int DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS avg_rating   numeric(3,2);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_rating_request date;
