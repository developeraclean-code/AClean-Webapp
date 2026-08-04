-- 130_maintenance_unit_group.sql
-- Kolom unit_group untuk pengelompokan unit maintenance di portal & panel admin.
-- Nilai yang dipakai UI: SMA / SMK / SMP / SD / Other. NULL atau nilai lain → tampil "Other".
-- Diisi admin (dropdown di Edit Unit). Tidak mempengaruhi logika servis/PM.

ALTER TABLE maintenance_units ADD COLUMN IF NOT EXISTS unit_group text;
COMMENT ON COLUMN maintenance_units.unit_group IS 'Kategori tampilan: SMA/SMK/SMP/SD/Other. Diisi admin; NULL -> Other di UI.';
