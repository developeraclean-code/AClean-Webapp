-- ROLLBACK SNAPSHOT — kondisi policy SEBELUM migrasi 117-120 (diambil live 2026-07-03).
-- Jalankan file ini di Supabase SQL Editor untuk MENGEMBALIKAN policy ke kondisi
-- pra-hardening bila migrasi 117-120 menimbulkan masalah operasional.
-- CATATAN: file ini TIDAK menghapus policy baru bernama lain — drop dulu policy
-- baru (lihat nama policy di migrasi 118-120) sebelum menjalankan restore ini,
-- atau jalankan blok DO di bawah yang membersihkan semua policy di tabel terdampak.

-- ── Bersihkan SEMUA policy di tabel terdampak (termasuk policy baru 118-120) ──
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (
      'invoices','invoice_items','invoice_payments','payment_logs','quotations',
      'price_list','ac_price_list','order_bonuses','kasbon_requests',
      'user_profiles','weekly_payroll','orders','service_reports','customers')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Trigger guard dari migrasi 118 ikut dilepas saat rollback
DROP TRIGGER IF EXISTS trg_guard_user_profiles ON public.user_profiles;

-- ── Restore policy asli (dump pg_policies 2026-07-03) ──

CREATE POLICY ac_price_list_delete ON public.ac_price_list AS PERMISSIVE FOR DELETE TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY ac_price_list_insert_auth ON public.ac_price_list AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ac_price_list_select_anon ON public.ac_price_list AS PERMISSIVE FOR SELECT TO anon USING ((is_active = true));
CREATE POLICY ac_price_list_select_auth ON public.ac_price_list AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY ac_price_list_update ON public.ac_price_list AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));

CREATE POLICY customers_delete ON public.customers AS PERMISSIVE FOR DELETE TO public USING ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'service_role'::text])));
CREATE POLICY customers_insert ON public.customers AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'service_role'::text])));
CREATE POLICY customers_select ON public.customers AS PERMISSIVE FOR SELECT TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY customers_update ON public.customers AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));

CREATE POLICY auth_full_inv_items ON public.invoice_items AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY auth_full_invoice_payments ON public.invoice_payments AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY invoices_delete ON public.invoices AS PERMISSIVE FOR DELETE TO public USING ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'service_role'::text])));
CREATE POLICY invoices_insert ON public.invoices AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY invoices_select ON public.invoices AS PERMISSIVE FOR SELECT TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY invoices_update ON public.invoices AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));

CREATE POLICY auth_insert_kasbon ON public.kasbon_requests AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_read_kasbon ON public.kasbon_requests AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_update_kasbon ON public.kasbon_requests AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY auth_full_order_bonuses ON public.order_bonuses AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY orders_delete ON public.orders AS PERMISSIVE FOR DELETE TO public USING ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'service_role'::text])));
CREATE POLICY orders_insert ON public.orders AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY orders_select ON public.orders AS PERMISSIVE FOR SELECT TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY orders_update ON public.orders AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));

CREATE POLICY auth_full_payment ON public.payment_logs AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY price_list_delete ON public.price_list AS PERMISSIVE FOR DELETE TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY price_list_insert ON public.price_list AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY price_list_select_auth ON public.price_list AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY price_list_update ON public.price_list AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));

CREATE POLICY auth_full_quotations ON public.quotations AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY reports_delete ON public.service_reports AS PERMISSIVE FOR DELETE TO public USING ((( SELECT auth.role() AS role) = ANY (ARRAY['authenticated'::text, 'service_role'::text])));
CREATE POLICY reports_insert ON public.service_reports AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY reports_select ON public.service_reports AS PERMISSIVE FOR SELECT TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY reports_update ON public.service_reports AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));

CREATE POLICY "Authenticated insert user_profiles" ON public.user_profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY "Authenticated read user_profiles" ON public.user_profiles AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated update user_profiles" ON public.user_profiles AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY "Service role manage user_profiles" ON public.user_profiles AS PERMISSIVE FOR ALL TO public USING ((( SELECT auth.role() AS role) = 'service_role'::text));

CREATE POLICY auth_delete_weekly_payroll ON public.weekly_payroll AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY auth_read_weekly_payroll ON public.weekly_payroll AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_update_weekly_payroll ON public.weekly_payroll AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_write_weekly_payroll ON public.weekly_payroll AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
