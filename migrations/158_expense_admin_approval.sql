-- Migration 158: approval biaya besar dari Admin (anti biaya fiktif)
--
-- Why: Admin bisa input biaya manual → risiko biaya fiktif besar. Gate: biaya yang dibuat
-- ADMIN dan ≥ Rp 500.000 masuk status PENDING_APPROVAL, BELUM dihitung di total/laporan sampai
-- Owner/Finance menyetujui. Biaya Owner/Finance, atau < 500rb, atau dari jalur otomatis
-- (WA/restock/cron) → APPROVED langsung (alur harian tak terganggu).
--
-- Default 'APPROVED' → semua biaya lama & jalur otomatis tetap terhitung normal.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approval_status text DEFAULT 'APPROVED';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_by text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Baris lama tanpa nilai → APPROVED (jangan sembunyikan biaya historis).
UPDATE expenses SET approval_status = 'APPROVED' WHERE approval_status IS NULL;

-- Index bantu filter panel "Menunggu Approval".
CREATE INDEX IF NOT EXISTS idx_expenses_approval_pending
  ON expenses (approval_status) WHERE approval_status = 'PENDING_APPROVAL';
