-- Migration 050: Berita Acara Pengerjaan (BAP) — TTD customer di HP teknisi
-- Wajib sebelum laporan SUBMITTED, kecuali customer tidak di tempat (perlu alasan)
-- TTD disimpan sebagai PNG di R2 (folder signatures/)

ALTER TABLE service_reports
  ADD COLUMN IF NOT EXISTS bap_number          TEXT,
  ADD COLUMN IF NOT EXISTS bap_statement       TEXT,
  ADD COLUMN IF NOT EXISTS bap_recommendation  TEXT,
  ADD COLUMN IF NOT EXISTS ttd_customer_url    TEXT,
  ADD COLUMN IF NOT EXISTS ttd_customer_name   TEXT,
  ADD COLUMN IF NOT EXISTS bap_skipped_reason  TEXT,
  ADD COLUMN IF NOT EXISTS bap_signed_at       TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_reports_bap_number
  ON service_reports(bap_number) WHERE bap_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_reports_bap_signed_at
  ON service_reports(bap_signed_at) WHERE bap_signed_at IS NOT NULL;

COMMENT ON COLUMN service_reports.bap_number IS
  'Nomor BAP format BAP-YYYYMMDD-NNN, counter reset per hari.';
COMMENT ON COLUMN service_reports.bap_statement IS
  'Teks pernyataan BAP (snapshot saat TTD). Default dari app_settings.bap_statement_default, bisa diedit di lokasi.';
COMMENT ON COLUMN service_reports.bap_recommendation IS
  'Rekomendasi/catatan pengerjaan yang customer baca sebelum TTD. Bukti customer setuju atas hasil & tambahan.';
COMMENT ON COLUMN service_reports.ttd_customer_url IS
  'URL R2 PNG tanda tangan customer. NULL kalau bap_skipped_reason terisi.';
COMMENT ON COLUMN service_reports.bap_skipped_reason IS
  'Alasan kenapa customer tidak TTD (customer tidak di tempat, dll). NULL kalau TTD ada.';

-- Seed default pernyataan BAP ke app_settings (Owner bisa edit via Pengaturan)
INSERT INTO app_settings (key, value)
VALUES ('bap_statement_default',
'Dengan ditandatanganinya Berita Acara ini, customer menyatakan bahwa pekerjaan AC di atas telah selesai dikerjakan dengan baik, unit berfungsi normal, dan area kerja telah dirapikan. Customer menerima hasil pekerjaan tanpa keberatan.')
ON CONFLICT (key) DO NOTHING;
