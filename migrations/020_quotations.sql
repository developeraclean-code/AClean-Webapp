-- Migration 020: Tabel quotations
-- Quotation → bisa jadi invoice saat approved
-- items disimpan sebagai jsonb (karena masih bisa diedit bebas sebelum approved)

CREATE TABLE IF NOT EXISTS quotations (
  id                text PRIMARY KEY,           -- QUO-xxxxxxxx
  customer          text NOT NULL,
  phone             text,
  address           text,
  area              text,

  status            text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status = ANY (ARRAY[
                      'DRAFT'::text,
                      'SENT'::text,
                      'APPROVED'::text,
                      'EXPIRED'::text,
                      'CANCELLED'::text
                    ])),

  -- Items sebagai jsonb — array of { item_type, description, qty, unit_price, subtotal }
  -- item_type: "unit_ac" | "paket" | "jasa" | "addon"
  items             jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Breakdown amount
  total             numeric NOT NULL DEFAULT 0,
  unit_ac_amount    numeric NOT NULL DEFAULT 0,   -- passthrough, tidak masuk omset
  labor             numeric NOT NULL DEFAULT 0,   -- paket + jasa
  material          numeric NOT NULL DEFAULT 0,   -- addon
  discount          numeric NOT NULL DEFAULT 0,
  trade_in_amount   numeric NOT NULL DEFAULT 0,

  -- Validity
  valid_until       date,                         -- created_at::date + 15 hari

  -- Linked records (terisi saat APPROVED)
  invoice_id        text REFERENCES invoices(id) ON DELETE SET NULL,
  job_id            text,                         -- orders.id

  -- Metadata
  notes             text,
  created_by        text,                         -- user_profiles.id
  created_by_name   text,
  updated_at        timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now()
);

-- Index untuk lookup cepat
CREATE INDEX IF NOT EXISTS idx_quotations_status     ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_quotations_phone      ON quotations(phone);
CREATE INDEX IF NOT EXISTS idx_quotations_created_at ON quotations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_invoice_id ON quotations(invoice_id);

-- RLS
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_full" ON quotations;
CREATE POLICY "service_full" ON quotations USING (true) WITH CHECK (true);

-- Tambah kolom quotation_id ke invoices untuk referensi balik
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quotation_id text REFERENCES quotations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_quotation_id ON invoices(quotation_id);
