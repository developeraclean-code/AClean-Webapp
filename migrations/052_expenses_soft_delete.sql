-- Migration 052: Soft-delete untuk expenses (recycle bin)
-- Gap 5 — biaya yang dihapus tidak langsung permanen; bisa di-restore Owner.
-- deleted_at NULL = aktif. deleted_at terisi = di trash.
-- Hard delete (purge permanen) tetap mungkin via /api atau Owner di trash tab.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_by TEXT DEFAULT NULL;

-- Index parsial: query expenses aktif (mayoritas) cepat, abaikan yang sudah dihapus.
CREATE INDEX IF NOT EXISTS idx_expenses_active
  ON expenses (date DESC)
  WHERE deleted_at IS NULL;
