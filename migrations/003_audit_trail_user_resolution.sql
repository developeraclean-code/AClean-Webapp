-- ═══════════════════════════════════════════════════════════════════════════════
-- STABILISASI #2B (FIX): AUDIT TRAIL — USER RESOLUTION
-- File     : migrations/003_audit_trail_user_resolution.sql
-- Tanggal  : 2026-04-15
-- Masalah  : Session var app.current_user tidak persist di Supabase pooler
--            (transaction mode). RPC set_current_user jalan di connection A,
--            INSERT/UPDATE jalan di connection B → changed_by selalu 'system'.
-- Solusi   : Tambah kolom last_changed_by di 4 tabel target.
--            Frontend inject last_changed_by di setiap mutation payload.
--            Trigger baca dari NEW/OLD row (persist dengan data).
--
-- CARA PAKAI:
--   1. Supabase Dashboard → SQL Editor
--   2. JALANKAN SECTION 1 (pre-flight) — read-only cek.
--   3. JALANKAN SECTION 2 (apply) — tambah kolom + update trigger function.
--   4. JALANKAN SECTION 3 (verify).
--
-- ROLLBACK: Section 4 (commented by default).
-- ═══════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — PRE-FLIGHT CHECK (READ-ONLY)
-- ═══════════════════════════════════════════════════════════════════════════════
SELECT 'preflight_1.1_existing_columns' AS check_name,
       table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('invoices','expenses','orders','service_reports')
  AND column_name IN ('last_changed_by','created_by','created_by_name','updated_by')
ORDER BY table_name, column_name;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — APPLY (idempotent)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 2.1  Tambah kolom last_changed_by di 4 tabel target
ALTER TABLE invoices         ADD COLUMN IF NOT EXISTS last_changed_by TEXT;
ALTER TABLE expenses         ADD COLUMN IF NOT EXISTS last_changed_by TEXT;
ALTER TABLE orders           ADD COLUMN IF NOT EXISTS last_changed_by TEXT;
ALTER TABLE service_reports  ADD COLUMN IF NOT EXISTS last_changed_by TEXT;

-- 2.2  Update helper function — fallback chain lebih panjang
--      Prioritas: last_changed_by → updated_by → created_by_name → created_by → session var → 'system'
--      DROP dulu karena versi lama (migration 002) pakai nama parameter 'new_row',
--      CREATE OR REPLACE tidak boleh rename parameter.
DROP FUNCTION IF EXISTS get_current_user_for_audit(JSONB);
CREATE FUNCTION get_current_user_for_audit(row_data JSONB)
RETURNS TEXT AS $$
DECLARE
  v_user TEXT;
BEGIN
  IF row_data IS NOT NULL THEN
    -- Prioritas 1: last_changed_by (kolom dedicated)
    v_user := row_data ->> 'last_changed_by';
    IF v_user IS NOT NULL AND v_user <> '' THEN RETURN v_user; END IF;

    -- Prioritas 2: updated_by
    v_user := row_data ->> 'updated_by';
    IF v_user IS NOT NULL AND v_user <> '' THEN RETURN v_user; END IF;

    -- Prioritas 3: created_by_name (INSERT case, nama teknisi/owner)
    v_user := row_data ->> 'created_by_name';
    IF v_user IS NOT NULL AND v_user <> '' THEN RETURN v_user; END IF;

    -- Prioritas 4: created_by (hanya kalau bukan UUID — pakai regex cepat)
    v_user := row_data ->> 'created_by';
    IF v_user IS NOT NULL AND v_user <> ''
       AND v_user !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN RETURN v_user; END IF;
  END IF;

  -- Prioritas 5: session var (kalau pakai session pooler atau direct connection)
  v_user := current_setting('app.current_user', true);
  IF v_user IS NOT NULL AND v_user <> '' THEN RETURN v_user; END IF;

  RETURN 'system';
END $$ LANGUAGE plpgsql;

-- 2.3  Update trigger function — lewatkan COALESCE(NEW, OLD) biar DELETE juga bisa resolve
CREATE OR REPLACE FUNCTION log_audit_trail()
RETURNS TRIGGER AS $$
DECLARE
  v_user      TEXT;
  v_row_id    TEXT;
  v_before    JSONB;
  v_after     JSONB;
  v_diff      TEXT[];
  v_source    JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_row_id := COALESCE(NEW.id::text, '?');
    v_before := NULL;
    v_after  := to_jsonb(NEW);
    v_source := v_after;
  ELSIF TG_OP = 'UPDATE' THEN
    v_row_id := COALESCE(NEW.id::text, OLD.id::text, '?');
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    v_source := v_after;
    SELECT array_agg(key) INTO v_diff
    FROM jsonb_each(v_after) n
    WHERE n.value IS DISTINCT FROM (v_before -> n.key);
    IF v_diff IS NULL OR array_length(v_diff, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_row_id := COALESCE(OLD.id::text, '?');
    v_before := to_jsonb(OLD);
    v_after  := NULL;
    v_source := v_before;  -- baca user dari row yang di-delete
  END IF;

  v_user := get_current_user_for_audit(v_source);

  INSERT INTO audit_log(
    table_name, row_id, action, changed_by, before_data, after_data, diff_keys
  ) VALUES (
    TG_TABLE_NAME, v_row_id, TG_OP, v_user, v_before, v_after, v_diff
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[audit_trail] insert failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — VERIFY
-- ═══════════════════════════════════════════════════════════════════════════════

-- 3.1  Kolom last_changed_by terpasang di 4 tabel
SELECT 'verify_3.1_last_changed_by' AS check_name,
       table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('invoices','expenses','orders','service_reports')
  AND column_name = 'last_changed_by'
ORDER BY table_name;
-- Expected: 4 rows.

-- 3.2  Function get_current_user_for_audit updated (versi baru = parameter row_data, bukan new_row)
SELECT 'verify_3.2_function_sig' AS check_name,
       routine_name, data_type AS return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'get_current_user_for_audit';


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — ROLLBACK (uncomment kalau perlu revert)
-- ═══════════════════════════════════════════════════════════════════════════════
-- ALTER TABLE invoices         DROP COLUMN IF EXISTS last_changed_by;
-- ALTER TABLE expenses         DROP COLUMN IF EXISTS last_changed_by;
-- ALTER TABLE orders           DROP COLUMN IF EXISTS last_changed_by;
-- ALTER TABLE service_reports  DROP COLUMN IF EXISTS last_changed_by;
-- -- Trigger function: rerun migration 002 section 2.4 & 2.5 untuk restore versi lama.
