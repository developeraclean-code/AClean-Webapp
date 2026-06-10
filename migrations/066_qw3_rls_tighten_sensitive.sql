-- Quick Win 3 — Tighten RLS untuk 3 tabel data sensitif
-- Sebelumnya policy `qual=true` dgn role `{anon, authenticated}` → siapa pun dgn anon key
-- bisa SELECT/UPDATE/DELETE semua row (anon key memang publik by design di frontend).
--
-- Setelah migrasi ini: hanya user yg sudah login (authenticated) bisa akses.
-- Backend tetap pakai service_role (bypass RLS).
-- App.jsx aman: Owner/Admin/Teknisi login dulu sebelum lihat tabel ini.

-- ═══ weekly_payroll ═══
-- Sebelum: ALL role={anon,authenticated} qual=true → siapa pun lihat gaji semua orang
-- Sesudah: ALL hanya authenticated (logged-in only)
DROP POLICY IF EXISTS allow_all_weekly_payroll ON weekly_payroll;

CREATE POLICY auth_read_weekly_payroll ON weekly_payroll
  FOR SELECT TO authenticated USING (true);

CREATE POLICY auth_write_weekly_payroll ON weekly_payroll
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY auth_update_weekly_payroll ON weekly_payroll
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY auth_delete_weekly_payroll ON weekly_payroll
  FOR DELETE TO authenticated USING (true);

-- ═══ kasbon_requests ═══
-- Sebelum: INSERT/SELECT/UPDATE role={anon,authenticated} qual=true
-- Sesudah: hanya authenticated
DROP POLICY IF EXISTS insert_kasbon ON kasbon_requests;
DROP POLICY IF EXISTS read_kasbon ON kasbon_requests;
DROP POLICY IF EXISTS update_kasbon ON kasbon_requests;

CREATE POLICY auth_read_kasbon ON kasbon_requests
  FOR SELECT TO authenticated USING (true);

CREATE POLICY auth_insert_kasbon ON kasbon_requests
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY auth_update_kasbon ON kasbon_requests
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ═══ payment_suggestions ═══
-- Sudah authenticated, tapi rapikan policy + tutup DELETE celah
-- (service_write all sudah bisa write. authenticated read+update sudah ada.
--  Tidak ada DELETE policy → default deny untuk authenticated, oke).
-- NO CHANGE NEEDED — sudah tighter dari kasbon/payroll
