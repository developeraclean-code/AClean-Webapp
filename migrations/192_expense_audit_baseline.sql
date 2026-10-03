-- 192 — tutup antrean audit biaya historis tanpa mengubah nilai/record transaksi.
-- Temuan duplikasi dan reviewer lama sampai 2026-10-03 dianggap lewat;
-- pemeriksaan baru dimulai 2026-10-04. Total, baris, dan status biaya tidak disentuh.

BEGIN;

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
  audit_since date := DATE '2026-10-04';
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
  ), duplicate_groups AS (
    SELECT e.date, e.amount, e.category, e.subcategory,
      lower(trim(coalesce(e.teknisi_name, e.item_name, ''))) AS actor_item
    FROM public.expenses e
    WHERE e.deleted_at IS NULL AND e.date >= audit_since
    GROUP BY e.date, e.amount, e.category, e.subcategory,
      lower(trim(coalesce(e.teknisi_name, e.item_name, '')))
    HAVING count(*) > 1
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
    'duplicate_warning_count', (SELECT count(*) FROM duplicate_groups),
    'legacy_admin_high_without_review', (SELECT count(*) FROM public.expenses e
      WHERE e.deleted_at IS NULL AND e.date >= audit_since AND e.amount >= 500000
        AND e.approval_status = 'APPROVED' AND e.approved_at IS NULL
        AND EXISTS (SELECT 1 FROM public.user_profiles u
          WHERE u.role = 'Admin' AND lower(trim(u.name)) = lower(trim(e.created_by)))),
    'expense_audit_since', audit_since,
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

COMMIT;
