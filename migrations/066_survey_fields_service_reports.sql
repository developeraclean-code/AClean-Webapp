-- Migration 066: Tambah kolom survey ke service_reports
-- hasil_survey, catatan_rekomendasi sudah ada (dari submit survey sebelumnya via upsert)
-- survey_sent_at: timestamp kapan hasil survey dikirim ke customer via WA

ALTER TABLE service_reports
  ADD COLUMN IF NOT EXISTS hasil_survey TEXT,
  ADD COLUMN IF NOT EXISTS catatan_rekomendasi TEXT,
  ADD COLUMN IF NOT EXISTS survey_sent_at TIMESTAMPTZ;
