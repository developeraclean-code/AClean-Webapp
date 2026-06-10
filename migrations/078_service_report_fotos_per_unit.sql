-- 078: Foto per-unit di laporan teknisi.
-- Sebelumnya foto disimpan hanya sebagai foto_urls (array datar, tanpa kaitan unit).
-- Kolom fotos (jsonb) menyimpan metadata per foto termasuk unit_no:
--   [{ url, label, unit_no }]  — unit_no null = foto umum (tidak terikat unit).
-- foto_urls tetap dipertahankan untuk backward-compat (WA, reader lama).

ALTER TABLE service_reports ADD COLUMN IF NOT EXISTS fotos jsonb;

COMMENT ON COLUMN service_reports.fotos IS 'Metadata foto per laporan: [{url,label,unit_no}]. unit_no menautkan foto ke unit di units_json (null = umum).';
