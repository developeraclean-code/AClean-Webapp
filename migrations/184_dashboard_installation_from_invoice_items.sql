-- 184 — Pemasangan AC global dihitung dari item invoice resmi, bukan report service.
--
-- Sumber kebenaran:
--   invoices.materials_detail[].nama harus cocok dengan item price_list Install aktif:
--   - Pemasangan AC Baru 0,5PK - 1PK
--   - Pemasangan AC Baru 1,5PK - 2PK
-- Nilai yang dijumlahkan adalah materials_detail[].jumlah. Invoice CANCELLED tidak
-- dihitung. Periode mengikuti created_at invoice dalam zona waktu Asia/Jakarta.

BEGIN;

-- Data lama menyimpan materials_detail sebagai TEXT JSON. Parser defensif ini
-- mencegah satu invoice legacy yang malformed menggagalkan seluruh Dashboard.
CREATE OR REPLACE FUNCTION public.safe_jsonb_array(p_value text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  parsed jsonb;
BEGIN
  IF nullif(trim(p_value), '') IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  parsed := p_value::jsonb;
  IF jsonb_typeof(parsed) = 'array' THEN
    RETURN parsed;
  END IF;
  RETURN '[]'::jsonb;
EXCEPTION WHEN OTHERS THEN
  RETURN '[]'::jsonb;
END $$;

REVOKE ALL ON FUNCTION public.safe_jsonb_array(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_dashboard_monthly_work_summary(
  p_month date DEFAULT date_trunc('month', current_date)::date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  caller_role text;
  month_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  month_end date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month')::date;
  result jsonb;
BEGIN
  caller_role := CASE
    WHEN auth.role() = 'service_role' THEN 'service_role'
    ELSE public.get_my_role()
  END;

  IF caller_role NOT IN ('Owner', 'Admin', 'service_role') THEN
    RAISE EXCEPTION 'Rekap pekerjaan Dashboard hanya untuk Owner/Admin'
      USING ERRCODE = '42501';
  END IF;

  WITH month_reports AS (
    SELECT r.id, r.job_id, r.service, r.units, r.total_units
    FROM public.service_reports r
    WHERE r.status = 'VERIFIED'
      AND r.date >= month_start
      AND r.date < month_end
  ), report_with_invoice AS (
    SELECT r.*,
           i.id AS invoice_id,
           i.total AS invoice_total,
           lower(trim(coalesce(i.repair_gratis, ''))) AS free_type
    FROM month_reports r
    LEFT JOIN LATERAL (
      SELECT inv.id, inv.total, inv.repair_gratis
      FROM public.invoices inv
      WHERE inv.job_id = r.job_id
        AND inv.status IS DISTINCT FROM 'CANCELLED'
      ORDER BY inv.created_at DESC NULLS LAST, inv.id DESC
      LIMIT 1
    ) i ON true
  ), expanded_units AS (
    SELECT r.*, expanded.unit_data, expanded.unit_no
    FROM report_with_invoice r
    CROSS JOIN LATERAL (
      SELECT u.value AS unit_data, u.ordinality::integer AS unit_no
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(r.units) = 'array' THEN r.units ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS u(value, ordinality)

      UNION ALL

      SELECT '{}'::jsonb, generated.unit_no
      FROM generate_series(1, greatest(coalesce(r.total_units, 0), 0)) AS generated(unit_no)
      WHERE jsonb_array_length(
        CASE WHEN jsonb_typeof(r.units) = 'array' THEN r.units ELSE '[]'::jsonb END
      ) = 0
    ) expanded
  ), normalized_units AS (
    SELECT e.*,
           lower(trim(coalesce(e.unit_data->>'tipe', e.unit_data->>'type', ''))) AS ac_type,
           lower(coalesce(
             CASE
               WHEN jsonb_typeof(e.unit_data->'pekerjaan') = 'array' THEN (
                 SELECT string_agg(p.value, ' | ')
                 FROM jsonb_array_elements_text(e.unit_data->'pekerjaan') AS p(value)
               )
               ELSE e.unit_data->>'pekerjaan'
             END,
             ''
           )) AS work_text
    FROM expanded_units e
  ), flags AS (
    SELECT n.*,
           (n.work_text ~ 'cleaning'
             OR (n.work_text = '' AND lower(coalesce(n.service, '')) = 'cleaning')) AS is_cleaning,
           (n.work_text ~ 'kapasitor') AS is_capacitor,
           (n.work_text ~ 'freon') AS is_freon,
           (n.work_text ~ 'garansi') AS is_warranty,
           (n.work_text ~ 'gratis') AS is_explicit_free
    FROM normalized_units n
  ), report_counts AS (
    SELECT
      count(*) FILTER (WHERE is_cleaning)::integer AS cleaning_total,
      count(*) FILTER (WHERE is_cleaning AND ac_type ~ 'split' AND ac_type !~ 'duct')::integer AS cleaning_split_wall,
      count(*) FILTER (WHERE is_cleaning AND ac_type ~ 'cassette')::integer AS cleaning_cassette,
      count(*) FILTER (WHERE is_cleaning AND ac_type ~ 'split duct|duct')::integer AS cleaning_split_duct,
      count(*) FILTER (WHERE is_cleaning AND ac_type ~ 'standing|floor')::integer AS cleaning_standing,
      count(*) FILTER (WHERE is_cleaning AND ac_type !~ 'split|cassette|duct|standing|floor')::integer AS cleaning_other,
      count(*) FILTER (WHERE is_capacitor)::integer AS capacitor_units,
      count(*) FILTER (WHERE is_freon)::integer AS freon_total,
      count(*) FILTER (
        WHERE is_freon AND invoice_id IS NOT NULL
          AND NOT is_warranty AND NOT is_explicit_free
          AND free_type NOT IN ('gratis-garansi')
          AND free_type IN ('', 'false', 'f')
          AND coalesce(invoice_total, 0) > 0
      )::integer AS freon_paid,
      count(*) FILTER (
        WHERE is_freon AND (is_warranty OR free_type = 'gratis-garansi')
      )::integer AS freon_warranty,
      count(*) FILTER (
        WHERE is_freon AND NOT is_warranty AND free_type <> 'gratis-garansi'
          AND (is_explicit_free OR invoice_id IS NOT NULL)
          AND (is_explicit_free OR free_type NOT IN ('', 'false', 'f') OR coalesce(invoice_total, 0) = 0)
      )::integer AS freon_free,
      count(*) FILTER (
        WHERE is_freon AND invoice_id IS NULL AND NOT is_warranty AND NOT is_explicit_free
      )::integer AS freon_unclassified
    FROM flags
  ), eligible_install_items AS (
    SELECT DISTINCT lower(trim(p.type)) AS item_name
    FROM public.price_list p
    WHERE lower(trim(coalesce(p.service, ''))) = 'install'
      AND p.is_active IS DISTINCT FROM false
      AND lower(trim(p.type)) ~ '^pemasangan ac baru (0[,.]5pk\s*-\s*1pk|1[,.]5pk\s*-\s*2pk)$'
  ), invoice_installation_count AS (
    SELECT coalesce(round(sum(
      CASE
        WHEN line.item->>'jumlah' ~ '^\s*[0-9]+([,.][0-9]+)?\s*$'
          THEN greatest(replace(trim(line.item->>'jumlah'), ',', '.')::numeric, 0)
        ELSE 0
      END
    )), 0)::integer AS installation_units
    FROM public.invoices inv
    CROSS JOIN LATERAL jsonb_array_elements(public.safe_jsonb_array(inv.materials_detail)) AS line(item)
    JOIN eligible_install_items catalog
      ON lower(trim(line.item->>'nama')) = catalog.item_name
    WHERE inv.status IS DISTINCT FROM 'CANCELLED'
      AND inv.created_at >= (month_start::timestamp AT TIME ZONE 'Asia/Jakarta')
      AND inv.created_at < (month_end::timestamp AT TIME ZONE 'Asia/Jakarta')
  )
  SELECT jsonb_build_object(
    'month', month_start,
    'generated_at', now(),
    'counts', jsonb_build_object(
      'cleaning_total', coalesce(c.cleaning_total, 0),
      'cleaning_split_wall', coalesce(c.cleaning_split_wall, 0),
      'cleaning_cassette', coalesce(c.cleaning_cassette, 0),
      'cleaning_split_duct', coalesce(c.cleaning_split_duct, 0),
      'cleaning_standing', coalesce(c.cleaning_standing, 0),
      'cleaning_other', coalesce(c.cleaning_other, 0),
      'installation_units', coalesce(ic.installation_units, 0),
      'capacitor_units', coalesce(c.capacitor_units, 0),
      'freon_total', coalesce(c.freon_total, 0),
      'freon_paid', coalesce(c.freon_paid, 0),
      'freon_warranty', coalesce(c.freon_warranty, 0),
      'freon_free', coalesce(c.freon_free, 0),
      'freon_unclassified', coalesce(c.freon_unclassified, 0)
    )
  ) INTO result
  FROM report_counts c
  CROSS JOIN invoice_installation_count ic;

  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_dashboard_monthly_work_summary(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_monthly_work_summary(date) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_dashboard_monthly_work_summary(date) IS
  'Rekap bulanan Dashboard; Pemasangan AC global bersumber dari qty item invoice price list 0,5PK-2PK.';

COMMIT;
