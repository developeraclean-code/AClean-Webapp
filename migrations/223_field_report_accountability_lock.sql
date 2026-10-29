-- Migration 223: satu laporan per job, pengirim pertama menjadi penanggung jawab.
-- Teknisi/helper lain tidak dapat mengubah laporan. Pengirim awal hanya dapat
-- memperbaiki laporan setelah Owner/Admin mengembalikannya sebagai REVISION.
-- Pelepasan status seluruh kru tetap atomik tanpa membuka UPDATE profil umum.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_staff_profile_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR public.get_my_role() IN ('Owner','Admin') THEN RETURN NEW; END IF;

  -- Hanya submit_service_report_atomic yang menyalakan flag transaksi ini.
  -- Scope-nya sempit: status kru hanya boleh dilepas ke active dan tidak ada
  -- kolom profil lain yang boleh ikut berubah.
  IF current_setting('aclean.report_team_release', true) = 'on'
     AND NEW.status IS NOT DISTINCT FROM 'active'
     AND (to_jsonb(NEW)-'status'-'updated_at') IS NOT DISTINCT FROM
         (to_jsonb(OLD)-'status'-'updated_at') THEN
    RETURN NEW;
  END IF;

  IF public.get_my_role() IS NULL OR OLD.id IS DISTINCT FROM auth.uid()
     OR (to_jsonb(NEW)-'status'-'updated_at') IS DISTINCT FROM
        (to_jsonb(OLD)-'status'-'updated_at') THEN
    RAISE EXCEPTION 'Only your own status may be changed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_staff_profile_update() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_guard_staff_profile_update ON public.user_profiles;
CREATE TRIGGER trg_guard_staff_profile_update BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_profile_update();

CREATE OR REPLACE FUNCTION public.guard_field_report_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  caller_role text := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF caller_role IN ('Teknisi','Helper') AND NOT public.is_my_job(NEW.job_id) THEN
      RAISE EXCEPTION 'Laporan bukan milik tim pengguna aktif' USING ERRCODE='42501';
    END IF;
    IF caller_role IN ('Teknisi','Helper') AND NEW.status IS DISTINCT FROM 'SUBMITTED' THEN
      RAISE EXCEPTION 'Status laporan lapangan harus SUBMITTED' USING ERRCODE='42501';
    END IF;
    IF caller_role NOT IN ('Owner','Admin','Teknisi','Helper','service_role') THEN
      RAISE EXCEPTION 'Akses menulis laporan ditolak' USING ERRCODE='42501';
    END IF;
    NEW.submitted_by_user_id := auth.uid();
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF caller_role NOT IN ('Owner','Admin','service_role') THEN
      RAISE EXCEPTION 'Hanya Admin/Owner dapat menghapus laporan' USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;

  IF caller_role IN ('Teknisi','Helper') THEN
    IF coalesce(OLD.status,'') IS DISTINCT FROM 'REVISION'
       OR OLD.submitted_by_user_id IS DISTINCT FROM auth.uid()
       OR NEW.job_id IS DISTINCT FROM OLD.job_id
       OR NEW.status IS DISTINCT FROM 'SUBMITTED' THEN
      RAISE EXCEPTION 'Laporan terkunci; hanya pengirim awal dapat memperbaiki setelah revisi Owner/Admin' USING ERRCODE='42501';
    END IF;
  ELSIF caller_role NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Akses mengubah laporan ditolak' USING ERRCODE='42501';
  END IF;
  NEW.submitted_by_user_id := OLD.submitted_by_user_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_field_report_writes() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_field_report_writes ON public.service_reports;
CREATE TRIGGER trg_guard_field_report_writes
BEFORE INSERT OR UPDATE OR DELETE ON public.service_reports
FOR EACH ROW EXECUTE FUNCTION public.guard_field_report_writes();

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

  IF role_name IS NULL OR role_name NOT IN ('Owner', 'Admin', 'Teknisi', 'Helper', 'service_role') THEN
    RAISE EXCEPTION 'Akses submit laporan ditolak' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_report) IS DISTINCT FROM 'object' OR rid IS NULL OR jid IS NULL THEN
    RAISE EXCEPTION 'Payload laporan tidak lengkap';
  END IF;

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
     AND NOT (
       coalesce(profile_name IN (ord.teknisi,ord.teknisi2,ord.teknisi3,ord.helper,ord.helper2,ord.helper3),false)
       OR EXISTS (
         SELECT 1 FROM unnest(ord.assigned_members) AS member(name)
         WHERE lower(btrim(member.name))=lower(btrim(profile_name))
       )
     ) THEN
    RAISE EXCEPTION 'Laporan bukan milik tim pengguna aktif' USING ERRCODE = '42501';
  END IF;
  IF ord.customer IS DISTINCT FROM p_report->>'customer' THEN
    RAISE EXCEPTION 'Customer laporan tidak cocok dengan order';
  END IF;

  SELECT * INTO report_row FROM public.service_reports WHERE job_id = jid FOR UPDATE;
  IF FOUND THEN
    IF report_row.id IS DISTINCT FROM rid THEN
      RAISE EXCEPTION 'Job ini sudah memiliki laporan; buka laporan yang sama' USING ERRCODE='23505';
    END IF;
    IF role_name IN ('Teknisi','Helper') AND
       (coalesce(report_row.status,'') IS DISTINCT FROM 'REVISION' OR
        report_row.submitted_by_user_id IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'Laporan terkunci; hanya pengirim awal dapat memperbaiki setelah revisi Owner/Admin' USING ERRCODE='42501';
    END IF;
    IF role_name IN ('Teknisi','Helper') AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.job_id=jid
        AND (coalesce(i.status,'') NOT IN ('PENDING_APPROVAL','CANCELLED') OR
             i.sent IS TRUE OR coalesce(i.paid_amount,0)>0)
    ) THEN
      RAISE EXCEPTION 'Invoice sudah final; gunakan Edit laporan, bukan Tulis Ulang' USING ERRCODE='42501';
    END IF;
  END IF;

  INSERT INTO public.service_reports(
    id, job_id, teknisi, helper, customer, service, date, status, total_units, total_freon,
    submitted_at, submitted, units, units_json, materials_used, materials_json, foto_urls, fotos, rekomendasi,
    catatan_global, unit_mismatch, is_substitute, hasil_survey, catatan_rekomendasi, last_changed_by
  ) VALUES(
    rid, jid, p_report->>'teknisi', nullif(p_report->>'helper', ''), p_report->>'customer', p_report->>'service',
    (p_report->>'date')::date, 'SUBMITTED', coalesce((p_report->>'total_units')::integer, 0),
    coalesce((p_report->>'total_freon')::numeric, 0),
    coalesce(nullif(p_report->>'submitted_at', '')::timestamptz, now()), p_report->>'submitted',
    coalesce(p_report->'units', '[]'::jsonb),
    coalesce(p_report->'units', '[]'::jsonb)::text,
    coalesce(p_report->'materials_used', p_report->'materials', '[]'::jsonb),
    coalesce(p_report->'materials_used', p_report->'materials', '[]'::jsonb)::text,
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
    units_json = excluded.units_json,
    materials_used = excluded.materials_used,
    materials_json = excluded.materials_json,
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

  -- Guard profil hanya membuka jalur status='active' selama UPDATE ini.
  PERFORM set_config('aclean.report_team_release', 'on', true);
  UPDATE public.user_profiles
  SET status = 'active'
  WHERE (name = ANY(ord.assigned_members)
         OR name IN (ord.teknisi,ord.teknisi2,ord.teknisi3,ord.helper,ord.helper2,ord.helper3))
    AND active IS DISTINCT FROM false;
  PERFORM set_config('aclean.report_team_release', 'off', true);

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
'Submit satu laporan per job. Teknisi/helper pertama menjadi penanggung jawab; laporan terkunci sampai Owner/Admin meminta REVISION.';

NOTIFY pgrst, 'reload schema';
COMMIT;
