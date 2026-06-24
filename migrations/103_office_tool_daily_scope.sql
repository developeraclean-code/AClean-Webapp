-- Migration 103: izinkan scope 'daily' di office_tool_movement
-- (nomor 102 sudah dipakai order_paid_sync_trigger — digeser ke 103)
-- Konteks: rencana "satu pintu" laporan material & alat. Alat kini di-checkout HARIAN
-- per teknisi (bukan per job/customer) — menu "Alat Saya" (matcheckout-style). Sebelumnya
-- scope CHECK hanya ('order','project') → insert scope='daily' ditolak constraint.
-- Fix: longgarkan CHECK agar menerima 'daily'. ref_id dibiarkan NULL untuk daily
-- (alat harian tidak terikat order/project tertentu); carried_by = nama teknisi pemegang.

ALTER TABLE office_tool_movement
  DROP CONSTRAINT IF EXISTS office_tool_movement_scope_check;

ALTER TABLE office_tool_movement
  ADD CONSTRAINT office_tool_movement_scope_check
  CHECK (scope IN ('order', 'project', 'daily'));

-- Index bantu untuk layar "Alat Saya": alat yang sedang dipegang teknisi tertentu.
CREATE INDEX IF NOT EXISTS idx_otm_carrier_status
  ON office_tool_movement (carried_by, status);
