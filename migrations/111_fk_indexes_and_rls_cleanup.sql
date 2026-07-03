-- 111_fk_indexes_and_rls_cleanup.sql
-- Tambah FK indexes yang hilang (16 unindexed_foreign_keys di public schema).
-- Mengurangi seq scan saat JOIN/ON DELETE CASCADE ke tabel referensi.
-- IF NOT EXISTS = idempotent, aman diulang.

CREATE INDEX IF NOT EXISTS idx_orders_created_by
  ON public.orders(created_by);

CREATE INDEX IF NOT EXISTS idx_invoices_created_by
  ON public.invoices(created_by);

CREATE INDEX IF NOT EXISTS idx_inv_tx_created_by
  ON public.inventory_transactions(created_by);

CREATE INDEX IF NOT EXISTS idx_inv_tx_order_id
  ON public.inventory_transactions(order_id);

CREATE INDEX IF NOT EXISTS idx_inv_tx_unit_id
  ON public.inventory_transactions(unit_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_assigned_by
  ON public.dispatch_logs(assigned_by);

CREATE INDEX IF NOT EXISTS idx_tech_schedule_teknisi_id
  ON public.technician_schedule(teknisi_id);

CREATE INDEX IF NOT EXISTS idx_agent_logs_user_id
  ON public.agent_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_payment_logs_customer_id
  ON public.payment_logs(customer_id);

CREATE INDEX IF NOT EXISTS idx_expenses_ai_extraction_id
  ON public.expenses(ai_extraction_id);

CREATE INDEX IF NOT EXISTS idx_pay_sugg_ai_extraction_id
  ON public.payment_suggestions(ai_extraction_id);

CREATE INDEX IF NOT EXISTS idx_sheet_imports_order_id
  ON public.sheet_schedule_imports(order_id);

CREATE INDEX IF NOT EXISTS idx_maint_followups_log_id
  ON public.maintenance_followups(log_id);

CREATE INDEX IF NOT EXISTS idx_maint_wo_contract_id
  ON public.maintenance_work_orders(contract_id);

CREATE INDEX IF NOT EXISTS idx_maint_wo_followup_id
  ON public.maintenance_work_orders(followup_id);

-- Bersihkan policy duplikat di ac_units: ac_units_auth_all dan auth_full_ac_units
-- keduanya adalah ALL USING (true) → multiple_permissive_policies warning.
-- Pertahankan auth_full_ac_units (nama lebih konsisten dengan konvensi tabel lain).
DROP POLICY IF EXISTS "ac_units_auth_all" ON public.ac_units;
