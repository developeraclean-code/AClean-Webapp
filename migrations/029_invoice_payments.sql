-- Tabel untuk riwayat multiple pembayaran per invoice
-- Mendukung DP1, DP2, Pelunasan, dll dengan tanggal & metode masing-masing

-- Drop tabel lama jika ada (partial create sebelumnya)
DROP TABLE IF EXISTS invoice_payments;

CREATE TABLE invoice_payments (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id       text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount           numeric NOT NULL CHECK (amount > 0),
  method           text DEFAULT 'transfer',  -- transfer | cash | qris | lainnya
  notes            text,
  paid_at          date NOT NULL DEFAULT CURRENT_DATE,
  recorded_by      text,
  recorded_by_name text,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX idx_invoice_payments_invoice_id ON invoice_payments(invoice_id);
CREATE INDEX idx_invoice_payments_paid_at    ON invoice_payments(paid_at DESC);

-- RLS: izinkan akses penuh (sama dengan pola tabel lain)
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full" ON invoice_payments FOR ALL USING (true) WITH CHECK (true);
