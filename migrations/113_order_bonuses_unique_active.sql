-- Migration 113: cegah komisi ganda per order (1 order = 1 komisi aktif/non-void)
-- Defense-in-depth untuk guard di handleSaveBonus (double-submit / buka form ulang).
-- Partial index: hanya berlaku utk order_id NOT NULL & status != 'VOID' —
-- jadi setelah di-VOID, order boleh dibuatkan komisi baru lagi.

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_bonuses_order_active
  ON order_bonuses(order_id)
  WHERE order_id IS NOT NULL AND status <> 'VOID';

COMMENT ON INDEX uq_order_bonuses_order_active IS
  '1 order = 1 komisi aktif. Void dulu sebelum buat komisi baru untuk order yang sama.';
