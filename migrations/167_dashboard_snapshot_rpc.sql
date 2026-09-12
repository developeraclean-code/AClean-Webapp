-- 167 — Dashboard RPC: satu round-trip, proyeksi minimum, tanpa foto/BAP/material.
-- Menjaga kalkulasi UI tetap identik sambil menghapus 5 full-table fetch saat login.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_dashboard_snapshot(p_since date DEFAULT (current_date - interval '6 months')::date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  caller_role text;
  result jsonb;
BEGIN
  SELECT lower(up.role) INTO caller_role
  FROM public.user_profiles up
  WHERE up.id = auth.uid() AND up.active IS DISTINCT FROM false
  LIMIT 1;

  IF caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'dashboard snapshot hanya untuk Owner/Admin'
      USING ERRCODE = '42501';
  END IF;

  WITH relevant_orders AS (
    SELECT o.id, o.date, o.status, o.teknisi, o.helper, o.units
    FROM public.orders o
    WHERE o.date >= p_since
  ), relevant_invoices AS (
    SELECT i.job_id, i.status, i.total, i.invoice_type, i.unit_ac_amount,
           i.created_at, i.paid_at, i.service, i.teknisi, i.repair_gratis
    FROM public.invoices i
    LEFT JOIN relevant_orders o ON o.id = i.job_id
    WHERE o.id IS NOT NULL
       OR i.created_at::date >= p_since
       OR i.status IN ('PENDING_APPROVAL', 'APPROVED', 'UNPAID', 'OVERDUE', 'PARTIAL_PAID')
  ), relevant_reports AS (
    -- Agregasi pekerjaan dilakukan di DB. Kolom units JSON dapat sangat besar dan
    -- sebelumnya menyumbang >1 MB untuk enam bulan, padahal Dashboard hanya perlu
    -- jumlah/flag berikut.
    SELECT r.job_id, r.teknisi, r.service, r.date, r.status, r.submitted_at,
           CASE WHEN r.service = 'Cleaning'
                THEN COALESCE(NULLIF(r.total_units, 0), jsonb_array_length(CASE WHEN jsonb_typeof(r.units) = 'array' THEN r.units ELSE '[]'::jsonb END))
                ELSE COALESCE(work.cleaning_count, 0) END AS cleaning_count,
           CASE WHEN r.service = 'Install'
                THEN COALESCE(NULLIF(r.total_units, 0), jsonb_array_length(CASE WHEN jsonb_typeof(r.units) = 'array' THEN r.units ELSE '[]'::jsonb END))
                ELSE COALESCE(work.install_count, 0) END AS install_count,
           COALESCE(work.kapasitor_count, 0) AS kapasitor_count,
           COALESCE(work.has_freon_add, false) AS has_freon_add,
           COALESCE(work.has_freon_vac, false) AS has_freon_vac,
           true AS dashboard_aggregated
    FROM public.service_reports r
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE unit_work.work_text ~* 'cleaning')::int AS cleaning_count,
        count(*) FILTER (WHERE unit_work.work_text ~* 'bongkar pasang'
          OR (unit_work.work_text ~* 'pemasangan|pasang' AND unit_work.work_text ~* 'unit|bracket|indoor|outdoor'))::int AS install_count,
        count(*) FILTER (WHERE unit_work.work_text ~* 'kapasitor')::int AS kapasitor_count,
        bool_or(unit_work.work_text ~* 'penambahan freon') AS has_freon_add,
        bool_or(unit_work.work_text ~* 'kuras vacum|jasa vacum') AS has_freon_vac
      FROM (
        SELECT COALESCE((
          SELECT string_agg(p.value, ' | ')
          FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(u.value->'pekerjaan') = 'array'
                 THEN u.value->'pekerjaan' ELSE '[]'::jsonb END
          ) p
        ), '') AS work_text
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(r.units) = 'array' THEN r.units ELSE '[]'::jsonb END
        ) u
      ) unit_work
    ) work ON true
    WHERE r.date >= p_since
  ), relevant_expenses AS (
    SELECT e.date, e.created_at, e.amount, e.category, e.subcategory, e.item_name,
           e.approval_status, e.validation_status
    FROM public.expenses e
    WHERE e.deleted_at IS NULL AND e.date >= p_since
  ), relevant_payroll AS (
    SELECT w.period_start, w.period_end, w.gross_salary, w.manual_bonus,
           w.kasbon_deduct, w.is_paid, w.paid_at
    FROM public.weekly_payroll w
    WHERE w.period_end >= p_since
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'since', p_since,
    'orders', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.date DESC) FROM relevant_orders x), '[]'::jsonb),
    'invoices', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM relevant_invoices x), '[]'::jsonb),
    'reports', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.date DESC) FROM relevant_reports x), '[]'::jsonb),
    'expenses', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.date DESC) FROM relevant_expenses x), '[]'::jsonb),
    'payroll', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.period_start DESC) FROM relevant_payroll x), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_snapshot(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_snapshot(date) TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_snapshot(date) IS
  'Dataset terproyeksi untuk agregasi Dashboard Owner/Admin; tidak memuat kolom detail berat.';

COMMIT;
