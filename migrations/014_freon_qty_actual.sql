-- Migration 014: Add qty_actual column to inventory_transactions for freon timbang adjustment
-- qty_actual: null = belum ditimbang (freon only), filled = sudah dikonfirmasi admin
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS qty_actual NUMERIC(10,3) DEFAULT NULL;

-- Index untuk query "freon belum ditimbang"
CREATE INDEX IF NOT EXISTS idx_inv_tx_freon_unweighed
  ON inventory_transactions (type, qty_actual)
  WHERE type = 'usage' AND qty_actual IS NULL;
