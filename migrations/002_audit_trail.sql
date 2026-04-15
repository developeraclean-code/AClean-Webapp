-- ═══════════════════════════════════════════════════════════════════════════════
-- STABILISASI #2: AUDIT TRAIL (Invoice, Expense, Order, Service Report)
-- File     : migrations/002_audit_trail.sql
-- Tanggal  : 2026-04-14
-- Tujuan   : Record setiap perubahan data keuangan & operasional:
--            • Siapa mengubah (user id / email)
--            • Kapan
--            • Nilai SEBELUM (before_data JSONB)
--            • Nilai SESUDAH (after_data JSONB)
--            • Field mana saja yang berubah (diff_keys)
--
-- CARA KERJA:
--   1. Trigger Postgres fires AFTER INSERT/UPDATE/DELETE pada tabel target.
--   2. Trigger baca user id dari (prioritas):
--        a) session var 'app.current_user'  → via RPC set_current_user(uid)
--        b) NEW.last_changed_by column      → kalau ada (cadangan)
--        c) 'system' → default (misal perubahan via backend/cron)
--   3. Insert row ke audit_log. Immutable — tidak boleh diubah/dihapus via app.
--
-- CARA PAKAI:
--   1. Supabase Dashboard → SQL Editor
--   2. JALANKAN SECTION 1 (pre-flight check) — pastikan tabel target exist.
--   3. JALANKAN SECTION 2 (apply).
--   4. JALANKAN SECTION 3 (smoke test) — INSERT dummy dan lihat audit_log.
--   5. JALANKAN SECTION 4 (verify) — konfirmasi trigger terpasang.
--
-- ROLLBACK: Section 5 (commented by default).
-- ═══════════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 1 — PRE-FLIGHT CHECK (READ-ONLY)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1.1  Cek tabel target exist
SELECT 'preflight_1.1_target_tables' AS check_name,
       tablename, schemaname
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('invoices','expenses','orders','service_reports')
ORDER BY tablename;
-- Expected: 4 rows. Kalau kurang = tabel belum dibuat, stop.

-- 1.2  Cek apakah audit_log sudah pernah dibuat (idempotency)
SELECT 'preflight_1.2_existing_audit' AS check_name,
       tablename
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'audit_log';
-- Kalau ada = migration pernah dijalankan. Section 2 aman di-run ulang (idempotent).


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 2 — APPLY (idempotent, aman dijalankan berulang)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 2.1  Tabel audit_log — immutable history
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  table_name    TEXT NOT NULL,
  row_id        TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  changed_by    TEXT NOT NULL DEFAULT 'system',
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  before_data   JSONB,
  after_data    JSONB,
  diff_keys     TEXT[]
);

-- 2.2  Index untuk query cepat di viewer UI
CREATE INDEX IF NOT EXISTS idx_audit_table_row    ON audit_log(table_name, row_id);
CREATE INDEX IF NOT EXISTS idx_audit_changed_at   ON audit_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_changed_by   ON audit_log(changed_by);
CREATE INDEX IF NOT EXISTS idx_audit_action       ON audit_log(action);

-- 2.3  RPC set_current_user(uid) — frontend panggil SEBELUM mutation
--      Pakai false (session) karena supabase-js tidak wrap dalam transaction
--      eksplisit. Alternatif kalau pool connection = hint via last_changed_by.
CREATE OR REPLACE FUNCTION set_current_user(uid TEXT)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_user', COALESCE(uid, 'system'), false);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2.4  Helper: baca current user dengan fallback chain
CREATE OR REPLACE FUNCTION get_current_user_for_audit(new_row JSONB)
RETURNS TEXT AS $$
DECLARE
  v_user TEXT;
BEGIN
  -- Prioritas 1: session var
  v_user := current_setting('app.current_user', true);
  IF v_user IS NOT NULL AND v_user <> '' THEN RETURN v_user; END IF;

  -- Prioritas 2: kolom last_changed_by di NEW row
  IF new_row IS NOT NULL THEN
    v_user := new_row ->> 'last_changed_by';
    IF v_user IS NOT NULL AND v_user <> '' THEN RETURN v_user; END IF;
  END IF;

  -- Default
  RETURN 'system';
END $$ LANGUAGE plpgsql;

-- 2.5  Generic trigger function
CREATE OR REPLACE FUNCTION log_audit_trail()
RETURNS TRIGGER AS $$
DECLARE
  v_user      TEXT;
  v_row_id    TEXT;
  v_before    JSONB;
  v_after     JSONB;
  v_diff      TEXT[];
BEGIN
  -- Tentukan before/after sesuai TG_OP
  IF TG_OP = 'INSERT' THEN
    v_row_id := COALESCE(NEW.id::text, '?');
    v_before := NULL;
    v_after  := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_row_id := COALESCE(NEW.id::text, OLD.id::text, '?');
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    -- Hitung field yang berubah
    SELECT array_agg(key) INTO v_diff
    FROM jsonb_each(v_after) n
    WHERE n.value IS DISTINCT FROM (v_before -> n.key);
    -- Kalau tidak ada perubahan nyata, skip (noise UPDATE)
    IF v_diff IS NULL OR array_length(v_diff, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_row_id := COALESCE(OLD.id::text, '?');
    v_before := to_jsonb(OLD);
    v_after  := NULL;
  END IF;

  v_user := get_current_user_for_audit(v_after);

  INSERT INTO audit_log(
    table_name, row_id, action, changed_by, before_data, after_data, diff_keys
  ) VALUES (
    TG_TABLE_NAME, v_row_id, TG_OP, v_user, v_before, v_after, v_diff
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- JANGAN blokir mutation kalau audit fail (misal audit_log penuh).
  -- Log warning ke postgres log; biarkan transaksi bisnis lanjut.
  RAISE WARNING '[audit_trail] insert failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2.6  Pasang trigger pada 4 tabel target
--      AFTER trigger = trigger jalan setelah mutation sukses, tidak blok.

DROP TRIGGER IF EXISTS trg_audit_invoices        ON invoices;
CREATE TRIGGER trg_audit_invoices
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION log_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_expenses        ON expenses;
CREATE TRIGGER trg_audit_expenses
  AFTER INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION log_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_orders          ON orders;
CREATE TRIGGER trg_audit_orders
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION log_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_service_reports ON service_reports;
CREATE TRIGGER trg_audit_service_reports
  AFTER INSERT OR UPDATE OR DELETE ON service_reports
  FOR EACH ROW EXECUTE FUNCTION log_audit_trail();

-- 2.7  RLS: audit_log readable, tidak writable dari app.
--      Insert hanya via trigger (SECURITY DEFINER bypass RLS).
--      Update/delete dilarang sepenuhnya (immutable log).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_read ON audit_log;
CREATE POLICY audit_log_read
  ON audit_log FOR SELECT
  USING (true);  -- semua authenticated bisa baca; filter by role di frontend

-- Tidak ada policy INSERT/UPDATE/DELETE → default deny untuk app.
-- Trigger tetap bisa insert karena SECURITY DEFINER.

-- 2.8  Helper: prune log > 12 bulan (jalankan manual atau via cron nanti)
CREATE OR REPLACE FUNCTION prune_audit_log_older_than(months INT DEFAULT 12)
RETURNS INT AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM audit_log
  WHERE changed_at < NOW() - (months || ' months')::INTERVAL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$ LANGUAGE plpgsql SECURITY DEFINER;


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 3 — SMOKE TEST (aman, data di-rollback)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 3.1  Set current user simulasi
SELECT set_current_user('test_user_smoke@aclean.local');

-- 3.2  Insert dummy invoice (pilih order_id yang real; sesuaikan kalau perlu)
--      Kalau tabel invoices schema berbeda, sesuaikan kolom wajib.
--      Skip test ini dengan ROLLBACK di bawah kalau ragu.
-- INSERT INTO invoices(id, job_id, customer, total, status)
-- VALUES ('INV-SMOKE-TEST', NULL, 'Smoke Test', 1000, 'DRAFT');

-- 3.3  Cek apakah audit_log tercatat
-- SELECT * FROM audit_log
-- WHERE row_id = 'INV-SMOKE-TEST' ORDER BY changed_at DESC LIMIT 5;

-- 3.4  Cleanup — tidak commit apapun
ROLLBACK;

-- Alternatif smoke test tanpa touch data bisnis:
-- Buat tabel sementara, pasang trigger, test, drop.


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 4 — VERIFY (konfirmasi semua komponen terpasang)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 4.1  Cek tabel audit_log + kolom
SELECT 'verify_4.1_audit_log_columns' AS check_name,
       column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'audit_log'
ORDER BY ordinal_position;
-- Expected: 8 kolom (id, table_name, row_id, action, changed_by, changed_at, before_data, after_data, diff_keys)

-- 4.2  Cek trigger terpasang
SELECT 'verify_4.2_triggers' AS check_name,
       event_object_table AS target_table,
       trigger_name,
       string_agg(event_manipulation, ',' ORDER BY event_manipulation) AS events
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE 'trg_audit_%'
GROUP BY event_object_table, trigger_name
ORDER BY event_object_table;
-- Expected: 4 trigger (invoices, expenses, orders, service_reports) masing-masing dengan 3 event (DELETE,INSERT,UPDATE)

-- 4.3  Cek function terpasang
SELECT 'verify_4.3_functions' AS check_name,
       routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('set_current_user','get_current_user_for_audit','log_audit_trail','prune_audit_log_older_than')
ORDER BY routine_name;
-- Expected: 4 rows.

-- 4.4  Cek index audit_log
SELECT 'verify_4.4_indexes' AS check_name,
       indexname
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'audit_log'
ORDER BY indexname;
-- Expected: 5 index (pkey + 4 custom).


-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 5 — ROLLBACK (uncomment kalau butuh revert SEMUA)
-- ═══════════════════════════════════════════════════════════════════════════════
-- DROP TRIGGER IF EXISTS trg_audit_invoices        ON invoices;
-- DROP TRIGGER IF EXISTS trg_audit_expenses        ON expenses;
-- DROP TRIGGER IF EXISTS trg_audit_orders          ON orders;
-- DROP TRIGGER IF EXISTS trg_audit_service_reports ON service_reports;
-- DROP FUNCTION IF EXISTS log_audit_trail();
-- DROP FUNCTION IF EXISTS get_current_user_for_audit(JSONB);
-- DROP FUNCTION IF EXISTS set_current_user(TEXT);
-- DROP FUNCTION IF EXISTS prune_audit_log_older_than(INT);
-- DROP TABLE IF EXISTS audit_log;
