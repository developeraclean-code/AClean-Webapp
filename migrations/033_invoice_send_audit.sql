-- ── Audit kirim WA per-invoice ──
-- Track berapa kali invoice di-kirim ke customer (single & merged) dan kapan terakhir.
-- Owner bisa cek invoice mana yang sudah lama tidak di-reminder, atau yang sudah di-spam.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS wa_sent_count int DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS wa_last_sent_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS wa_last_sent_mode text; -- "single" | "merged"
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS wa_last_sent_batch text; -- berisi list invoice IDs jika merged, atau NULL untuk single

CREATE INDEX IF NOT EXISTS idx_invoices_wa_last_sent ON invoices(wa_last_sent_at DESC NULLS LAST);
