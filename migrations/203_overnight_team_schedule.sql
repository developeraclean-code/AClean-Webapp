-- 203 — Overnight night roster: 18:00–06:00 (+1 day), date-aware claims/conflicts.
-- Existing orders remain unchanged. Legacy night jobs keep their old slot label
-- until their schedule/team is edited; unrelated status changes stay possible.
BEGIN;

CREATE OR REPLACE FUNCTION public.try_claim_teknisi_slot(
  p_teknisi text,
  p_date date,
  p_order_id text,
  p_start text,
  p_end text
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_cnt integer;
  c_active constant text[] := ARRAY['PENDING','CONFIRMED','DISPATCHED','IN_PROGRESS','ON_SITE','WORKING'];
BEGIN
  IF p_teknisi IS NULL OR btrim(p_teknisi) = '' OR p_date IS NULL THEN RETURN true; END IF;
  IF nullif(trim(p_start),'') IS NULL OR nullif(trim(p_end),'') IS NULL OR p_start::time = p_end::time THEN
    RAISE EXCEPTION 'Jam mulai/selesai tidak valid';
  END IF;

  IF upper(public.slot_tsrange(p_date,p_start,p_end))-lower(public.slot_tsrange(p_date,p_start,p_end))>interval '12 hours' THEN RAISE EXCEPTION 'Durasi maksimal 12 jam'; END IF;
  -- Lock per person (not per date), because an overnight claim spans two dates.
  PERFORM pg_advisory_xact_lock(hashtext('schedule:' || p_teknisi));

  DELETE FROM public.technician_schedule ts
   WHERE ts.teknisi=p_teknisi AND ts.date BETWEEN p_date-1 AND p_date+1
     AND NOT EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.id=ts.order_id AND o.status=ANY(c_active)
     );

  SELECT count(*) INTO v_cnt
    FROM public.technician_schedule ts
    JOIN public.orders o ON o.id=ts.order_id
   WHERE ts.teknisi=p_teknisi AND ts.date=p_date AND ts.status='ACTIVE'
     AND ts.order_id<>p_order_id AND o.status=ANY(c_active);
  IF v_cnt>=6 THEN RETURN false; END IF;

  SELECT count(*) INTO v_cnt
    FROM public.technician_schedule ts
    JOIN public.orders o ON o.id=ts.order_id
   WHERE ts.teknisi=p_teknisi AND ts.date BETWEEN p_date-1 AND p_date+1 AND ts.status='ACTIVE'
     AND ts.order_id<>p_order_id AND o.status=ANY(c_active)
     AND public.slot_tsrange(p_date,p_start,p_end) && public.slot_tsrange(ts.date,ts.time_start,ts.time_end);
  IF v_cnt>0 THEN RETURN false; END IF;

  INSERT INTO public.technician_schedule(order_id,teknisi,date,time_start,time_end,status)
  VALUES(p_order_id,p_teknisi,p_date,p_start,p_end,'ACTIVE');
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.try_claim_teknisi_slot(text,date,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_claim_teknisi_slot(text,date,text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_schedule_plan(
  p_request_id uuid, p_order_id text, p_plan jsonb, p_expected jsonb DEFAULT NULL, p_reason text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  role_name text; actor text; mkey text; request_value jsonb; result_value jsonb; claimed integer;
  old_row public.orders%ROWTYPE; saved public.orders%ROWTYPE; customer_row public.customers%ROWTYPE;
  expected_value jsonb; target_date date; start_time time; end_time time; target_status text; team text;
  crew jsonb; people text[]:=ARRAY[]::text[]; techs text[]:=ARRAY[]::text[]; helpers text[]:=ARRAY[]::text[];
  member text; member_role text; person text; i integer; n integer; phone_value text; notes_value text; contract_id uuid;
BEGIN
  role_name:=public.get_my_role();
  IF role_name IS NULL OR role_name NOT IN ('Owner','Admin') THEN RAISE EXCEPTION 'Hanya Owner/Admin dapat mengubah planning' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR nullif(trim(p_order_id),'') IS NULL OR length(p_order_id)>100 OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Permintaan planning tidak lengkap'; END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid(); actor:=coalesce(actor,role_name);
  mkey:='schedule-plan:'||p_request_id::text;
  request_value:=jsonb_build_object('id',p_order_id,'plan',p_plan,'expected',p_expected,'reason',p_reason);
  INSERT INTO public.operational_mutations(mutation_key,operation,actor_id,actor_name)
    VALUES(mkey,'SCHEDULE_PLAN',auth.uid(),actor) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed=ROW_COUNT;
  IF claimed=0 THEN
    SELECT result INTO result_value FROM public.operational_mutations WHERE mutation_key=mkey;
    IF result_value->'request' IS DISTINCT FROM request_value THEN RAISE EXCEPTION 'ID permintaan telah digunakan untuk data berbeda'; END IF;
    RETURN result_value||jsonb_build_object('replayed',true);
  END IF;
  -- Serialize saves through this endpoint, including team-only reservations without people.
  PERFORM pg_advisory_xact_lock(hashtext('aclean:schedule-plan'));
  SELECT * INTO old_row FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF p_expected IS NULL AND old_row.id IS NOT NULL THEN RAISE EXCEPTION 'Job sudah ada; muat ulang sebelum mengubah'; END IF;
  IF p_expected IS NOT NULL THEN
    IF old_row.id IS NULL THEN RAISE EXCEPTION 'Job tidak ditemukan'; END IF;
    IF old_row.status NOT IN ('PENDING','CONFIRMED','DISPATCHED') OR old_row.project_id IS NOT NULL THEN RAISE EXCEPTION 'Job berjalan/ditutup atau project harus diubah melalui alur operasional terkait'; END IF;
    SELECT jsonb_object_agg(k,to_jsonb(old_row)->k) INTO expected_value FROM unnest(ARRAY['date','time','time_end','team_slot','status','notes','teknisi','teknisi2','teknisi3','helper','helper2','helper3']) k;
    IF expected_value IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Planning berubah oleh admin lain. Tutup dan buka ulang job.' USING ERRCODE='40001'; END IF;
    IF p_plan->>'service' IS DISTINCT FROM old_row.service THEN RAISE EXCEPTION 'Jenis servis job tidak dapat diubah'; END IF;
    IF length(trim(coalesce(p_reason,'')))<5 THEN RAISE EXCEPTION 'Alasan perubahan wajib diisi'; END IF;
  END IF;
  IF coalesce(p_plan->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Tanggal wajib diisi'; END IF;
  target_date:=(p_plan->>'date')::date;
  IF old_row.id IS NULL AND target_date<(now() AT TIME ZONE 'Asia/Jakarta')::date THEN RAISE EXCEPTION 'Planning baru harus hari ini atau mendatang'; END IF;
  IF coalesce(p_plan->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR coalesce(p_plan->>'time_end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Jam tidak valid'; END IF;
  start_time:=(p_plan->>'time')::time; end_time:=(p_plan->>'time_end')::time;
  IF start_time<'09:00' OR start_time=end_time OR (start_time<'18:00' AND (end_time<start_time OR end_time>'18:00'))
    OR (start_time>='18:00' AND end_time<start_time AND end_time>'06:00')
    OR upper(public.slot_tsrange(target_date,start_time::text,end_time::text))-lower(public.slot_tsrange(target_date,start_time::text,end_time::text))>interval '12 hours'
  THEN RAISE EXCEPTION 'Jam pekerjaan tidak valid; malam berakhir paling lambat 06:00 esok hari'; END IF;
  target_status:=p_plan->>'status'; team:=nullif(trim(p_plan->>'team_slot'),'');
  IF target_status IS NULL OR target_status NOT IN ('PENDING','CONFIRMED','CANCELLED') OR (target_status='CANCELLED' AND old_row.id IS NULL) THEN RAISE EXCEPTION 'Status planning tidak valid'; END IF;
  IF coalesce(p_plan->>'units','') !~ '^\d+$' OR (p_plan->>'units')::integer NOT BETWEEN 1 AND 100 OR nullif(trim(p_plan->>'service'),'') IS NULL THEN RAISE EXCEPTION 'Layanan/jumlah unit tidak valid'; END IF;
  IF team IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.team_presets p WHERE p.slot=team) AND NOT EXISTS(SELECT 1 FROM public.daily_team_slots d WHERE d.date=target_date AND d.slot=team) AND team IS DISTINCT FROM old_row.team_slot THEN RAISE EXCEPTION 'Team tidak ada pada preset/roster'; END IF;
    IF (start_time>='18:00') IS DISTINCT FROM (team LIKE 'Malam %') THEN RAISE EXCEPTION 'Gunakan slot Malam untuk mulai 18:00 ke atas'; END IF;
    SELECT to_jsonb(d) INTO crew FROM public.daily_team_slots d WHERE d.date=target_date AND d.slot=team FOR SHARE;
    FOR i IN 1..8 LOOP
      member:=nullif(trim(crew->>('member'||i)), '');
      member_role:=coalesce(crew->>('member'||i||'_role'),CASE WHEN i=1 THEN 'teknisi' ELSE 'helper' END);
      IF member IS NOT NULL AND NOT member=ANY(people) THEN
        people:=array_append(people,member);
        IF member_role='teknisi' THEN techs:=array_append(techs,member); ELSE helpers:=array_append(helpers,member); END IF;
      END IF;
    END LOOP;
    IF coalesce(array_length(techs,1),0)=0 AND coalesce(array_length(helpers,1),0)>0 THEN techs:=ARRAY[helpers[1]];helpers:=helpers[2:]; END IF;
  END IF;
  -- Coordinate named personnel with the existing slot-claim path as well.
  FOR person IN SELECT DISTINCT unnest(people) ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtext(person||'|'||target_date::text));
  END LOOP;
  IF target_status<>'CANCELLED' AND team IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.orders o WHERE o.id<>p_order_id AND o.date=target_date AND o.team_slot=team AND o.status IN ('PENDING','CONFIRMED','DISPATCHED','ON_SITE','IN_PROGRESS');
    IF n>=6 THEN RAISE EXCEPTION 'Team sudah memiliki 6 pekerjaan pada tanggal ini'; END IF;
    IF EXISTS(
      SELECT 1 FROM public.orders o LEFT JOIN public.daily_team_slots r ON r.date=o.date AND r.slot=o.team_slot
      WHERE o.id<>p_order_id AND o.date BETWEEN target_date-1 AND target_date+1 AND o.status IN ('PENDING','CONFIRMED','DISPATCHED','ON_SITE','IN_PROGRESS','WORKING')
      AND (o.team_slot=team OR people && ARRAY[o.teknisi,o.teknisi2,o.teknisi3,o.helper,o.helper2,o.helper3,r.member1,r.member2,r.member3,r.member4,r.member5,r.member6,r.member7,r.member8])
      AND (o.time IS NULL OR o.time_end IS NULL OR public.slot_tsrange(target_date,start_time::text,end_time::text) && public.slot_tsrange(o.date,o.time::text,o.time_end::text))
    ) THEN RAISE EXCEPTION 'Slot tim atau anggota bertabrakan dengan pekerjaan lain'; END IF;
  END IF;
  notes_value:=coalesce(p_plan->>'notes','');
  IF length(notes_value)>10000 OR length(coalesce(p_reason,''))>2000 THEN RAISE EXCEPTION 'Catatan terlalu panjang'; END IF;
  IF old_row.id IS NULL THEN
    phone_value:=regexp_replace(coalesce(p_plan->>'phone',''),'[^0-9]','','g');
    IF phone_value LIKE '0%' THEN phone_value:='62'||substr(phone_value,2); END IF;
    IF phone_value !~ '^\d{8,15}$' OR length(trim(coalesce(p_plan->>'customer',''))) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'Nama/nomor pelanggan tidak valid'; END IF;
    IF nullif(p_plan->>'customer_id','') IS NOT NULL THEN
      SELECT * INTO customer_row FROM public.customers WHERE id=p_plan->>'customer_id' FOR UPDATE;
      IF customer_row.id IS NULL OR regexp_replace(customer_row.phone,'^0','62') IS DISTINCT FROM phone_value THEN RAISE EXCEPTION 'Lokasi pelanggan tidak sesuai nomor'; END IF;
    ELSE
      SELECT * INTO customer_row FROM public.customers WHERE phone=phone_value AND lower(trim(name))=lower(trim(p_plan->>'customer')) LIMIT 1 FOR UPDATE;
    END IF;
    IF customer_row.id IS NULL THEN
      INSERT INTO public.customers(name,phone,address,area,notes,is_vip,total_orders,joined_date)
      VALUES(trim(p_plan->>'customer'),phone_value,coalesce(p_plan->>'address',''),coalesce(p_plan->>'area',''),'',false,0,target_date) RETURNING * INTO customer_row;
    END IF;
    SELECT id INTO contract_id FROM public.maintenance_clients WHERE customer_id=customer_row.id LIMIT 1;
    INSERT INTO public.orders(id,customer,customer_id,phone,address,area,service,type,units,date,time,time_end,team_slot,status,notes,source,dispatch,last_changed_by,maintenance_client_id)
    VALUES(p_order_id,customer_row.name,customer_row.id,phone_value,p_plan->>'address',p_plan->>'area',p_plan->>'service',p_plan->>'type',(p_plan->>'units')::integer,target_date,start_time,end_time,team,target_status,notes_value,CASE WHEN p_plan->>'source'='whatsapp' THEN 'whatsapp' ELSE 'manual' END,false,actor,contract_id);
    -- Existing sync_customer_order_stats trigger owns completed-service counters.
  ELSE
    notes_value:=notes_value||E'\n[Planning '||to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD HH24:MI')||' WIB · '||actor||'] '||trim(p_reason);
    UPDATE public.orders SET date=target_date,time=start_time,time_end=end_time,team_slot=team,status=target_status,
      units=(p_plan->>'units')::integer,notes=notes_value,dispatch=false,dispatch_at=NULL,last_changed_by=actor WHERE id=p_order_id;
  END IF;
  -- Clear old-day personnel and reservations in the same transaction as rescheduling.
  UPDATE public.orders SET teknisi=techs[1],teknisi2=techs[2],teknisi3=techs[3],helper=helpers[1],helper2=helpers[2],helper3=helpers[3] WHERE id=p_order_id RETURNING * INTO saved;
  DELETE FROM public.technician_schedule WHERE order_id=p_order_id AND status='ACTIVE';
  IF target_status<>'CANCELLED' THEN
    FOREACH person IN ARRAY people LOOP
      IF public.try_claim_teknisi_slot(person,target_date,p_order_id,p_plan->>'time',p_plan->>'time_end') IS DISTINCT FROM true THEN RAISE EXCEPTION 'Anggota tim tidak tersedia pada jam tersebut'; END IF;
    END LOOP;
  END IF;
  result_value:=jsonb_build_object('order',to_jsonb(saved),'before',CASE WHEN old_row.id IS NULL THEN NULL ELSE to_jsonb(old_row) END,'request',request_value,'reason',p_reason,'replayed',false);
  UPDATE public.operational_mutations SET result=result_value,completed_at=now() WHERE mutation_key=mkey;
  RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.save_schedule_plan(uuid,text,jsonb,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_schedule_plan(uuid,text,jsonb,jsonb,text) TO authenticated;

-- The older Planning Order form writes orders directly. Guard that path too,
-- including cross-date crew overlaps, so it cannot bypass the planning RPC.
CREATE OR REPLACE FUNCTION public.guard_night_order_schedule()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
  IF NEW.date IS NULL OR NEW.time IS NULL OR NEW.time_end IS NULL
     OR NEW.status NOT IN ('PENDING','CONFIRMED','DISPATCHED','ON_SITE','IN_PROGRESS','WORKING')
     OR NOT (NEW.time >= '18:00' OR NEW.time < '09:00') THEN RETURN NEW; END IF;
  IF NEW.time=NEW.time_end
     OR (NEW.time >= '18:00' AND NEW.time_end < NEW.time AND NEW.time_end > '06:00')
     OR upper(public.slot_tsrange(NEW.date,NEW.time::text,NEW.time_end::text))
       - lower(public.slot_tsrange(NEW.date,NEW.time::text,NEW.time_end::text)) > interval '12 hours'
  THEN RAISE EXCEPTION 'Jam malam tidak valid; selesai maksimal 06:00 esok hari'; END IF;
  IF NEW.time >= '18:00' AND NEW.team_slot IS NOT NULL AND NEW.team_slot NOT LIKE 'Malam %' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Pekerjaan malam harus memakai slot Malam';
    ELSIF NEW.date IS DISTINCT FROM OLD.date OR NEW.time IS DISTINCT FROM OLD.time
       OR NEW.time_end IS DISTINCT FROM OLD.time_end OR NEW.team_slot IS DISTINCT FROM OLD.team_slot THEN
      RAISE EXCEPTION 'Pekerjaan malam harus memakai slot Malam';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('aclean:schedule-plan'));
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id<>NEW.id AND o.date BETWEEN NEW.date-1 AND NEW.date+1
      AND o.status IN ('PENDING','CONFIRMED','DISPATCHED','ON_SITE','IN_PROGRESS','WORKING')
      AND o.time IS NOT NULL AND o.time_end IS NOT NULL AND o.time<>o.time_end
      AND public.slot_tsrange(NEW.date,NEW.time::text,NEW.time_end::text)
          && public.slot_tsrange(o.date,o.time::text,o.time_end::text)
      AND ((NEW.team_slot IS NOT NULL AND o.team_slot=NEW.team_slot)
        OR ARRAY[NEW.teknisi,NEW.teknisi2,NEW.teknisi3,NEW.helper,NEW.helper2,NEW.helper3]
           && ARRAY[o.teknisi,o.teknisi2,o.teknisi3,o.helper,o.helper2,o.helper3])
  ) THEN RAISE EXCEPTION 'Slot tim atau anggota bertabrakan dengan pekerjaan lain'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_night_order_schedule ON public.orders;
CREATE TRIGGER trg_guard_night_order_schedule
  BEFORE INSERT OR UPDATE OF status,date,time,time_end,team_slot,teknisi,teknisi2,teknisi3,helper,helper2,helper3
  ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_night_order_schedule();

COMMIT;
