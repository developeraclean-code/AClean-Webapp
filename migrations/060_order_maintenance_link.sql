-- Migration 060: Tautkan Order ke Maintenance (Opsi B)
-- Order bisa ditandai sebagai servis maintenance korporat + daftar unit yang diservis.
-- Saat laporan order itu DIVERIFIKASI → auto-create maintenance_logs per unit (backend).
-- Jalankan di Supabase SQL Editor.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS maintenance_client_id uuid;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS maintenance_unit_ids  jsonb DEFAULT '[]'::jsonb;

-- Index untuk lookup cepat order maintenance (opsional, ringan)
CREATE INDEX IF NOT EXISTS idx_orders_maint_client ON orders(maintenance_client_id) WHERE maintenance_client_id IS NOT NULL;
