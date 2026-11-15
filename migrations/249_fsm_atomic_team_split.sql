-- Migration 249: create every split team, unit allocation and crew claim together.
-- Uses existing tables only. Failure rolls back all children and the receipt.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.create_team_split_atomic(p_request_id uuid,p_orders jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET lock_timeout='5s' AS $$
DECLARE actor_role text; actor text; mkey text; prior public.operational_mutations%ROWTYPE;
  item jsonb; ord public.orders%ROWTYPE; saved jsonb:='[]'::jsonb;
  group_id text; target_client_id uuid; customer_id text; people text[]; person text;
  unit_ids uuid[]; target_units uuid[]; expected_count integer; receipt_count integer;
BEGIN
  actor_role:=public.get_my_role();
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
     OR actor_role IS NULL OR actor_role NOT IN ('Owner','Admin') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin aktif dapat membuat grup tim' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_orders) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Permintaan grup tidak valid' USING ERRCODE='22023';
  END IF;
  expected_count:=jsonb_array_length(p_orders);
  IF expected_count NOT BETWEEN 2 AND 8 THEN RAISE EXCEPTION 'Grup harus berisi 2 sampai 8 tim' USING ERRCODE='22023'; END IF;
  group_id:=nullif(trim(p_orders->0->>'id'),'');
  target_client_id:=nullif(p_orders->0->>'maintenance_client_id','')::uuid;
  IF group_id IS NULL OR target_client_id IS NULL THEN RAISE EXCEPTION 'ID grup dan klien wajib diisi' USING ERRCODE='22023'; END IF;
  SELECT mc.customer_id INTO customer_id FROM public.maintenance_clients mc WHERE mc.id=target_client_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Klien maintenance tidak ditemukan' USING ERRCODE='23503'; END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid();

  -- Match the existing planner/night lock and claim every person in sorted order.
  PERFORM pg_advisory_xact_lock(hashtext('aclean:schedule-plan'));
  mkey:='team-split:'||p_request_id::text;
  INSERT INTO public.operational_mutations(mutation_key,operation,actor_id,actor_name)
  VALUES(mkey,'CREATE_TEAM_SPLIT',auth.uid(),actor) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS receipt_count=ROW_COUNT;
  IF receipt_count=0 THEN
    SELECT * INTO prior FROM public.operational_mutations WHERE mutation_key=mkey FOR UPDATE;
    IF prior.actor_id IS DISTINCT FROM auth.uid() OR prior.operation<>'CREATE_TEAM_SPLIT'
       OR prior.result->'request' IS DISTINCT FROM p_orders OR prior.completed_at IS NULL THEN
      RAISE EXCEPTION 'ID permintaan dipakai untuk data berbeda' USING ERRCODE='40001';
    END IF;
    RETURN prior.result||jsonb_build_object('replayed',true);
  END IF;

  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_orders))<>expected_count THEN
    RAISE EXCEPTION 'ID order duplikat' USING ERRCODE='22023';
  END IF;
  SELECT array_agg(v::uuid ORDER BY v::uuid) INTO unit_ids
  FROM jsonb_array_elements(p_orders) x,
       LATERAL jsonb_array_elements_text(x.value->'maintenance_unit_ids') u(v);
  IF coalesce(cardinality(unit_ids),0)=0 OR
     (SELECT count(DISTINCT u) FROM unnest(unit_ids) u)<>cardinality(unit_ids) THEN
    RAISE EXCEPTION 'Unit grup kosong atau dialokasikan ke beberapa tim' USING ERRCODE='22023';
  END IF;
  PERFORM mu.id FROM public.maintenance_units mu WHERE mu.id=ANY(unit_ids) ORDER BY mu.id FOR SHARE;
  IF (SELECT count(*) FROM public.maintenance_units mu WHERE mu.id=ANY(unit_ids) AND mu.client_id=target_client_id)<>cardinality(unit_ids) THEN
    RAISE EXCEPTION 'Unit tidak ditemukan atau milik klien lain' USING ERRCODE='23503';
  END IF;
  SELECT array_agg(DISTINCT trim(v) ORDER BY trim(v)) INTO people
  FROM jsonb_array_elements(p_orders) x,
       LATERAL unnest(ARRAY[x.value->>'teknisi',x.value->>'helper',x.value->>'teknisi2',
         x.value->>'helper2',x.value->>'teknisi3',x.value->>'helper3']) u(v)
  WHERE nullif(trim(v),'') IS NOT NULL;
  FOREACH person IN ARRAY coalesce(people,ARRAY[]::text[]) LOOP
    IF (SELECT count(*) FROM public.user_profiles WHERE name=person AND active IS TRUE)<>1 THEN
      RAISE EXCEPTION 'Anggota tim tidak aktif atau namanya ambigu: %',person USING ERRCODE='22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('schedule:'||person));
  END LOOP;

  -- Combined with the invoker trigger below, this prevents older browser tabs
  -- from bypassing the atomic command with individual split-child INSERTs.
  PERFORM set_config('aclean.atomic_team_split',group_id,true);
  FOR item IN SELECT value FROM jsonb_array_elements(p_orders) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR nullif(trim(item->>'id'),'') IS NULL OR item->>'job_group_id' IS DISTINCT FROM group_id
       OR (item->>'maintenance_client_id')::uuid IS DISTINCT FROM target_client_id
       OR jsonb_typeof(item->'maintenance_unit_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(item->'maintenance_unit_ids')=0 THEN
      RAISE EXCEPTION 'Anggota grup tidak valid' USING ERRCODE='22023';
    END IF;
    SELECT array_agg(v::uuid) INTO target_units FROM jsonb_array_elements_text(item->'maintenance_unit_ids') u(v);
    people:=array_remove(ARRAY[nullif(trim(item->>'teknisi'),''),nullif(trim(item->>'helper'),''),
      nullif(trim(item->>'teknisi2'),''),nullif(trim(item->>'helper2'),''),
      nullif(trim(item->>'teknisi3'),''),nullif(trim(item->>'helper3'),'')],NULL);
    IF cardinality(people)<>(SELECT count(DISTINCT p) FROM unnest(people) p)
       OR (nullif(trim(item->>'teknisi'),'') IS NULL AND cardinality(people)>0) THEN
      RAISE EXCEPTION 'Komposisi anggota tim tidak valid' USING ERRCODE='22023';
    END IF;
    IF nullif(trim(item->>'customer'),'') IS NULL OR nullif(trim(item->>'service'),'') IS NULL
       OR item->>'date' IS NULL OR nullif(item->>'time','') IS NULL OR nullif(item->>'time_end','') IS NULL
       OR (item->>'time')::time=(item->>'time_end')::time
       OR upper(public.slot_tsrange((item->>'date')::date,item->>'time',item->>'time_end'))
          -lower(public.slot_tsrange((item->>'date')::date,item->>'time',item->>'time_end'))>interval '12 hours' THEN
      RAISE EXCEPTION 'Data atau jam tim tidak valid' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM public.orders o WHERE o.date BETWEEN (item->>'date')::date-1 AND (item->>'date')::date+1
       AND o.status IN ('PENDING','CONFIRMED','DISPATCHED','ON_SITE','IN_PROGRESS','WORKING')
       AND o.time IS NOT NULL AND o.time_end IS NOT NULL AND o.time<>o.time_end
       AND public.slot_tsrange(o.date,o.time::text,o.time_end::text)
           &&public.slot_tsrange((item->>'date')::date,item->>'time',item->>'time_end')
       AND (coalesce(o.assigned_members,ARRAY[]::text[])||ARRAY[o.teknisi,o.helper,o.teknisi2,o.helper2,o.teknisi3,o.helper3])&&people) THEN
      RAISE EXCEPTION 'Anggota tim sudah memiliki pekerjaan pada jam tersebut' USING ERRCODE='23P01';
    END IF;
    INSERT INTO public.orders(id,customer,customer_id,phone,address,area,service,type,units,
      teknisi,helper,teknisi2,helper2,teknisi3,helper3,date,time,time_end,status,dispatch,source,
      job_group_id,is_team_split,maintenance_client_id,maintenance_unit_ids,notes,last_changed_by)
    VALUES(item->>'id',trim(item->>'customer'),customer_id,nullif(item->>'phone',''),coalesce(item->>'address',''),
      coalesce(item->>'area',''),item->>'service',coalesce(item->>'type',item->>'service'),cardinality(target_units),
      nullif(trim(item->>'teknisi'),''),nullif(trim(item->>'helper'),''),nullif(trim(item->>'teknisi2'),''),
      nullif(trim(item->>'helper2'),''),nullif(trim(item->>'teknisi3'),''),nullif(trim(item->>'helper3'),''),
      (item->>'date')::date,(item->>'time')::time,(item->>'time_end')::time,
      CASE WHEN cardinality(people)>0 THEN 'CONFIRMED' ELSE 'PENDING' END,false,'maintenance',group_id,true,target_client_id,
      item->'maintenance_unit_ids',coalesce(item->>'notes',''),actor)
    RETURNING * INTO ord;
    FOREACH person IN ARRAY people LOOP
      IF public.try_claim_teknisi_slot(person,ord.date,ord.id,ord.time::text,ord.time_end::text) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Reservasi anggota gagal; seluruh grup dibatalkan' USING ERRCODE='23P01';
      END IF;
    END LOOP;
    saved:=saved||jsonb_build_array(to_jsonb(ord));
  END LOOP;
  UPDATE public.operational_mutations SET completed_at=now(),result=jsonb_build_object('group_id',group_id,
    'orders',saved,'expected_teams',expected_count,'request',p_orders,'replayed',false) WHERE mutation_key=mkey;
  RETURN jsonb_build_object('group_id',group_id,'orders',saved,'expected_teams',expected_count,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_team_split_atomic(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_team_split_atomic(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_atomic_team_split_insert_241()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.is_team_split IS TRUE AND (
      current_user IS DISTINCT FROM (SELECT pg_get_userbyid(proowner) FROM pg_proc
        WHERE oid='public.create_team_split_atomic(uuid,jsonb)'::regprocedure)
      OR current_setting('aclean.atomic_team_split',true) IS DISTINCT FROM NEW.job_group_id
    ) THEN
    RAISE EXCEPTION 'Grup tim wajib disimpan sekaligus; muat ulang aplikasi untuk menggunakan penyimpanan atomik'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_atomic_team_split_insert_241() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER trg_guard_atomic_team_split_insert_241
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_atomic_team_split_insert_241();
NOTIFY pgrst,'reload schema';
COMMIT;
