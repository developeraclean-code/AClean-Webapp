-- Migration 098: Maintenance System Improvements
-- 1. Fix trigger last_service_date — handle DELETE + UPDATE (recalculate MAX)
-- 2. Expand maintenance_units.status enum
-- 3. Add service_category column ke maintenance_logs (billing classifier)
-- 4. Unique constraint anti double-log per unit per hari per service_type
-- 5. Add service_interval_months + next_service_date ke maintenance_units (kalau belum ada)
-- 6. Add materials column ke maintenance_logs (alias dari parts_used untuk backward compat)

-- ─────────────────────────────────────────────────────────────
-- 1. Fix trigger: recalculate last_service_date saat INSERT, UPDATE, DELETE
--    Sebelumnya hanya INSERT → delete log tidak update last_service_date
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mlog_touch_unit() RETURNS trigger AS $$
DECLARE
  v_unit_id uuid;
  v_max_date date;
BEGIN
  -- Tentukan unit yang terdampak
  IF TG_OP = 'DELETE' THEN
    v_unit_id := OLD.unit_id;
  ELSE
    v_unit_id := NEW.unit_id;
  END IF;

  -- Recalculate dari semua log yang tersisa
  SELECT MAX(service_date) INTO v_max_date
  FROM maintenance_logs
  WHERE unit_id = v_unit_id;

  UPDATE maintenance_units
     SET last_service_date = v_max_date
   WHERE id = v_unit_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

-- Rebuild trigger untuk INSERT + UPDATE + DELETE
DROP TRIGGER IF EXISTS trg_mlog_touch_unit ON maintenance_logs;
CREATE TRIGGER trg_mlog_touch_unit
  AFTER INSERT OR UPDATE OF service_date OR DELETE ON maintenance_logs
  FOR EACH ROW EXECUTE FUNCTION mlog_touch_unit();

-- ─────────────────────────────────────────────────────────────
-- 2. Expand maintenance_units.status — tambah nilai baru
--    existing: active | rusak | retired
--    tambah: baru | perlu_perbaikan | dalam_perbaikan | nonaktif
-- ─────────────────────────────────────────────────────────────
ALTER TABLE maintenance_units DROP CONSTRAINT IF EXISTS maintenance_units_status_check;
ALTER TABLE maintenance_units
  ADD CONSTRAINT maintenance_units_status_check
  CHECK (status IN ('active','baru','perlu_perbaikan','dalam_perbaikan','nonaktif','rusak','retired'));

-- ─────────────────────────────────────────────────────────────
-- 3. service_category: machine-readable billing classifier
--    cuci_rutin  → billable (cleaning)
--    inspeksi    → billable (paid inspection)
--    perbaikan   → billable (repair)
--    pengecekan  → NON-billable (cek / visit only)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE maintenance_logs
  ADD COLUMN IF NOT EXISTS service_category text
  DEFAULT 'cuci_rutin'
  CHECK (service_category IN ('cuci_rutin','inspeksi','perbaikan','pengecekan'));

-- ─────────────────────────────────────────────────────────────
-- 4. Unique constraint: cegah double-log unit yang sama di hari + service_type yang sama
--    Cek dulu apakah ada existing duplicates sebelum add constraint
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  dup_count int;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT unit_id, service_date, service_type, COUNT(*) as c
    FROM maintenance_logs
    GROUP BY unit_id, service_date, service_type
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE WARNING 'Terdapat % duplikat di maintenance_logs — unique constraint TIDAK dipasang. Bersihkan dulu via maintenance_logs_dedup.', dup_count;
  ELSE
    -- Aman: pasang partial unique index (allow pengecekan berulang, unique hanya untuk billable)
    -- Gunakan partial index: hanya enforce untuk cuci_rutin + inspeksi + perbaikan
    -- (pengecekan boleh lebih dari 1x per hari karena non-billable visit)
    -- Catatan: pakai CREATE UNIQUE INDEX supaya bisa pakai WHERE
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_mlogs_no_double
             ON maintenance_logs (unit_id, service_date, service_type)
             WHERE service_category IN (''cuci_rutin'', ''inspeksi'', ''perbaikan'')';
    RAISE NOTICE 'Unique constraint idx_mlogs_no_double berhasil dibuat.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5. Kolom service_interval_months + next_service_date (jika belum ada dari migration sebelumnya)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE maintenance_units
  ADD COLUMN IF NOT EXISTS service_interval_months int DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_service_date date;

-- Auto-hitung next_service_date dari last_service_date + interval (untuk unit yang sudah punya data)
UPDATE maintenance_units
   SET next_service_date = last_service_date + (service_interval_months * INTERVAL '1 month')
 WHERE last_service_date IS NOT NULL
   AND next_service_date IS NULL
   AND service_interval_months IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 6. Kolom materials (JSONB) di maintenance_logs — alias fungsional dari parts_used
--    Autolog handler memakai kolom "materials" (lihat api/[route].js)
--    parts_used sudah ada di skema asal → tambah materials untuk alignment
-- ─────────────────────────────────────────────────────────────
ALTER TABLE maintenance_logs
  ADD COLUMN IF NOT EXISTS materials jsonb DEFAULT '[]'::jsonb;

-- Sync data: copy parts_used → materials untuk baris lama yang belum punya
UPDATE maintenance_logs
   SET materials = parts_used
 WHERE materials = '[]'::jsonb
   AND parts_used IS NOT NULL
   AND parts_used != '[]'::jsonb;
