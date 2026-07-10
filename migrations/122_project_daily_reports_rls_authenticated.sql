-- 122_project_daily_reports_rls_authenticated.sql
-- Temuan audit 10 Jul 2026: policy pdr_select/pdr_insert/pdr_update di
-- project_daily_reports ter-grant ke role `public` (termasuk ANON) dengan
-- qual `true` → siapa pun pemegang anon key (ada di bundle frontend) bisa
-- membaca, membuat, dan MENGUBAH laporan harian project — termasuk set
-- status VERIFIED (gerbang portal customer + gerbang penutupan project).
--
-- Fix: persempit ke `authenticated` (scope yang memang diterima by-design
-- untuk tabel project_* — lihat SOP keamanan 2026-07-04). Semua jalur app
-- (ProjectLaporanModal teknisi, verifikasi Owner/Admin, ProjectDetailView)
-- berjalan dengan user login; portal customer membaca lewat backend
-- service key (bypass RLS) — tidak terdampak.
--
-- ROLLBACK (kembalikan perilaku lama):
--   DROP POLICY IF EXISTS pdr_select ON public.project_daily_reports;
--   DROP POLICY IF EXISTS pdr_insert ON public.project_daily_reports;
--   DROP POLICY IF EXISTS pdr_update ON public.project_daily_reports;
--   CREATE POLICY pdr_select ON public.project_daily_reports FOR SELECT USING (true);
--   CREATE POLICY pdr_insert ON public.project_daily_reports FOR INSERT WITH CHECK (true);
--   CREATE POLICY pdr_update ON public.project_daily_reports FOR UPDATE USING (true);

DROP POLICY IF EXISTS pdr_select ON public.project_daily_reports;
DROP POLICY IF EXISTS pdr_insert ON public.project_daily_reports;
DROP POLICY IF EXISTS pdr_update ON public.project_daily_reports;

CREATE POLICY pdr_select ON public.project_daily_reports
  FOR SELECT TO authenticated USING (true);

CREATE POLICY pdr_insert ON public.project_daily_reports
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY pdr_update ON public.project_daily_reports
  FOR UPDATE TO authenticated USING (true);
