-- ====================================================================
-- 123: Fix policy 122 — anon SELECT gagal (permission denied get_my_role)
-- ====================================================================
-- Masalah: policy "..._admin_all" dibuat FOR ALL (default TO public), jadi
-- saat role `anon` melakukan SELECT, Postgres ikut mengevaluasi USING clause
-- policy admin yang memanggil get_my_role(). Role anon TIDAK punya EXECUTE
-- pada get_my_role() (sengaja dikunci migration 117) → seluruh query 401
-- "permission denied for function get_my_role". Akibatnya website publik
-- (anon key) tidak bisa membaca blog/portfolio sama sekali.
--
-- Fix: scope policy tulis ke role `authenticated` saja (TO authenticated),
-- sehingga tidak dievaluasi saat anon SELECT. Policy baca publik dibuat
-- eksplisit TO anon, authenticated. Keamanan tetap: anon read-only.

drop policy if exists "wp_admin_all"  on website_portfolio;
drop policy if exists "wbm_admin_all" on website_blog_meta;

create policy "wp_admin_all" on website_portfolio
  for all to authenticated
  using      (get_my_role() in ('Owner','Admin'))
  with check (get_my_role() in ('Owner','Admin'));

create policy "wbm_admin_all" on website_blog_meta
  for all to authenticated
  using      (get_my_role() in ('Owner','Admin'))
  with check (get_my_role() in ('Owner','Admin'));

drop policy if exists "wp_public_select"  on website_portfolio;
drop policy if exists "wbm_public_select" on website_blog_meta;

create policy "wp_public_select"  on website_portfolio
  for select to anon, authenticated using (is_active = true);

create policy "wbm_public_select" on website_blog_meta
  for select to anon, authenticated using (is_published = true);
