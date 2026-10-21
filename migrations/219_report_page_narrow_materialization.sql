-- Migration 219: page report IDs before fetching JSON/photo details.
-- The 201 CTE reused r.* for counts and rows, materializing large JSON for
-- every matching report. Production statistics show temporary disk writes on
-- get_service_reports_page. Keep only IDs/status/time in the shared CTE.
-- Preserve crew authorization, filters, counters, ordering and returned fields.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_service_reports_page(
  p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL,
  p_service text DEFAULT NULL, p_status text DEFAULT NULL,
  p_team text DEFAULT NULL, p_search text DEFAULT NULL,
  p_page integer DEFAULT 1, p_page_size integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  caller_role text; caller_name text;
  safe_page integer := greatest(coalesce(p_page,1),1);
  safe_size integer := least(greatest(coalesce(p_page_size,20),1),100);
  result jsonb;
BEGIN
  SELECT role,name INTO caller_role,caller_name FROM public.user_profiles
  WHERE id=auth.uid() AND active IS DISTINCT FROM false;
  IF caller_role IS NULL THEN RAISE EXCEPTION 'Profil aktif tidak ditemukan' USING ERRCODE='42501'; END IF;

  WITH base_filtered AS MATERIALIZED (
    SELECT r.id,r.status,r.submitted_at
    FROM public.service_reports r
    LEFT JOIN public.orders o ON o.id=r.job_id
    WHERE (caller_role IN ('Owner','Admin','Finance') OR
           caller_name IN (r.teknisi,r.helper,o.teknisi,o.teknisi2,o.teknisi3,o.helper,o.helper2,o.helper3) OR EXISTS (
             SELECT 1 FROM unnest(o.assigned_members) AS member(name)
             WHERE lower(btrim(member.name))=lower(btrim(caller_name))
           ))
      AND (p_date_from IS NULL OR coalesce(r.date,r.submitted_at::date)>=p_date_from)
      AND (p_date_to IS NULL OR coalesce(r.date,r.submitted_at::date)<=p_date_to)
      AND (nullif(p_service,'') IS NULL OR p_service='Semua' OR r.service=p_service)
      AND (nullif(p_team,'') IS NULL OR p_team='Semua Tim' OR
           p_team IN (r.teknisi,r.helper,o.teknisi,o.teknisi2,o.teknisi3,o.helper,o.helper2,o.helper3)
           OR p_team=ANY(o.assigned_members))
      AND (nullif(trim(p_search),'') IS NULL OR
        r.customer ILIKE '%'||trim(p_search)||'%' OR r.id ILIKE '%'||trim(p_search)||'%' OR
        r.job_id ILIKE '%'||trim(p_search)||'%' OR
        EXISTS (SELECT 1 FROM unnest(coalesce(o.assigned_members,ARRAY[]::text[]) || ARRAY[
          o.teknisi,o.teknisi2,o.teknisi3,o.helper,o.helper2,o.helper3,r.teknisi,r.helper
        ]) AS person(name) WHERE person.name ILIKE '%'||trim(p_search)||'%'))
  ), filtered AS MATERIALIZED (
    SELECT * FROM base_filtered r
    WHERE nullif(p_status,'') IS NULL OR p_status='Semua'
       OR (p_status='BELUM_VERIFIED' AND r.status IN ('SUBMITTED','REVISION'))
       OR r.status=p_status
  ), page_ids AS MATERIALIZED (
    SELECT id FROM filtered ORDER BY submitted_at DESC,status,id
    OFFSET (safe_page::bigint-1)*safe_size LIMIT safe_size
  ), page_rows AS (
    SELECT r.id,r.job_id,r.teknisi,r.helper, ARRAY(
      SELECT member FROM unnest(coalesce(o.assigned_members,ARRAY[]::text[]) || ARRAY[
        o.teknisi,o.teknisi2,o.teknisi3,o.helper,o.helper2,o.helper3,r.teknisi,r.helper
      ]) WITH ORDINALITY AS crew(member,position)
      WHERE nullif(btrim(member),'') IS NOT NULL
      GROUP BY member ORDER BY min(position)
    ) AS assigned_members,
      r.submitted_by_user_id,r.customer,r.service,r.type,r.date,r.total_units,r.total_freon,
      r.units,r.materials_used,r.foto_urls,r.rekomendasi,r.catatan_global,r.edit_log,r.status,
      r.submitted_at,r.updated_at,r.submitted,r.unit_mismatch,r.created_at,r.is_substitute,r.is_install,
      r.bap_number,r.bap_statement,r.bap_recommendation,r.ttd_customer_url,r.ttd_customer_name,
      r.bap_skipped_reason,r.bap_signed_at,r.hasil_survey,r.catatan_rekomendasi,r.survey_sent_at,
      r.report_card_sent_at,r.report_card_sent_by,r.report_card_sent_count,
      r.report_card_last_sent_mode,r.report_card_last_sent_method
    FROM page_ids p JOIN public.service_reports r ON r.id=p.id
    LEFT JOIN public.orders o ON o.id=r.job_id
  ), counts AS (
    SELECT status,count(*)::int count FROM base_filtered GROUP BY status
  )
  SELECT jsonb_build_object(
    'page',safe_page,'page_size',safe_size,'total_count',(SELECT count(*) FROM filtered),
    'status_counts',coalesce((SELECT jsonb_object_agg(status,count) FROM counts),'{}'::jsonb),
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.submitted_at DESC,x.status,x.id) FROM page_rows x),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_service_reports_page(date,date,text,text,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_service_reports_page(date,date,text,text,text,text,integer,integer) TO authenticated, service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
