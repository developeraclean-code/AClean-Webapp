-- Migration 115: cegah baris "dismissed" (order ditandai tidak dapat bonus) ganda.
-- Baris dismissed = status VOID, jadi TAK tercakup index uq_order_bonuses_order_type_active
-- (yang WHERE status <> 'VOID'). Tanpa penjaga → double-click / error pasca-insert bisa buat duplikat.
-- Index ini menjamin maksimal 1 baris dismissed per order.

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_bonuses_dismissed
  ON order_bonuses(order_id)
  WHERE bonus_type = 'dismissed';

COMMENT ON INDEX uq_order_bonuses_dismissed IS
  'Maksimal 1 baris dismissed per order (order ditandai tidak dapat bonus).';
