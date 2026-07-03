-- 112_function_search_path.sql
-- Fix 41 function_search_path_mutable (security advisor Supabase).
-- Fungsi tanpa SET search_path rentan search_path injection: penyerang bisa
-- ganti search_path session → fungsi memanggil objek palsu.
-- Loop ALTER FUNCTION idempotent — aman diulang dan otomatis tangkap fungsi baru.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND (p.proconfig IS NULL OR NOT (p.proconfig::text LIKE '%search_path%'))
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_catalog', r.sig);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skip % : %', r.sig, SQLERRM;
    END;
  END LOOP;
END $$;

-- Verifikasi: harus mengembalikan 0 baris (semua fungsi public sudah punya search_path)
SELECT proname, proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND (p.proconfig IS NULL OR NOT (p.proconfig::text LIKE '%search_path%'));
