-- Migration 045: Hybrid attendance tracking
-- Tambah status enum + reason di technician_availability untuk track:
--   AUTO        = default (null) → ikut auto-count dari orders
--   STANDBY     = helper hadir di kantor tapi tidak ada order → tetap dihitung +1 hari
--   IJIN        = ijin → override jadi 0 (tidak dihitung walaupun ada order assigned)
--   SAKIT       = sakit → override jadi 0
--   ALPA        = alpa/tidak hadir → override jadi 0
--
-- Payroll formula:
--   days_worked = (auto_count_from_orders ∪ STANDBY_dates) \ (IJIN ∪ SAKIT ∪ ALPA dates)

ALTER TABLE technician_availability ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE technician_availability ADD COLUMN IF NOT EXISTS reason TEXT;

-- Backfill: row lama dengan is_available=false → status='IJIN' (preserve historis)
UPDATE technician_availability
SET status = 'IJIN'
WHERE is_available = false AND status IS NULL;

-- Constraint enum (longgar — pakai CHECK biar gampang extend)
ALTER TABLE technician_availability DROP CONSTRAINT IF EXISTS techavail_status_chk;
ALTER TABLE technician_availability
  ADD CONSTRAINT techavail_status_chk
  CHECK (status IS NULL OR status IN ('STANDBY','IJIN','SAKIT','ALPA'));

CREATE INDEX IF NOT EXISTS idx_techavail_status ON technician_availability (status) WHERE status IS NOT NULL;

COMMENT ON COLUMN technician_availability.status IS 'NULL=auto count dari orders | STANDBY=hadir standby (+1) | IJIN/SAKIT/ALPA=override jadi 0';
COMMENT ON COLUMN technician_availability.reason IS 'Alasan ijin/sakit/alpa atau note standby (opsional)';
