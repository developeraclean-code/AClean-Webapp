-- 182 — Perbaiki submit_service_report_atomic untuk skema produksi AClean.
-- service_reports.foto_urls bertipe text[], sedangkan operator p_report->'foto_urls'
-- menghasilkan jsonb. Migration 177 memasukkan jsonb secara langsung sehingga semua
-- submit laporan yang melewati RPC gagal dengan SQLSTATE 42804.

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_service_report_atomic(
  p_report jsonb,
  p_actor_name text DEFAULT NULL,
  p_mutation_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  role_name text;
  profile_name text;
  actor text;
  ord public.orders%ROWTYPE;
  report_row public.service_reports%ROWTYPE;
  result_value jsonb;
  claimed integer;
  mkey text;
  rid text := nullif(p_report->>'id', '');
  jid text := nullif(p_report->>'job_id', '');
  photo_urls text[];
BEGIN
  role_name := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  SELECT name INTO profile_name
  FROM public.user_profiles
  WHERE id = auth.uid() AND active IS DISTINCT FROM false;
  actor := coalesce(profile_name, nullif(trim(p_actor_name), ''), role_name);

  IF role_name NOT IN ('Owner', 'Admin', 'Teknisi', 'Helper', 'service_role') THEN
    RAISE EXCEPTION 'Akses submit laporan ditolak' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_report) IS DISTINCT FROM 'object' OR rid IS NULL OR jid IS NULL THEN
    RAISE EXCEPTION 'Payload laporan tidak lengkap';
  END IF;

  -- Konversi eksplisit JSON array menjadi PostgreSQL text[]. URL kosong dibuang;
  -- urutan foto tetap mengikuti payload dari perangkat teknisi/helper.
  SELECT coalesce(array_agg(photo.value ORDER BY photo.ordinality), ARRAY[]::text[])
  INTO photo_urls
  FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(p_report->'foto_urls') = 'array'
         THEN p_report->'foto_urls' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS photo(value, ordinality)
  WHERE nullif(trim(photo.value), '') IS NOT NULL;

  mkey := coalesce(nullif(trim(p_mutation_key), ''), 'report-submit:' || rid);
  INSERT INTO public.operational_mutations(mutation_key, operation, actor_id, actor_name)
  VALUES(mkey, 'SUBMIT_REPORT', auth.uid(), actor)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed = ROW_COUNT;

  IF claimed = 0 THEN
    SELECT om.result INTO result_value
    FROM public.operational_mutations om
    WHERE om.mutation_key = mkey;
    RETURN result_value || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = jid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % tidak ditemukan', jid; END IF;
  IF role_name IN ('Teknisi', 'Helper')
     AND profile_name NOT IN (ord.teknisi, ord.teknisi2, ord.teknisi3, ord.helper, ord.helper2, ord.helper3) THEN
    RAISE EXCEPTION 'Laporan bukan milik tim pengguna aktif' USING ERRCODE = '42501';
  END IF;
  IF ord.customer IS DISTINCT FROM p_report->>'customer' THEN
    RAISE EXCEPTION 'Customer laporan tidak cocok dengan order';
  END IF;

  DELETE FROM public.service_reports WHERE job_id = jid AND id <> rid;
  INSERT INTO public.service_reports(
    id, job_id, teknisi, helper, customer, service, date, status, total_units, total_freon,
    submitted_at, submitted, units, materials_used, foto_urls, fotos, rekomendasi,
    catatan_global, unit_mismatch, is_substitute, hasil_survey, catatan_rekomendasi, last_changed_by
  ) VALUES(
    rid, jid, p_report->>'teknisi', nullif(p_report->>'helper', ''), p_report->>'customer', p_report->>'service',
    (p_report->>'date')::date, 'SUBMITTED', coalesce((p_report->>'total_units')::integer, 0),
    coalesce((p_report->>'total_freon')::numeric, 0),
    coalesce(nullif(p_report->>'submitted_at', '')::timestamptz, now()), p_report->>'submitted',
    coalesce(p_report->'units', '[]'::jsonb),
    coalesce(p_report->'materials_used', p_report->'materials', '[]'::jsonb),
    photo_urls,
    coalesce(p_report->'fotos', '[]'::jsonb),
    coalesce(p_report->>'rekomendasi', ''),
    coalesce(p_report->>'catatan_global', ''),
    coalesce((p_report->>'unit_mismatch')::boolean, false),
    coalesce((p_report->>'is_substitute')::boolean, false),
    p_report->>'hasil_survey', p_report->>'catatan_rekomendasi', actor
  ) ON CONFLICT(id) DO UPDATE SET
    teknisi = excluded.teknisi,
    helper = excluded.helper,
    customer = excluded.customer,
    service = excluded.service,
    date = excluded.date,
    status = 'SUBMITTED',
    total_units = excluded.total_units,
    total_freon = excluded.total_freon,
    submitted_at = excluded.submitted_at,
    submitted = excluded.submitted,
    units = excluded.units,
    materials_used = excluded.materials_used,
    foto_urls = excluded.foto_urls,
    fotos = excluded.fotos,
    rekomendasi = excluded.rekomendasi,
    catatan_global = excluded.catatan_global,
    unit_mismatch = excluded.unit_mismatch,
    is_substitute = excluded.is_substitute,
    hasil_survey = excluded.hasil_survey,
    catatan_rekomendasi = excluded.catatan_rekomendasi,
    last_changed_by = actor,
    updated_at = now()
  RETURNING * INTO report_row;

  UPDATE public.orders
  SET status = 'REPORT_SUBMITTED', last_changed_by = actor
  WHERE id = jid;

  UPDATE public.user_profiles
  SET status = 'active'
  WHERE name IN (ord.teknisi, ord.helper) AND active IS DISTINCT FROM false;

  result_value := jsonb_build_object(
    'report', to_jsonb(report_row),
    'order_status', 'REPORT_SUBMITTED',
    'replayed', false
  );
  UPDATE public.operational_mutations
  SET result = result_value, completed_at = now()
  WHERE mutation_key = mkey;

  RETURN result_value;
END $$;

REVOKE ALL ON FUNCTION public.submit_service_report_atomic(jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_service_report_atomic(jsonb,text,text) TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_service_report_atomic(jsonb,text,text) IS
  'Submit laporan atomik dengan konversi foto_urls JSON array menjadi text[] sesuai skema produksi.';

COMMIT;
