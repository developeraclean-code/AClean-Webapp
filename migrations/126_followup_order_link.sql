-- Migration 126: kolom order_id di maintenance_followups — tautan temuan → order
-- Dipakai alur "Buat Order dari temuan" (MaintenanceView FollowupTab) dan
-- auto-close temuan saat laporan order-nya diverifikasi (autolog portal.js).
-- Catatan: migrasi 099 menaruh order_id di pre_service_manifests, BUKAN di
-- followups — komentar kode sempat salah mengasumsikan kolom ini sudah ada
-- (temuan review 19 Jul 2026: PATCH order_id selalu 400, auto-close 0 senyap).

ALTER TABLE maintenance_followups
  ADD COLUMN IF NOT EXISTS order_id TEXT;

CREATE INDEX IF NOT EXISTS idx_maint_followups_order
  ON maintenance_followups (order_id) WHERE order_id IS NOT NULL;

COMMENT ON COLUMN maintenance_followups.order_id IS
  'orders.id yang dibuat dari temuan ini (tombol Buat Order). Autolog menutup temuan ber-order_id saat laporan order diverifikasi.';
