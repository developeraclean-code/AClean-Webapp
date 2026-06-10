-- Quick Win 6 — Mass RLS lockdown: anon/public → authenticated only
-- Untuk semua tabel internal (non-website). Anon key di bundle frontend tidak
-- boleh lagi SELECT/INSERT/UPDATE tanpa login.
--
-- EXCEPTIONS (tetap allow anon utk public-facing landing page):
--   - website_orders (INSERT anon — public booking)
--   - website_settings (SELECT anon — public landing read)
--   - log_cleanup_audit (INSERT public — internal trigger writes via service_role anyway)
--   - merged_pdf_cache (INSERT public — cron writes)
--   - customers (INSERT public — webhook receive-wa)
--   - invoices (INSERT public — webhook + ARA action)
--   - orders (INSERT public — webhook + ARA action)
--   - service_reports (INSERT public — webhook)
--   - user_profiles (INSERT public — first-time auth signup)
--   - mutasi_checklist (INSERT public — webhook)
--
-- NOTE: kalau policy public hanya untuk SELECT/UPDATE/DELETE, tidak ada justifikasi
--       public-facing → convert ke authenticated.

BEGIN;

-- ═══ ac_price_list ═══
DROP POLICY IF EXISTS ac_price_list_select ON ac_price_list;
CREATE POLICY ac_price_list_select_auth ON ac_price_list FOR SELECT TO authenticated USING (true);
-- ac_price_list_insert public → keep (cron seeds)? service_role bypass, no anon need
DROP POLICY IF EXISTS ac_price_list_insert ON ac_price_list;
CREATE POLICY ac_price_list_insert_auth ON ac_price_list FOR INSERT TO authenticated WITH CHECK (true);

-- ═══ ara_brain ═══
DROP POLICY IF EXISTS ara_brain_select ON ara_brain;
CREATE POLICY ara_brain_select_auth ON ara_brain FOR SELECT TO authenticated USING (true);

-- ═══ customer_feedback ═══
DROP POLICY IF EXISTS service_full ON customer_feedback;
CREATE POLICY auth_full_customer_feedback ON customer_feedback FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ customer_vouchers ═══
DROP POLICY IF EXISTS service_full ON customer_vouchers;
CREATE POLICY auth_full_customer_vouchers ON customer_vouchers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ inventory_units ═══
DROP POLICY IF EXISTS "Owner Admin full access" ON inventory_units;
CREATE POLICY auth_full_inventory_units ON inventory_units FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ invoice_payments ═══
DROP POLICY IF EXISTS service_full ON invoice_payments;
CREATE POLICY auth_full_invoice_payments ON invoice_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ price_list ═══
DROP POLICY IF EXISTS price_list_select ON price_list;
CREATE POLICY price_list_select_auth ON price_list FOR SELECT TO authenticated USING (true);

-- ═══ quotations ═══
DROP POLICY IF EXISTS service_full ON quotations;
CREATE POLICY auth_full_quotations ON quotations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ team_daily_helper ═══
DROP POLICY IF EXISTS write_team_daily_helper ON team_daily_helper;
DROP POLICY IF EXISTS read_team_daily_helper ON team_daily_helper;
CREATE POLICY auth_full_team_daily_helper ON team_daily_helper FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ team_presets ═══
DROP POLICY IF EXISTS write_team_presets ON team_presets;
DROP POLICY IF EXISTS read_team_presets ON team_presets;
CREATE POLICY auth_full_team_presets ON team_presets FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ tool_bag_checklist ═══
DROP POLICY IF EXISTS service_full ON tool_bag_checklist;
CREATE POLICY auth_full_tool_bag_checklist ON tool_bag_checklist FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ tool_bag_checks ═══
DROP POLICY IF EXISTS service_full ON tool_bag_checks;
CREATE POLICY auth_full_tool_bag_checks ON tool_bag_checks FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ wa_conversations ═══
DROP POLICY IF EXISTS allow_all_wa_conv ON wa_conversations;
DROP POLICY IF EXISTS allow_read_wa_conv ON wa_conversations;
CREATE POLICY auth_full_wa_conversations ON wa_conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ wa_group_logs ═══
DROP POLICY IF EXISTS anon_select ON wa_group_logs;
DROP POLICY IF EXISTS service_full ON wa_group_logs;
CREATE POLICY auth_full_wa_group_logs ON wa_group_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ wa_messages ═══
DROP POLICY IF EXISTS allow_all_wa_msg ON wa_messages;
DROP POLICY IF EXISTS wa_msg_insert ON wa_messages;
DROP POLICY IF EXISTS allow_read_wa_msg ON wa_messages;
CREATE POLICY auth_full_wa_messages ON wa_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ wa_webhook_dedup ═══
DROP POLICY IF EXISTS service_full ON wa_webhook_dedup;
CREATE POLICY auth_full_wa_webhook_dedup ON wa_webhook_dedup FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ ai_extractions ═══
DROP POLICY IF EXISTS ai_extract_all ON ai_extractions;
CREATE POLICY auth_full_ai_extractions ON ai_extractions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ job_materials_brought ═══
DROP POLICY IF EXISTS jmb_delete_all ON job_materials_brought;
DROP POLICY IF EXISTS jmb_insert_all ON job_materials_brought;
DROP POLICY IF EXISTS jmb_select_all ON job_materials_brought;
DROP POLICY IF EXISTS jmb_update_all ON job_materials_brought;
CREATE POLICY auth_full_job_materials_brought ON job_materials_brought FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ order_bonuses ═══
DROP POLICY IF EXISTS allow_all_order_bonuses ON order_bonuses;
CREATE POLICY auth_full_order_bonuses ON order_bonuses FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ wa_group_discovery ═══
DROP POLICY IF EXISTS wgd_anon_all ON wa_group_discovery;
CREATE POLICY auth_full_wa_group_discovery ON wa_group_discovery FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ wa_monitored_groups ═══
DROP POLICY IF EXISTS wmg_anon_all ON wa_monitored_groups;
CREATE POLICY auth_full_wa_monitored_groups ON wa_monitored_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ wa_webhook_raw ═══
DROP POLICY IF EXISTS wwr_anon_all ON wa_webhook_raw;
CREATE POLICY auth_full_wa_webhook_raw ON wa_webhook_raw FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ═══ project_* tables (internal, lock all) ═══
-- Loop: drop 3 anon policies + create 1 authenticated full per table
DROP POLICY IF EXISTS project_alokasi_insert_anon ON project_alokasi;
DROP POLICY IF EXISTS project_alokasi_select_anon ON project_alokasi;
DROP POLICY IF EXISTS project_alokasi_update_anon ON project_alokasi;
CREATE POLICY auth_full_project_alokasi ON project_alokasi FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS project_documents_insert_anon ON project_documents;
DROP POLICY IF EXISTS project_documents_select_anon ON project_documents;
DROP POLICY IF EXISTS project_documents_update_anon ON project_documents;
CREATE POLICY auth_full_project_documents ON project_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS project_dp_insert_anon ON project_dp;
DROP POLICY IF EXISTS project_dp_select_anon ON project_dp;
DROP POLICY IF EXISTS project_dp_update_anon ON project_dp;
CREATE POLICY auth_full_project_dp ON project_dp FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS project_expenses_insert_anon ON project_expenses;
DROP POLICY IF EXISTS project_expenses_select_anon ON project_expenses;
DROP POLICY IF EXISTS project_expenses_update_anon ON project_expenses;
CREATE POLICY auth_full_project_expenses ON project_expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS project_harian_insert_anon ON project_harian;
DROP POLICY IF EXISTS project_harian_select_anon ON project_harian;
DROP POLICY IF EXISTS project_harian_update_anon ON project_harian;
CREATE POLICY auth_full_project_harian ON project_harian FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS project_materials_insert_anon ON project_materials;
DROP POLICY IF EXISTS project_materials_select_anon ON project_materials;
DROP POLICY IF EXISTS project_materials_update_anon ON project_materials;
CREATE POLICY auth_full_project_materials ON project_materials FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS project_projects_insert_anon ON project_projects;
DROP POLICY IF EXISTS project_projects_select_anon ON project_projects;
DROP POLICY IF EXISTS project_projects_update_anon ON project_projects;
CREATE POLICY auth_full_project_projects ON project_projects FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS project_purchases_insert_anon ON project_purchases;
DROP POLICY IF EXISTS project_purchases_select_anon ON project_purchases;
DROP POLICY IF EXISTS project_purchases_update_anon ON project_purchases;
CREATE POLICY auth_full_project_purchases ON project_purchases FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS project_tools_insert_anon ON project_tools;
DROP POLICY IF EXISTS project_tools_select_anon ON project_tools;
DROP POLICY IF EXISTS project_tools_update_anon ON project_tools;
CREATE POLICY auth_full_project_tools ON project_tools FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS project_usage_insert_anon ON project_usage;
DROP POLICY IF EXISTS project_usage_select_anon ON project_usage;
DROP POLICY IF EXISTS project_usage_update_anon ON project_usage;
CREATE POLICY auth_full_project_usage ON project_usage FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
