-- Migration 064: B2B Maintenance enhancements
-- 1. Contract fields pada maintenance_clients
-- 2. PM schedule (interval + next_service_date) pada maintenance_units
-- 3. Materials tracking pada maintenance_logs

-- ── 1. Contract fields ──
ALTER TABLE maintenance_clients
  ADD COLUMN IF NOT EXISTS contract_start_date date,
  ADD COLUMN IF NOT EXISTS contract_end_date   date,
  ADD COLUMN IF NOT EXISTS contract_value      numeric(14,2);

-- ── 2. PM schedule ──
ALTER TABLE maintenance_units
  ADD COLUMN IF NOT EXISTS service_interval_months int DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_service_date        date;

-- Auto-hitung next_service_date = last_service_date + interval
CREATE OR REPLACE FUNCTION fn_compute_next_service()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.last_service_date IS NOT NULL THEN
    NEW.next_service_date :=
      NEW.last_service_date
      + (COALESCE(NEW.service_interval_months, 3) * INTERVAL '1 month');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_next_service ON maintenance_units;
CREATE TRIGGER trg_compute_next_service
  BEFORE INSERT OR UPDATE OF last_service_date, service_interval_months
  ON maintenance_units
  FOR EACH ROW EXECUTE FUNCTION fn_compute_next_service();

-- Back-fill next_service_date untuk unit yang sudah punya last_service_date
UPDATE maintenance_units
SET next_service_date =
  last_service_date + (COALESCE(service_interval_months, 3) * INTERVAL '1 month')
WHERE last_service_date IS NOT NULL;

-- ── 3. Materials pada logs ──
ALTER TABLE maintenance_logs
  ADD COLUMN IF NOT EXISTS materials jsonb DEFAULT '[]'::jsonb;
