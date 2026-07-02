-- Migration 114: dukung MULTI-KATEGORI bonus per order (mis. Freon + Kapasitor).
-- Ganti unique (order_id) dari migrasi 113 → unique (order_id, bonus_type) non-void.
-- Jadi 1 order boleh punya beberapa bonus beda tipe, tapi tetap tak boleh tipe sama dobel.

DROP INDEX IF EXISTS uq_order_bonuses_order_active;

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_bonuses_order_type_active
  ON order_bonuses(order_id, bonus_type)
  WHERE order_id IS NOT NULL AND status <> 'VOID';

COMMENT ON INDEX uq_order_bonuses_order_type_active IS
  '1 order boleh banyak bonus (beda tipe), tapi tipe yang sama tak boleh dobel. Void dulu utk ganti.';
