-- Migration 021: Tambah kolom Survey di service_reports
-- Survey job type: gratis, laporan cukup 2 field teks
ALTER TABLE service_reports
  ADD COLUMN IF NOT EXISTS hasil_survey         TEXT,
  ADD COLUMN IF NOT EXISTS catatan_rekomendasi  TEXT;
