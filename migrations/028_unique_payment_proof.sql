-- Migration 028: Unique index untuk payment proof per invoice
-- Cegah upload bukti bayar duplikat (customer kirim 2x via WA)

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_proof
  ON payments(invoice_id, payment_proof_url)
  WHERE payment_proof_url IS NOT NULL;
