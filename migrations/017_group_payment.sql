-- Migration 017: Group Payment & Partial Payment Support
-- Fitur: 1 customer bisa punya multi-invoice, 1 pembayaran bisa cover beberapa invoice
-- Jalankan di Supabase SQL Editor.

-- 1. Extend tabel payments (sudah ada dari GAP 1.6)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_phone    text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_name     text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS total_amount      numeric;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_partial        boolean DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_ids       text[];
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_proof_url text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS allocation_detail jsonb;

-- 2. Junction table: 1 payment → banyak invoice
CREATE TABLE IF NOT EXISTS invoice_payments (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id  uuid,
  invoice_id  text NOT NULL,
  amount      numeric NOT NULL,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_full" ON invoice_payments;
CREATE POLICY "service_full" ON invoice_payments USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ip_payment ON invoice_payments(payment_id);
CREATE INDEX IF NOT EXISTS idx_ip_invoice  ON invoice_payments(invoice_id);

-- 3. Extend invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_amount       numeric DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remaining_amount  numeric;

-- Index untuk lookup pembayaran per customer
CREATE INDEX IF NOT EXISTS idx_payments_customer_phone ON payments(customer_phone);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_ids    ON payments USING GIN(invoice_ids);

-- 4. Status PARTIAL_PAID sudah dicoveri di statusColor/statusLabel di frontend
-- Tidak ada perubahan DB untuk status karena disimpan sebagai text
