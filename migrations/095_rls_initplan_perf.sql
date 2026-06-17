-- Migration 095: Fix auth_rls_initplan performance warnings (Supabase Advisor)
-- Wraps auth.uid() / auth.role() calls in RLS policies with (select ...) so
-- Postgres evaluates them once per query instead of once per row.
-- Pure performance fix — access semantics are unchanged.
-- Affects 23 tables / ~52 policy clauses flagged by Supabase performance advisor.

-- ac_price_list
ALTER POLICY ac_price_list_delete ON ac_price_list
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY ac_price_list_update ON ac_price_list
  USING ((select auth.role()) = 'authenticated');

-- ai_usage
ALTER POLICY ai_usage_read_authenticated ON ai_usage
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY ai_usage_write_service ON ai_usage
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- app_settings
ALTER POLICY app_settings_select ON app_settings
  USING ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'anon'::text, 'service_role'::text]));
ALTER POLICY app_settings_write ON app_settings
  USING ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));

-- ara_brain
ALTER POLICY "Allow authenticated read" ON ara_brain
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY ara_brain_write ON ara_brain
  USING ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));

-- cron_runs
ALTER POLICY cron_runs_read_authenticated ON cron_runs
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY cron_runs_write_service ON cron_runs
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- customer_tokens
ALTER POLICY tokens_service_only ON customer_tokens
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

-- customers
ALTER POLICY customers_delete ON customers
  USING ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));
ALTER POLICY customers_insert ON customers
  WITH CHECK ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));
ALTER POLICY customers_select ON customers
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY customers_update ON customers
  USING ((select auth.role()) = 'authenticated');

-- dispatch_logs
ALTER POLICY dispatch_logs_all ON dispatch_logs
  USING ((select auth.role()) = 'authenticated');

-- expenses
ALTER POLICY expenses_delete_owner_admin ON expenses
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Owner'::text, 'Admin'::text])
  ));
ALTER POLICY expenses_insert_owner_admin ON expenses
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Owner'::text, 'Admin'::text])
  ));
ALTER POLICY expenses_select_owner_admin ON expenses
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Owner'::text, 'Admin'::text])
  ));
ALTER POLICY expenses_update_owner_admin ON expenses
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Owner'::text, 'Admin'::text])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Owner'::text, 'Admin'::text])
  ));

-- inventory
ALTER POLICY inventory_all ON inventory
  USING ((select auth.role()) = 'authenticated');

-- inventory_transactions
ALTER POLICY inv_tx_all ON inventory_transactions
  USING ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));

-- invoices
ALTER POLICY invoices_delete ON invoices
  USING ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));
ALTER POLICY invoices_insert ON invoices
  WITH CHECK ((select auth.role()) = 'authenticated');
ALTER POLICY invoices_select ON invoices
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY invoices_update ON invoices
  USING ((select auth.role()) = 'authenticated');

-- log_cleanup_audit
ALTER POLICY cleanup_audit_select ON log_cleanup_audit
  USING ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));

-- merged_pdf_cache
ALTER POLICY merged_cache_insert ON merged_pdf_cache
  WITH CHECK ((select auth.role()) = 'authenticated');
ALTER POLICY merged_cache_select ON merged_pdf_cache
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY merged_cache_update ON merged_pdf_cache
  USING ((select auth.role()) = 'authenticated')
  WITH CHECK ((select auth.role()) = 'authenticated');

-- mutasi_checklist
ALTER POLICY finance_owner_delete ON mutasi_checklist
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Finance'::text, 'Owner'::text])
      AND user_profiles.active = true
  ));
ALTER POLICY finance_owner_insert ON mutasi_checklist
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Finance'::text, 'Owner'::text])
      AND user_profiles.active = true
  ));
ALTER POLICY finance_owner_select ON mutasi_checklist
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Finance'::text, 'Owner'::text, 'Admin'::text])
      AND user_profiles.active = true
  ));
ALTER POLICY finance_owner_update ON mutasi_checklist
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Finance'::text, 'Owner'::text])
      AND user_profiles.active = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Finance'::text, 'Owner'::text])
      AND user_profiles.active = true
  ));

-- orders
ALTER POLICY orders_delete ON orders
  USING ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));
ALTER POLICY orders_insert ON orders
  WITH CHECK ((select auth.role()) = 'authenticated');
ALTER POLICY orders_select ON orders
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY orders_update ON orders
  USING ((select auth.role()) = 'authenticated');

-- payments
ALTER POLICY payments_all ON payments
  USING ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));

-- price_list
ALTER POLICY price_list_delete ON price_list
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY price_list_insert ON price_list
  WITH CHECK ((select auth.role()) = 'authenticated');
ALTER POLICY price_list_update ON price_list
  USING ((select auth.role()) = 'authenticated');

-- service_reports
ALTER POLICY reports_delete ON service_reports
  USING ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));
ALTER POLICY reports_insert ON service_reports
  WITH CHECK ((select auth.role()) = 'authenticated');
ALTER POLICY reports_select ON service_reports
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY reports_update ON service_reports
  USING ((select auth.role()) = 'authenticated');

-- technician_schedule
ALTER POLICY schedule_all ON technician_schedule
  USING ((select auth.role()) = 'authenticated');

-- user_profiles
ALTER POLICY "Authenticated insert user_profiles" ON user_profiles
  WITH CHECK ((select auth.role()) = 'authenticated');
ALTER POLICY "Authenticated update user_profiles" ON user_profiles
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY "Service role manage user_profiles" ON user_profiles
  USING ((select auth.role()) = 'service_role');

-- wa_conversations
ALTER POLICY wa_conv_all ON wa_conversations
  USING ((select auth.role()) = ANY (ARRAY['authenticated'::text, 'service_role'::text]));

-- wa_messages
ALTER POLICY wa_msg_select ON wa_messages
  USING ((select auth.role()) = 'authenticated');
