-- Migration 120: DELETE guard server-side untuk tabel operasional
-- Tombol hapus order/customer di UI sudah Owner-only, tapi enforcement-nya cuma
-- di client — semua user login bisa DELETE via PostgREST langsung. Migrasi ini
-- memindahkan guard ke DB tanpa mengubah kode frontend.
--
-- Pemetaan caller delete aktual (trace 2026-07-03):
--  * orders: tombol hapus = Owner (ScheduleView:642); TAPI Admin butuh DELETE
--    untuk rollback createOrder gagal-claim (createOrder.js:143), batal quotation
--    (QuotationView:130), dan hapus order maintenance (MaintenanceView:1879)
--    → DELETE = Owner/Admin.
--  * service_reports: deleteServiceReport hanya dipanggil LaporanTimView (O/A)
--    → DELETE = Owner/Admin.
--  * customers: deleteCustomer hanya di CustomersView, tombol gated Owner
--    → DELETE = Owner.
-- SELECT/INSERT/UPDATE ketiga tabel tetap semua authenticated (teknisi perlu
-- update status order + tulis laporan). Ditulis ulang per-command TO authenticated
-- (dari pola lama TO public + auth.role()) untuk kebersihan lint.
-- Bergantung pada: migrasi 117 (get_my_role).

-- ── 1. orders ──
DROP POLICY IF EXISTS orders_select ON public.orders;
DROP POLICY IF EXISTS orders_insert ON public.orders;
DROP POLICY IF EXISTS orders_update ON public.orders;
DROP POLICY IF EXISTS orders_delete ON public.orders;

CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated USING (true);

CREATE POLICY orders_insert ON public.orders
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY orders_update ON public.orders
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY orders_delete ON public.orders
  FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin'));

-- ── 2. service_reports ──
DROP POLICY IF EXISTS reports_select ON public.service_reports;
DROP POLICY IF EXISTS reports_insert ON public.service_reports;
DROP POLICY IF EXISTS reports_update ON public.service_reports;
DROP POLICY IF EXISTS reports_delete ON public.service_reports;

CREATE POLICY reports_select ON public.service_reports
  FOR SELECT TO authenticated USING (true);

CREATE POLICY reports_insert ON public.service_reports
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY reports_update ON public.service_reports
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY reports_delete ON public.service_reports
  FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin'));

-- ── 3. customers ──
DROP POLICY IF EXISTS customers_select ON public.customers;
DROP POLICY IF EXISTS customers_insert ON public.customers;
DROP POLICY IF EXISTS customers_update ON public.customers;
DROP POLICY IF EXISTS customers_delete ON public.customers;

CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY customers_insert ON public.customers
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY customers_update ON public.customers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY customers_delete ON public.customers
  FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) = 'Owner');
