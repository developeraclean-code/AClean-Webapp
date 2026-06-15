-- 092: tambah submitted_by ke project_daily_reports
-- Menyimpan nama pengisi laporan agar lock/edit logic bisa membedakan
-- siapa yang berhak revisi (submitter + teknisi utama).
ALTER TABLE project_daily_reports
  ADD COLUMN IF NOT EXISTS submitted_by TEXT;
