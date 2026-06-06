-- 073_kasbon_rls_authenticated.sql
-- FIX: policy kasbon_requests di migrasi 068 hanya TO anon, padahal user login
-- via supabase.auth.signInWithPassword → role-nya "authenticated", bukan "anon".
-- Akibatnya teknisi gagal submit kasbon: 403 "new row violates row-level security policy".
-- Solusi: policy berlaku untuk anon + authenticated (sesuai niat asli: akses terbuka).

DROP POLICY IF EXISTS "insert_own_kasbon" ON kasbon_requests;
DROP POLICY IF EXISTS "read_kasbon" ON kasbon_requests;
DROP POLICY IF EXISTS "update_kasbon" ON kasbon_requests;

CREATE POLICY "insert_kasbon" ON kasbon_requests
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "read_kasbon" ON kasbon_requests
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "update_kasbon" ON kasbon_requests
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
