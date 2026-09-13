-- Migration 168: Monitoring + Biaya hardening dan efisiensi.
-- Additive dan idempotent. Tidak mengubah nominal expense historis.

BEGIN;

-- Tutup jejak RUNNING lama akibat function timeout/crash. Ini hanya metadata monitoring.
UPDATE public.cron_runs
SET status = 'TIMEOUT', finished_at = now(),
    error_message = coalesce(error_message, 'Auto-closed by migration 168: stale >1 hour')
WHERE status = 'RUNNING' AND started_at < now() - interval '1 hour';

-- ── A. Metadata sumber dan keputusan alokasi biaya ─────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS allocation_status text DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS allocation_notes text;

COMMENT ON COLUMN public.expenses.source IS
  'Asal entri: manual, technician_app, wa_ai, kasbon, restock, system.';
COMMENT ON COLUMN public.expenses.source_ref IS
  'ID stabil dari sumber untuk idempotensi; bukan pencocokan nominal/tanggal.';
COMMENT ON COLUMN public.expenses.allocation_status IS
  'Material: UNRESOLVED, STOCK, JOB, NON_STOCK. Petty cash: NOT_REQUIRED.';

UPDATE public.expenses
SET allocation_status = CASE
  WHEN category <> 'material_purchase' THEN 'NOT_REQUIRED'
  WHEN stock_linked_at IS NOT NULL THEN 'STOCK'
  WHEN order_id IS NOT NULL THEN 'JOB'
  ELSE 'UNRESOLVED'
END
WHERE allocation_status IS NULL
   OR (category = 'material_purchase' AND allocation_status = 'NOT_REQUIRED');

UPDATE public.expenses
SET source = CASE
  WHEN lower(coalesce(created_by, '')) LIKE '%wa_group%' THEN 'wa_ai'
  WHEN lower(coalesce(created_by, '')) LIKE '%teknisi%' THEN 'technician_app'
  WHEN lower(coalesce(created_by, '')) LIKE '%system%' THEN 'system'
  ELSE coalesce(source, 'manual')
END
WHERE source IS NULL OR source = 'manual';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_expenses_source') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT chk_expenses_source
      CHECK (source IN ('manual','technician_app','wa_ai','kasbon','restock','system')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_expenses_allocation_status') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT chk_expenses_allocation_status
      CHECK (allocation_status IN ('NOT_REQUIRED','UNRESOLVED','STOCK','JOB','NON_STOCK')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_active_category_date
  ON public.expenses (category, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_allocation_unresolved
  ON public.expenses (date DESC)
  WHERE deleted_at IS NULL AND allocation_status = 'UNRESOLVED';
CREATE INDEX IF NOT EXISTS idx_expenses_source_ref
  ON public.expenses (source, source_ref) WHERE source_ref IS NOT NULL;

-- ── B. Approval Admin >= Rp500.000 dipaksa di database ─────────────────────
CREATE OR REPLACE FUNCTION public.enforce_expense_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
BEGIN
  IF actor_id IS NOT NULL THEN
    SELECT role INTO actor_role FROM public.user_profiles WHERE id = actor_id;
    NEW.created_by_user_id := coalesce(NEW.created_by_user_id, actor_id);
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.source := CASE
      WHEN lower(coalesce(NEW.created_by,'')) LIKE 'wa%kasbon%' THEN 'kasbon'
      WHEN lower(coalesce(NEW.created_by,'')) LIKE 'wa[_]%' THEN 'wa_ai'
      WHEN lower(coalesce(NEW.created_by,'')) LIKE 'system%' THEN 'system'
      ELSE coalesce(nullif(NEW.source, ''), 'manual')
    END;
    IF NEW.source <> 'manual' THEN NEW.source_ref := coalesce(NEW.source_ref, NEW.dedup_key); END IF;
    IF NEW.category = 'material_purchase' THEN
      NEW.allocation_status := CASE
        WHEN NEW.stock_linked_at IS NOT NULL THEN 'STOCK'
        WHEN NEW.order_id IS NOT NULL THEN 'JOB'
        WHEN NEW.allocation_status IN ('NON_STOCK','STOCK','JOB') THEN NEW.allocation_status
        ELSE 'UNRESOLVED'
      END;
    ELSE
      NEW.allocation_status := 'NOT_REQUIRED';
    END IF;
  END IF;

  -- Admin tidak boleh membuat/mengubah biaya besar menjadi langsung approved,
  -- maupun menyetujui sendiri row yang sedang pending melalui REST/console.
  IF actor_role = 'Admin' THEN
    IF TG_OP = 'INSERT' AND NEW.amount >= 500000 THEN
      NEW.approval_status := 'PENDING_APPROVAL';
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.approval_status = 'PENDING_APPROVAL'
         AND NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
        RAISE EXCEPTION 'Admin tidak boleh menyetujui/menolak biaya besar miliknya sendiri'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.amount >= 500000
         AND (NEW.amount IS DISTINCT FROM OLD.amount
              OR NEW.category IS DISTINCT FROM OLD.category
              OR NEW.subcategory IS DISTINCT FROM OLD.subcategory) THEN
        NEW.approval_status := 'PENDING_APPROVAL';
        NEW.approved_by := NULL;
        NEW.approved_at := NULL;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_expense_approval ON public.expenses;
CREATE TRIGGER trg_enforce_expense_approval
  BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_expense_approval();

REVOKE EXECUTE ON FUNCTION public.enforce_expense_approval() FROM PUBLIC, anon;

-- Status expense dan hasil ekstraksi AI harus bergerak dalam transaksi yang sama.
CREATE OR REPLACE FUNCTION public.sync_expense_ai_review_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.ai_extraction_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.ai_extractions SET status = 'rejected' WHERE id = NEW.ai_extraction_id;
  ELSIF NEW.validation_status = 'APPROVED' AND OLD.validation_status IS DISTINCT FROM 'APPROVED' THEN
    UPDATE public.ai_extractions SET status = 'approved' WHERE id = NEW.ai_extraction_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_expense_ai_review_status ON public.expenses;
CREATE TRIGGER trg_sync_expense_ai_review_status
  AFTER UPDATE OF validation_status, deleted_at ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.sync_expense_ai_review_status();

REVOKE EXECUTE ON FUNCTION public.sync_expense_ai_review_status() FROM PUBLIC, anon;

-- ── C. Budget bulanan, bukan satu JSON global ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.expense_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  category text NOT NULL,
  subcategory text NOT NULL DEFAULT '',
  amount numeric NOT NULL CHECK (amount > 0),
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_month, category, subcategory)
);

ALTER TABLE public.expense_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expense_budgets_select_finance ON public.expense_budgets;
CREATE POLICY expense_budgets_select_finance ON public.expense_budgets FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('Owner','Admin','Finance'));
DROP POLICY IF EXISTS expense_budgets_write_owner ON public.expense_budgets;
CREATE POLICY expense_budgets_write_owner ON public.expense_budgets FOR ALL TO authenticated
  USING (public.get_my_role() = 'Owner')
  WITH CHECK (public.get_my_role() = 'Owner');

-- ── D. Satu RPC untuk halaman Biaya: rows + total + antrean ────────────────
CREATE OR REPLACE FUNCTION public.get_expense_workspace(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_subcategory text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  result jsonb;
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
BEGIN
  IF public.get_my_role() NOT IN ('Owner','Admin','Finance') THEN
    RAISE EXCEPTION 'Akses Biaya ditolak' USING ERRCODE = '42501';
  END IF;

  WITH filtered AS (
    SELECT e.*
    FROM public.expenses e
    WHERE e.deleted_at IS NULL
      AND e.validation_status IS DISTINCT FROM 'PENDING_AI'
      AND (p_date_from IS NULL OR e.date >= p_date_from)
      AND (p_date_to IS NULL OR e.date <= p_date_to)
      AND (p_category IS NULL OR e.category = p_category)
      AND (p_subcategory IS NULL OR e.subcategory = p_subcategory)
      AND (nullif(trim(p_search), '') IS NULL OR concat_ws(' ', e.description, e.subcategory, e.teknisi_name, e.item_name) ILIKE '%' || trim(p_search) || '%')
  ), page_rows AS (
    SELECT * FROM filtered
    ORDER BY date DESC, created_at DESC
    OFFSET (safe_page - 1) * safe_size LIMIT safe_size
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.date DESC, p.created_at DESC) FROM page_rows p), '[]'::jsonb),
    'total_count', (SELECT count(*) FROM filtered),
    'total_amount', coalesce((SELECT sum(amount) FROM filtered WHERE approval_status IS DISTINCT FROM 'PENDING_APPROVAL'), 0),
    'pending_approval_count', (SELECT count(*) FROM public.expenses WHERE deleted_at IS NULL AND approval_status = 'PENDING_APPROVAL'),
    'pending_approval_amount', coalesce((SELECT sum(amount) FROM public.expenses WHERE deleted_at IS NULL AND approval_status = 'PENDING_APPROVAL'), 0),
    'pending_ai_count', (SELECT count(*) FROM public.expenses WHERE deleted_at IS NULL AND validation_status = 'PENDING_AI'),
    'pending_ai_over_24h', (SELECT count(*) FROM public.expenses WHERE deleted_at IS NULL AND validation_status = 'PENDING_AI' AND created_at < now() - interval '24 hours'),
    'unresolved_material_count', (SELECT count(*) FROM public.expenses WHERE deleted_at IS NULL AND category = 'material_purchase' AND allocation_status = 'UNRESOLVED'),
    'duplicate_warning_count', (SELECT count(*) FROM (
      SELECT date,amount,category,subcategory,lower(trim(coalesce(teknisi_name,item_name,''))) actor_item
      FROM public.expenses WHERE deleted_at IS NULL
      GROUP BY date,amount,category,subcategory,lower(trim(coalesce(teknisi_name,item_name,''))) HAVING count(*) > 1
    ) duplicate_groups),
    'legacy_admin_high_without_review', (SELECT count(*) FROM public.expenses e
      WHERE e.deleted_at IS NULL AND e.amount >= 500000
        AND e.approval_status = 'APPROVED' AND e.approved_at IS NULL
        AND EXISTS (SELECT 1 FROM public.user_profiles u
          WHERE u.role = 'Admin' AND lower(trim(u.name)) = lower(trim(e.created_by)))),
    'budget_spend', coalesce((SELECT jsonb_object_agg(k,total) FROM (
      SELECT category AS k, sum(amount) AS total FROM public.expenses
      WHERE deleted_at IS NULL AND approval_status IS DISTINCT FROM 'PENDING_APPROVAL'
        AND validation_status IS DISTINCT FROM 'PENDING_AI' AND date_trunc('month',date) = date_trunc('month',current_date)
      GROUP BY category
      UNION ALL
      SELECT category || '::' || subcategory AS k, sum(amount) AS total FROM public.expenses
      WHERE deleted_at IS NULL AND approval_status IS DISTINCT FROM 'PENDING_APPROVAL'
        AND validation_status IS DISTINCT FROM 'PENDING_AI' AND date_trunc('month',date) = date_trunc('month',current_date)
        AND subcategory IS NOT NULL GROUP BY category, subcategory
    ) budget_rows), '{}'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_expense_workspace(date,date,text,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_expense_workspace(date,date,text,text,text,integer,integer) TO authenticated, service_role;

-- ── E. Snapshot Monitoring exact; detail tetap dipaginasi ──────────────────
CREATE OR REPLACE FUNCTION public.get_monitoring_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE result jsonb;
BEGIN
  IF auth.role() <> 'service_role' AND public.get_my_role() NOT IN ('Owner','Admin') THEN
    RAISE EXCEPTION 'Akses Monitoring ditolak' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'logs', jsonb_build_object(
      'total_24h', (SELECT count(*) FROM public.agent_logs WHERE created_at >= now() - interval '24 hours'),
      'errors_24h', (SELECT count(*) FROM public.agent_logs WHERE created_at >= now() - interval '24 hours' AND (status = 'ERROR' OR severity IN ('error','critical'))),
      'warnings_24h', (SELECT count(*) FROM public.agent_logs WHERE created_at >= now() - interval '24 hours' AND (status = 'WARNING' OR severity = 'warn')),
      'recent_problems', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
        SELECT action, status, severity, category, left(coalesce(detail,''),200) AS detail, created_at
        FROM public.agent_logs
        WHERE created_at >= now() - interval '24 hours'
          AND (status IN ('ERROR','WARNING') OR severity IN ('error','warn','critical'))
        ORDER BY created_at DESC LIMIT 10
      ) x), '[]'::jsonb)
    ),
    'cron', jsonb_build_object(
      'total_7d', (SELECT count(*) FROM public.cron_runs WHERE started_at >= now() - interval '7 days'),
      'success_7d', (SELECT count(*) FROM public.cron_runs WHERE started_at >= now() - interval '7 days' AND status = 'SUCCESS'),
      'failed_7d', (SELECT count(*) FROM public.cron_runs WHERE started_at >= now() - interval '7 days' AND status IN ('FAILED','TIMEOUT')),
      'skipped_7d', (SELECT count(*) FROM public.cron_runs WHERE started_at >= now() - interval '7 days' AND status = 'SKIPPED'),
      'running_7d', (SELECT count(*) FROM public.cron_runs WHERE started_at >= now() - interval '7 days' AND status = 'RUNNING'),
      'failed_24h', (SELECT count(*) FROM public.cron_runs WHERE started_at >= now() - interval '24 hours' AND status IN ('FAILED','TIMEOUT')),
      'stale_running', (SELECT count(*) FROM public.cron_runs WHERE status = 'RUNNING' AND started_at < now() - interval '1 hour'),
      'recent', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.started_at DESC) FROM (
        SELECT task_name, status, duration_ms, items_processed, error_message, started_at
        FROM public.cron_runs WHERE started_at >= now() - interval '7 days'
        ORDER BY started_at DESC LIMIT 20
      ) x), '[]'::jsonb),
      'latest_by_task', coalesce((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.task_name) FROM (
          SELECT DISTINCT ON (task_name) task_name, status, started_at, finished_at, duration_ms, items_processed
          FROM public.cron_runs ORDER BY task_name, started_at DESC
        ) x
      ), '[]'::jsonb)
    ),
    'ai', jsonb_build_object(
      'calls_30d', (SELECT count(*) FROM public.ai_usage WHERE created_at >= now() - interval '30 days'),
      'cost_30d', coalesce((SELECT sum(cost_usd) FROM public.ai_usage WHERE created_at >= now() - interval '30 days'), 0),
      'errors_30d', (SELECT count(*) FROM public.ai_usage WHERE created_at >= now() - interval '30 days' AND error IS NOT NULL),
      'by_provider_30d', coalesce((SELECT jsonb_object_agg(provider, payload) FROM (
        SELECT coalesce(provider,'unknown') provider,
          jsonb_build_object('calls',count(*),'cost',round(coalesce(sum(cost_usd),0)::numeric,4),'input_tokens',coalesce(sum(input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0)) payload
        FROM public.ai_usage WHERE created_at >= now() - interval '30 days'
        GROUP BY coalesce(provider,'unknown')
      ) p), '{}'::jsonb)
    ),
    'expenses', jsonb_build_object(
      'pending_ai', (SELECT count(*) FROM public.expenses WHERE deleted_at IS NULL AND validation_status = 'PENDING_AI'),
      'pending_ai_over_24h', (SELECT count(*) FROM public.expenses WHERE deleted_at IS NULL AND validation_status = 'PENDING_AI' AND created_at < now() - interval '24 hours'),
      'pending_approval', (SELECT count(*) FROM public.expenses WHERE deleted_at IS NULL AND approval_status = 'PENDING_APPROVAL'),
      'unresolved_material', (SELECT count(*) FROM public.expenses WHERE deleted_at IS NULL AND category = 'material_purchase' AND allocation_status = 'UNRESOLVED'),
      'duplicate_warnings', (SELECT count(*) FROM (
        SELECT date,amount,category,subcategory,lower(trim(coalesce(teknisi_name,item_name,''))) actor_item
        FROM public.expenses WHERE deleted_at IS NULL
        GROUP BY date,amount,category,subcategory,lower(trim(coalesce(teknisi_name,item_name,''))) HAVING count(*) > 1
      ) duplicate_groups),
      'legacy_admin_high_without_review', (SELECT count(*) FROM public.expenses e
        WHERE e.deleted_at IS NULL AND e.amount >= 500000
          AND e.approval_status = 'APPROVED' AND e.approved_at IS NULL
          AND EXISTS (SELECT 1 FROM public.user_profiles u
            WHERE u.role = 'Admin' AND lower(trim(u.name)) = lower(trim(e.created_by))))
    ),
    'infra_raw', (SELECT value FROM public.app_settings WHERE key = 'infra_usage_snapshot' LIMIT 1)
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_monitoring_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_monitoring_snapshot() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_ai_usage_summary(p_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE result jsonb; cutoff timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days,7),1),90));
BEGIN
  IF public.get_my_role() NOT IN ('Owner','Admin') THEN RAISE EXCEPTION 'Akses Monitoring ditolak' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'total_calls', count(*), 'total_cost', coalesce(sum(cost_usd),0),
    'input_tokens', coalesce(sum(input_tokens),0), 'output_tokens', coalesce(sum(output_tokens),0),
    'errors', count(*) FILTER (WHERE error IS NOT NULL),
    'by_provider', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.cost DESC) FROM (
        SELECT coalesce(provider,'unknown') name,count(*) calls,coalesce(sum(cost_usd),0) cost,coalesce(sum(input_tokens),0) input,coalesce(sum(output_tokens),0) output
      FROM public.ai_usage WHERE created_at >= cutoff GROUP BY coalesce(provider,'unknown')) x),'[]'::jsonb),
    'by_feature', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.cost DESC) FROM (
      SELECT coalesce(feature,'unknown') name,count(*) calls,coalesce(sum(cost_usd),0) cost
      FROM public.ai_usage WHERE created_at >= cutoff GROUP BY coalesce(feature,'unknown')) x),'[]'::jsonb),
    'by_day', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.usage_day DESC) FROM (
      SELECT created_at::date AS usage_day,count(*) calls,coalesce(sum(cost_usd),0) cost
      FROM public.ai_usage WHERE created_at >= cutoff GROUP BY created_at::date) x),'[]'::jsonb)
  ) INTO result FROM public.ai_usage WHERE created_at >= cutoff;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_ai_usage_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_usage_summary(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_cron_monitor_summary(p_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE result jsonb; cutoff timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days,7),1),30));
BEGIN
  IF public.get_my_role() NOT IN ('Owner','Admin') THEN RAISE EXCEPTION 'Akses Monitoring ditolak' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'tasks', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.task_name) FROM (
      SELECT task_name,count(*) total,count(*) FILTER(WHERE status='SUCCESS') success,count(*) FILTER(WHERE status IN ('FAILED','TIMEOUT')) failed,
        count(*) FILTER(WHERE status='SKIPPED') skipped,count(*) FILTER(WHERE status='RUNNING') running,
        round(avg(duration_ms)) avg_duration
      FROM public.cron_runs WHERE started_at >= cutoff GROUP BY task_name) x),'[]'::jsonb),
    'recent', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.started_at DESC) FROM (
      SELECT id,task_name,status,duration_ms,error_message,items_processed,started_at,finished_at,
        (status='RUNNING' AND started_at < now()-interval '1 hour') stale
      FROM public.cron_runs WHERE started_at >= cutoff ORDER BY started_at DESC LIMIT 100) x),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_cron_monitor_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cron_monitor_summary(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_agent_logs_page(
  p_days integer DEFAULT 1, p_severity text DEFAULT NULL, p_category text DEFAULT NULL,
  p_page integer DEFAULT 1, p_page_size integer DEFAULT 20
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE result jsonb; cutoff timestamptz := now()-make_interval(days=>least(greatest(coalesce(p_days,1),1),90)); safe_page integer:=greatest(coalesce(p_page,1),1); safe_size integer:=least(greatest(coalesce(p_page_size,20),1),100);
BEGIN
  IF public.get_my_role() NOT IN ('Owner','Admin') THEN RAISE EXCEPTION 'Akses Monitoring ditolak' USING ERRCODE='42501'; END IF;
  WITH filtered AS (
    SELECT * FROM public.agent_logs WHERE created_at>=cutoff
      AND (p_severity IS NULL OR severity=p_severity)
      AND (p_category IS NULL OR category=p_category)
  ), rows AS (
    SELECT id,action,status,severity,category,detail,created_at FROM filtered
    ORDER BY created_at DESC OFFSET (safe_page-1)*safe_size LIMIT safe_size
  ) SELECT jsonb_build_object('total_count',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC) FROM rows r),'[]'::jsonb)) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_agent_logs_page(integer,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agent_logs_page(integer,text,text,integer,integer) TO authenticated;

-- ── F. Nota -> stok atomik; trigger inventory transaction menaikkan stok ───
CREATE OR REPLACE FUNCTION public.link_expense_to_stock(
  p_expense_id uuid,
  p_inventory_code text,
  p_qty numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  actor_role text := public.get_my_role();
  actor_name text;
  e public.expenses%ROWTYPE;
  i public.inventory%ROWTYPE;
  unit_cost_value numeric;
  new_hpp numeric;
BEGIN
  IF actor_role NOT IN ('Owner','Admin') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin boleh menautkan nota ke stok' USING ERRCODE = '42501';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Jumlah harus lebih dari 0'; END IF;

  SELECT name INTO actor_name FROM public.user_profiles WHERE id = auth.uid();
  SELECT * INTO e FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND OR e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Nota tidak ditemukan'; END IF;
  IF e.category <> 'material_purchase' THEN RAISE EXCEPTION 'Nota bukan pembelian material'; END IF;
  IF e.stock_linked_at IS NOT NULL THEN RAISE EXCEPTION 'Nota sudah pernah ditautkan'; END IF;
  IF e.approval_status = 'PENDING_APPROVAL' OR e.validation_status = 'PENDING_AI' THEN
    RAISE EXCEPTION 'Nota harus disetujui sebelum menjadi stok';
  END IF;

  SELECT * INTO i FROM public.inventory WHERE code = p_inventory_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item inventori tidak ditemukan'; END IF;

  unit_cost_value := round((e.amount / p_qty)::numeric, 2);
  new_hpp := CASE WHEN coalesce(i.stock,0) + p_qty > 0
    THEN round(((coalesce(i.stock,0) * coalesce(i.purchase_price,0)) + (p_qty * unit_cost_value)) / (coalesce(i.stock,0) + p_qty), 2)
    ELSE unit_cost_value END;

  UPDATE public.expenses SET
    inventory_code = i.code, qty = p_qty, unit = i.unit, unit_cost = unit_cost_value,
    stock_linked_at = now(), stock_linked_by = coalesce(actor_name, actor_role),
    allocation_status = 'STOCK', last_changed_by = coalesce(actor_name, actor_role)
  WHERE id = e.id;

  UPDATE public.inventory SET
    purchase_price = new_hpp, purchase_price_last = unit_cost_value,
    purchase_price_source = 'nota', purchase_price_updated_at = now(), updated_at = now()
  WHERE code = i.code;

  INSERT INTO public.inventory_transactions
    (inventory_code, inventory_name, qty, type, unit_cost, total_cost, expense_id, notes, created_by, created_by_name)
  VALUES
    (i.code, i.name, p_qty, 'restock', unit_cost_value, e.amount, e.id,
     'Tautan nota: ' || coalesce(e.item_name, e.subcategory, 'pembelian') || ' (' || e.date || ')',
     auth.uid(), coalesce(actor_name, actor_role));

  RETURN jsonb_build_object(
    'expense', jsonb_build_object('inventory_code',i.code,'qty',p_qty,'unit',i.unit,'unit_cost',unit_cost_value,'stock_linked_at',now(),'stock_linked_by',coalesce(actor_name,actor_role),'allocation_status','STOCK'),
    'inventory', jsonb_build_object('code',i.code,'stock',coalesce(i.stock,0)+p_qty,'purchase_price',new_hpp,'purchase_price_last',unit_cost_value,'purchase_price_source','nota','purchase_price_updated_at',now())
  );
END $$;

REVOKE ALL ON FUNCTION public.link_expense_to_stock(uuid,text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_expense_to_stock(uuid,text,numeric) TO authenticated;

COMMIT;

-- Migration ini sengaja TIDAK mengubah 17+ expense historis yang tidak punya approved_at.
-- Review/backfill historis harus dilakukan Owner secara terpisah setelah audit.
