-- Migration 105: aktifkan registry unit AC permanen (forward-only, order >= 2026-06-25)
-- Konteks: customer reguler unit-nya ke-input dobel tiap kunjungan. Data historis tak bisa
-- di-retrofit (95% signature unit tidak konsisten antar visit, tak ada kunci fisik stabil).
-- Solusi: registry maju — tiap unit fisik = 1 row ac_units terikat customer_id, identitas =
-- label posisi (kolom lokasi). Tabel ac_units sudah ada (migrasi 018, dormant) — selaraskan
-- kolomnya dengan field unit laporan (merk/tipe/pk) supaya bisa di-prefill ke laporan.

ALTER TABLE ac_units ADD COLUMN IF NOT EXISTS merk text;
ALTER TABLE ac_units ADD COLUMN IF NOT EXISTS tipe text;
ALTER TABLE ac_units ADD COLUMN IF NOT EXISTS pk text;

-- Lookup cepat: unit aktif per customer (dipakai openLaporanModal untuk prefill).
CREATE INDEX IF NOT EXISTS idx_ac_units_customer_active
  ON ac_units (customer_id, is_active);

-- RLS: app login pakai Supabase Auth (authenticated). Pola sama office_tools/maintenance.
ALTER TABLE ac_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ac_units_auth_all ON ac_units;
CREATE POLICY ac_units_auth_all ON ac_units
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
