-- Migration 201: semua anggota job dapat melihat satu laporan, pengirim awal
-- boleh mengoreksi sampai diverifikasi. UID diambil dari auth, bukan nama tampilan.
-- Satu report/job tetap dijaga unique index migrasi 001.
-- Satu laporan per job harus dapat ditemukan oleh setiap anggota yang ditugaskan.
-- Snapshot anggota order menampung seluruh roster (hingga 8), termasuk anggota
-- ke-4 pada satu peran yang tidak muat di kolom teknisi1..3/helper1..3.
BEGIN;

-- Pengirim pertama disimpan sebagai UID, bukan nama yang bisa berubah. Laporan
-- lama tanpa UID tetap bisa dibaca seluruh tim; revisinya ditangani Admin/Owner.
ALTER TABLE public.service_reports
  ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid;

-- Laporan atomik lama punya jejak pengirim pertama yang tepat di mutation key.
-- Jangan menebak UID dari last_changed_by: nama itu bisa milik editor terakhir.
UPDATE public.service_reports r
SET submitted_by_user_id = m.actor_id
FROM public.operational_mutations m
WHERE r.submitted_by_user_id IS NULL
  AND m.mutation_key = 'report-submit:' || r.id
  AND m.operation = 'SUBMIT_REPORT'
  AND m.actor_id IS NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS assigned_members text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE OR REPLACE FUNCTION public.resolve_order_assigned_members(p_order public.orders)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  WITH names AS (
    SELECT btrim(person) AS name, position
    FROM unnest(ARRAY[
      (p_order).teknisi,(p_order).teknisi2,(p_order).teknisi3,
      (p_order).helper,(p_order).helper2,(p_order).helper3
    ]) WITH ORDINALITY AS member(person,position)
    UNION ALL
    SELECT btrim(person), position+6
    FROM public.daily_team_slots d,
         LATERAL unnest(ARRAY[
           d.member1,d.member2,d.member3,d.member4,
           d.member5,d.member6,d.member7,d.member8
         ]) WITH ORDINALITY AS member(person,position)
    -- Roster lama dapat diubah setelah pekerjaan selesai. Backfill anggota
    -- ekstra hanya dari roster 30 hari terakhir; kolom order tetap sumber
    -- pasti untuk riwayat yang lebih tua.
    WHERE (p_order).project_id IS NULL AND d.date=(p_order).date AND d.slot=(p_order).team_slot
      AND (p_order).date >= (now() AT TIME ZONE 'Asia/Jakarta')::date - 30
  )
  SELECT coalesce(array_agg(name ORDER BY first_position),ARRAY[]::text[])
  FROM (
    SELECT (array_agg(name ORDER BY position))[1] AS name,min(position) AS first_position
    FROM names WHERE name IS NOT NULL AND name<>'' GROUP BY lower(name)
  ) distinct_names;
$$;
REVOKE ALL ON FUNCTION public.resolve_order_assigned_members(public.orders) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_order_assigned_members()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
BEGIN
  NEW.assigned_members := public.resolve_order_assigned_members(NEW);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_order_assigned_members() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_order_assigned_members ON public.orders;
CREATE TRIGGER trg_sync_order_assigned_members
BEFORE INSERT OR UPDATE OF teknisi,teknisi2,teknisi3,helper,helper2,helper3,date,team_slot,project_id
ON public.orders FOR EACH ROW EXECUTE FUNCTION public.sync_order_assigned_members();

UPDATE public.orders o SET assigned_members=public.resolve_order_assigned_members(o)
WHERE o.date >= (now() AT TIME ZONE 'Asia/Jakarta')::date - 30
  AND o.assigned_members IS DISTINCT FROM public.resolve_order_assigned_members(o);

CREATE OR REPLACE FUNCTION public.is_my_job(p_job_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE (o.id=p_job_id OR o.parent_job_id=p_job_id)
      AND (public.get_my_name() IN (
        o.teknisi,o.teknisi2,o.teknisi3,o.helper,o.helper2,o.helper3
      ) OR EXISTS (
        SELECT 1 FROM unnest(o.assigned_members) AS member(name)
        WHERE lower(btrim(member.name))=lower(btrim(public.get_my_name()))
      ))
  );
$$;
REVOKE ALL ON FUNCTION public.is_my_job(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_job(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_service_reports_page(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_service text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_team text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  caller_role text;
  caller_name text;
  safe_page integer := greatest(coalesce(p_page,1),1);
  safe_size integer := least(greatest(coalesce(p_page_size,20),1),100);
  result jsonb;
BEGIN
  SELECT role,name INTO caller_role,caller_name FROM public.user_profiles
  WHERE id=auth.uid() AND active IS DISTINCT FROM false;
  IF caller_role IS NULL THEN RAISE EXCEPTION 'Profil aktif tidak ditemukan' USING ERRCODE='42501'; END IF;

  WITH base_filtered AS (
    SELECT r.*, ARRAY(
      SELECT member FROM unnest(coalesce(o.assigned_members,ARRAY[]::text[]) || ARRAY[
        o.teknisi,o.teknisi2,o.teknisi3,o.helper,o.helper2,o.helper3,r.teknisi,r.helper
      ])
        WITH ORDINALITY AS crew(member,position)
      WHERE nullif(btrim(member),'') IS NOT NULL
      GROUP BY member ORDER BY min(position)
    ) AS assigned_members
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
        ])
          AS person(name) WHERE person.name ILIKE '%'||trim(p_search)||'%'))
  ), filtered AS (
    SELECT * FROM base_filtered r
    WHERE nullif(p_status,'') IS NULL OR p_status='Semua'
       OR (p_status='BELUM_VERIFIED' AND r.status IN ('SUBMITTED','REVISION'))
       OR r.status=p_status
  ), page_rows AS (
    SELECT id,job_id,teknisi,helper,assigned_members,submitted_by_user_id,customer,service,type,date,total_units,total_freon,
           units,materials_used,foto_urls,rekomendasi,catatan_global,edit_log,status,
           submitted_at,updated_at,submitted,unit_mismatch,created_at,is_substitute,is_install,
           bap_number,bap_statement,bap_recommendation,ttd_customer_url,ttd_customer_name,
           bap_skipped_reason,bap_signed_at,hasil_survey,catatan_rekomendasi,survey_sent_at,
           report_card_sent_at,report_card_sent_by,report_card_sent_count,
           report_card_last_sent_mode,report_card_last_sent_method
    FROM filtered ORDER BY submitted_at DESC,status,id
    OFFSET (safe_page-1)*safe_size LIMIT safe_size
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
    IF coalesce(OLD.status,'') NOT IN ('SUBMITTED','REVISION') OR
       OLD.submitted_by_user_id IS DISTINCT FROM auth.uid() OR
       NEW.job_id IS DISTINCT FROM OLD.job_id OR
       NEW.status IS DISTINCT FROM 'SUBMITTED' THEN
      RAISE EXCEPTION 'Laporan terkunci; hanya pengirim awal boleh mengedit sebelum verifikasi' USING ERRCODE='42501';
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
       (coalesce(report_row.status,'') NOT IN ('SUBMITTED','REVISION') OR
        report_row.submitted_by_user_id IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'Laporan terkunci; hanya pengirim awal boleh mengedit sebelum verifikasi' USING ERRCODE='42501';
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

  UPDATE public.user_profiles
  SET status = 'active'
  WHERE (name = ANY(ord.assigned_members) OR name IN (ord.teknisi,ord.helper))
    AND active IS DISTINCT FROM false;

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

COMMIT;
