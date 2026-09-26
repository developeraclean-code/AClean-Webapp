-- 186 — Hardening workflow tersisa dan observabilitas hemat free-tier.
--
-- 1. Edit order + klaim jadwal menjadi satu transaksi database.
-- 2. Link order maintenance + sinkron invoice menjadi satu transaksi, dengan guard relink.
-- 3. Finance summary dipisah dari detail bulan agar halaman awal tidak mengirim payload besar.
-- 4. Rekonsiliasi multi-team menyediakan daftar audit rinci tanpa menebak nilai invoice lama.
-- 5. Metrik performa disimpan sebagai agregat harian (bukan satu row per event).
-- 6. Index agent_logs mengikuti query aktual Monitoring berdasarkan created_at.

BEGIN;

-- Sinkronkan definisi order aktif dengan aplikasi. Versi lama tidak memasukkan
-- WORKING sehingga klaim yang masih sah dapat dianggap basi dan memunculkan
-- bentrok hantu/slot ganda setelah edit.
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
  IF nullif(trim(p_start),'') IS NULL OR nullif(trim(p_end),'') IS NULL OR p_start::time >= p_end::time THEN
    RAISE EXCEPTION 'Jam mulai/selesai tidak valid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_teknisi || '|' || p_date::text));

  DELETE FROM public.technician_schedule ts
   WHERE ts.teknisi=p_teknisi AND ts.date=p_date
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
   WHERE ts.teknisi=p_teknisi AND ts.date=p_date AND ts.status='ACTIVE'
     AND ts.order_id<>p_order_id AND o.status=ANY(c_active)
     AND p_start::time<ts.time_end::time AND p_end::time>ts.time_start::time;
  IF v_cnt>0 THEN RETURN false; END IF;

  INSERT INTO public.technician_schedule(order_id,teknisi,date,time_start,time_end,status)
  VALUES(p_order_id,p_teknisi,p_date,p_start,p_end,'ACTIVE');
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.try_claim_teknisi_slot(text,date,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_claim_teknisi_slot(text,date,text,text,text) TO authenticated, service_role;

-- ── A. Edit order + jadwal atomik ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_order_workflow_atomic(
  p_order_id text,
  p_patch jsonb,
  p_actor_name text DEFAULT NULL,
  p_mutation_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  role_name text;
  actor text;
  ord public.orders%ROWTYPE;
  result_value jsonb;
  claimed integer;
  mkey text;
  slot_ok boolean;
  active_statuses constant text[] := ARRAY['PENDING','CONFIRMED','DISPATCHED','IN_PROGRESS','ON_SITE','WORKING'];
BEGIN
  role_name := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Akses edit order ditolak' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(p_order_id), '') IS NULL OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Payload edit order tidak lengkap';
  END IF;

  SELECT name INTO actor FROM public.user_profiles WHERE id = auth.uid();
  actor := coalesce(actor, nullif(trim(p_actor_name), ''), role_name);
  mkey := coalesce(nullif(trim(p_mutation_key), ''),
    'order-update:' || p_order_id || ':' || md5(p_patch::text));

  INSERT INTO public.operational_mutations(mutation_key, operation, actor_id, actor_name)
  VALUES (mkey, 'UPDATE_ORDER', auth.uid(), actor)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed = ROW_COUNT;
  IF claimed = 0 THEN
    SELECT result INTO result_value FROM public.operational_mutations WHERE mutation_key = mkey;
    RETURN coalesce(result_value, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;

  UPDATE public.orders o SET
    customer  = CASE WHEN p_patch ? 'customer'  THEN p_patch->>'customer'  ELSE o.customer END,
    phone     = CASE WHEN p_patch ? 'phone'     THEN p_patch->>'phone'     ELSE o.phone END,
    address   = CASE WHEN p_patch ? 'address'   THEN p_patch->>'address'   ELSE o.address END,
    area      = CASE WHEN p_patch ? 'area'      THEN p_patch->>'area'      ELSE o.area END,
    service   = CASE WHEN p_patch ? 'service'   THEN p_patch->>'service'   ELSE o.service END,
    type      = CASE WHEN p_patch ? 'type'      THEN p_patch->>'type'      ELSE o.type END,
    units     = CASE WHEN p_patch ? 'units'     THEN greatest(coalesce((p_patch->>'units')::integer, 1), 1) ELSE o.units END,
    teknisi   = CASE WHEN p_patch ? 'teknisi'   THEN nullif(trim(p_patch->>'teknisi'), '') ELSE o.teknisi END,
    helper    = CASE WHEN p_patch ? 'helper'    THEN nullif(trim(p_patch->>'helper'), '') ELSE o.helper END,
    teknisi2  = CASE WHEN p_patch ? 'teknisi2'  THEN nullif(trim(p_patch->>'teknisi2'), '') ELSE o.teknisi2 END,
    helper2   = CASE WHEN p_patch ? 'helper2'   THEN nullif(trim(p_patch->>'helper2'), '') ELSE o.helper2 END,
    teknisi3  = CASE WHEN p_patch ? 'teknisi3'  THEN nullif(trim(p_patch->>'teknisi3'), '') ELSE o.teknisi3 END,
    helper3   = CASE WHEN p_patch ? 'helper3'   THEN nullif(trim(p_patch->>'helper3'), '') ELSE o.helper3 END,
    date      = CASE WHEN p_patch ? 'date'      THEN (p_patch->>'date')::date ELSE o.date END,
    time      = CASE WHEN p_patch ? 'time'      THEN (p_patch->>'time')::time ELSE o.time END,
    time_end  = CASE WHEN p_patch ? 'time_end'  THEN (p_patch->>'time_end')::time ELSE o.time_end END,
    status    = CASE WHEN p_patch ? 'status'    THEN p_patch->>'status' ELSE o.status END,
    notes     = CASE WHEN p_patch ? 'notes'     THEN coalesce(p_patch->>'notes', '') ELSE o.notes END,
    last_changed_by = actor
  WHERE o.id = p_order_id
  RETURNING * INTO ord;

  -- Hapus klaim lama dan buat klaim baru di transaksi yang sama. Jika klaim gagal,
  -- RAISE akan me-rollback order sekaligus mengembalikan klaim lama.
  DELETE FROM public.technician_schedule WHERE order_id = ord.id;
  IF nullif(trim(ord.teknisi), '') IS NOT NULL
     AND ord.date IS NOT NULL
     AND ord.time IS NOT NULL
     AND ord.time_end IS NOT NULL
     AND ord.status = ANY(active_statuses) THEN
    SELECT public.try_claim_teknisi_slot(ord.teknisi, ord.date, ord.id, ord.time::text, ord.time_end::text) INTO slot_ok;
    IF slot_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Slot teknisi baru saja terisi';
    END IF;
  END IF;

  result_value := jsonb_build_object('order', to_jsonb(ord), 'replayed', false);
  UPDATE public.operational_mutations SET result = result_value, completed_at = now()
  WHERE mutation_key = mkey;
  RETURN result_value;
END $$;

REVOKE ALL ON FUNCTION public.update_order_workflow_atomic(text,jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_workflow_atomic(text,jsonb,text,text) TO authenticated, service_role;

-- ── B. Link Maintenance atomik ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.link_order_maintenance_atomic(
  p_order_id text,
  p_client_id uuid,
  p_force_relink boolean DEFAULT false,
  p_actor_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  role_name text;
  actor text;
  ord public.orders%ROWTYPE;
  old_client uuid;
  invoice_count integer := 0;
BEGIN
  role_name := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Akses link maintenance ditolak' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(p_order_id), '') IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION 'Order dan customer maintenance wajib diisi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.maintenance_clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'Customer maintenance tidak ditemukan';
  END IF;

  SELECT name INTO actor FROM public.user_profiles WHERE id = auth.uid();
  actor := coalesce(actor, nullif(trim(p_actor_name), ''), role_name);
  SELECT * INTO ord FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  old_client := ord.maintenance_client_id;

  IF old_client IS NOT NULL AND old_client <> p_client_id AND NOT p_force_relink THEN
    RAISE EXCEPTION 'Order sudah tertaut ke customer maintenance lain; gunakan relink eksplisit';
  END IF;

  UPDATE public.orders SET maintenance_client_id = p_client_id, last_changed_by = actor
  WHERE id = ord.id RETURNING * INTO ord;

  WITH changed AS (
    UPDATE public.invoices
       SET maintenance_client_id = p_client_id,
           last_changed_by = actor,
           pdf_url = NULL,
           pdf_generated_at = NULL
     WHERE (job_id = ord.id OR (
              coalesce(ord.is_team_split, false)
              AND nullif(ord.job_group_id, '') IS NOT NULL
              AND job_id = ord.job_group_id
            ))
       AND status <> 'CANCELLED'
       AND (maintenance_client_id IS NULL OR maintenance_client_id = old_client OR p_force_relink)
    RETURNING id
  ) SELECT count(*) INTO invoice_count FROM changed;

  RETURN jsonb_build_object(
    'order', to_jsonb(ord),
    'previous_client_id', old_client,
    'invoice_linked', invoice_count,
    'relinked', old_client IS NOT NULL AND old_client <> p_client_id
  );
END $$;

REVOKE ALL ON FUNCTION public.link_order_maintenance_atomic(text,uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_order_maintenance_atomic(text,uuid,boolean,text) TO authenticated, service_role;

-- ── C. Finance ringan: summary dahulu, detail hanya saat tab dibuka ─────────
CREATE OR REPLACE FUNCTION public.get_finance_summary_v2(
  p_day date DEFAULT current_date,
  p_month_start date DEFAULT date_trunc('month', current_date)::date,
  p_month_end date DEFAULT (date_trunc('month', current_date) + interval '1 month - 1 day')::date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE role_name text; result jsonb;
BEGIN
  role_name := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses Finance ditolak' USING ERRCODE='42501'; END IF;
  IF p_month_start > p_month_end THEN RAISE EXCEPTION 'Rentang bulan Finance tidak valid'; END IF;
  WITH valid_expenses AS (
    SELECT * FROM public.expenses WHERE deleted_at IS NULL
      AND coalesce(approval_status,'') <> 'PENDING_APPROVAL'
      AND coalesce(validation_status,'') <> 'PENDING_AI'
  ), cash_events AS (
    SELECT i.id,i.job_id,i.customer,i.service,i.status,i.total,ip.amount cash_amount,
           ip.paid_at cash_date,ip.paid_at,i.created_at
      FROM public.invoice_payments ip JOIN public.invoices i ON i.id=ip.invoice_id
    UNION ALL
    SELECT i.id,i.job_id,i.customer,i.service,i.status,i.total,
           CASE WHEN i.status='PAID' THEN coalesce(i.total,0) ELSE coalesce(i.paid_amount,0) END,
           i.paid_at::date,i.paid_at,i.created_at
      FROM public.invoices i
     WHERE i.status IN ('PAID','PARTIAL_PAID') AND i.paid_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=i.id)
  ), day_cash AS (
    SELECT id,job_id,customer,service,max(status) status,max(total) total,
           sum(cash_amount) cash_amount,sum(cash_amount) paid_amount,cash_date paid_at
      FROM cash_events WHERE cash_date=p_day
     GROUP BY id,job_id,customer,service,cash_date
  ), month_expenses AS (
    SELECT * FROM valid_expenses WHERE date BETWEEN p_month_start AND p_month_end
  )
  SELECT jsonb_build_object(
    'generated_at',now(),'day',p_day,'month_start',p_month_start,'month_end',p_month_end,
    'summary',jsonb_build_object(
      'cash_all_time',coalesce((SELECT sum(cash_amount) FROM cash_events),0),
      'expenses_all_time',coalesce((SELECT sum(amount) FROM valid_expenses),0),
      'paid_count',(SELECT count(*) FROM public.invoices WHERE status='PAID'),
      'unpaid_count',(SELECT count(*) FROM public.invoices WHERE status IN ('UNPAID','OVERDUE')),
      'overdue_count',(SELECT count(*) FROM public.invoices WHERE status='OVERDUE'),
      'month_cash',coalesce((SELECT sum(cash_amount) FROM cash_events WHERE cash_date BETWEEN p_month_start AND p_month_end),0),
      'month_expenses',coalesce((SELECT sum(amount) FROM month_expenses),0),
      'day_cash',coalesce((SELECT sum(cash_amount) FROM day_cash),0),
      'day_paid_count',(SELECT count(*) FROM day_cash)
    ),
    'day_cash_rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM day_cash x),'[]'::jsonb),
    'top_expenses',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.total DESC) FROM (
      SELECT coalesce(subcategory,category,'Lain-lain') name,sum(amount) total
      FROM month_expenses GROUP BY coalesce(subcategory,category,'Lain-lain')
      ORDER BY sum(amount) DESC LIMIT 10
    ) x),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_finance_summary_v2(date,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_summary_v2(date,date,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_finance_month_details(
  p_month_start date,
  p_month_end date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE role_name text; result jsonb;
BEGIN
  role_name := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses Finance ditolak' USING ERRCODE='42501'; END IF;
  IF p_month_start IS NULL OR p_month_end IS NULL OR p_month_start > p_month_end THEN RAISE EXCEPTION 'Rentang bulan Finance tidak valid'; END IF;
  WITH valid_expenses AS (
    SELECT id,date,category,subcategory,description,item_name,amount
      FROM public.expenses WHERE deleted_at IS NULL
       AND coalesce(approval_status,'') <> 'PENDING_APPROVAL'
       AND coalesce(validation_status,'') <> 'PENDING_AI'
       AND date BETWEEN p_month_start AND p_month_end
  ), cash_events AS (
    SELECT i.id,i.job_id,i.customer,i.service,i.status,i.total,ip.amount cash_amount,
           ip.amount paid_amount,ip.paid_at cash_date,ip.paid_at,i.created_at
      FROM public.invoice_payments ip JOIN public.invoices i ON i.id=ip.invoice_id
     WHERE ip.paid_at BETWEEN p_month_start AND p_month_end
    UNION ALL
    SELECT i.id,i.job_id,i.customer,i.service,i.status,i.total,
           CASE WHEN i.status='PAID' THEN coalesce(i.total,0) ELSE coalesce(i.paid_amount,0) END,
           CASE WHEN i.status='PAID' THEN coalesce(i.total,0) ELSE coalesce(i.paid_amount,0) END,
           i.paid_at::date,i.paid_at,i.created_at
      FROM public.invoices i
     WHERE i.status IN ('PAID','PARTIAL_PAID') AND i.paid_at::date BETWEEN p_month_start AND p_month_end
       AND NOT EXISTS (SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=i.id)
  ), month_invoices AS (
    SELECT id,job_id,customer,service,max(status) status,max(total) total,
           sum(cash_amount) cash_amount,sum(paid_amount) paid_amount,cash_date paid_at,max(created_at) created_at
      FROM cash_events GROUP BY id,job_id,customer,service,cash_date
  )
  SELECT jsonb_build_object(
    'month_invoices',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY coalesce(x.paid_at::date,x.created_at::date) DESC) FROM month_invoices x),'[]'::jsonb),
    'month_expenses',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.date DESC,x.id) FROM valid_expenses x),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_finance_month_details(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_month_details(date,date) TO authenticated, service_role;

-- ── D. Preview rinci multi-team lama (read-only) ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_team_invoice_reconciliation_preview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE role_name text; result jsonb;
BEGIN
  role_name := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses rekonsiliasi ditolak' USING ERRCODE='42501'; END IF;
  WITH team_rows AS (
    SELECT o.job_group_id group_id,o.id order_id,o.customer,o.date,o.teknisi,
           r.id report_id,r.status report_status,
           EXISTS (SELECT 1 FROM public.team_invoice_parts p WHERE p.report_id=r.id) has_part,
           (SELECT i.id FROM public.invoices i
             WHERE i.job_id=o.job_group_id AND i.status<>'CANCELLED'
             ORDER BY i.created_at DESC NULLS LAST,i.id LIMIT 1) invoice_id
      FROM public.orders o
      LEFT JOIN public.service_reports r ON r.job_id=o.id
     WHERE coalesce(o.is_team_split,false) AND nullif(o.job_group_id,'') IS NOT NULL
  ), groups AS (
    SELECT tr.group_id,
           count(DISTINCT tr.order_id) team_count,
           count(DISTINCT tr.report_id) FILTER (WHERE tr.report_status='VERIFIED') verified_count,
           count(DISTINCT tr.report_id) FILTER (WHERE tr.has_part) part_count,
           count(DISTINCT tr.invoice_id) invoice_count,
           jsonb_agg(jsonb_build_object(
             'order_id',tr.order_id,'customer',tr.customer,'date',tr.date,'teknisi',tr.teknisi,
             'report_id',tr.report_id,'report_status',tr.report_status,'has_part',tr.has_part,
             'invoice_id',tr.invoice_id
           ) ORDER BY tr.order_id,tr.report_id) rows
      FROM team_rows tr GROUP BY tr.group_id
  )
  SELECT jsonb_build_object(
    'groups',coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.group_id) FILTER (
      WHERE g.invoice_count=0 OR g.part_count<g.verified_count
    ),'[]'::jsonb),
    'group_count',count(*) FILTER (WHERE g.invoice_count=0 OR g.part_count<g.verified_count)
  ) INTO result FROM groups g;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_team_invoice_reconciliation_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_invoice_reconciliation_preview() TO authenticated, service_role;

-- ── E. Agregasi performa harian, hemat row dan egress ──────────────────────
CREATE TABLE IF NOT EXISTS public.performance_daily (
  day date NOT NULL,
  metric text NOT NULL,
  role text NOT NULL DEFAULT 'Unknown',
  samples integer NOT NULL DEFAULT 0,
  successes integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  duration_sum_ms bigint NOT NULL DEFAULT 0,
  duration_min_ms integer,
  duration_max_ms integer,
  bucket_le_500 integer NOT NULL DEFAULT 0,
  bucket_le_1000 integer NOT NULL DEFAULT 0,
  bucket_le_3000 integer NOT NULL DEFAULT 0,
  bucket_le_5000 integer NOT NULL DEFAULT 0,
  bucket_gt_5000 integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(day,metric,role)
);
ALTER TABLE public.performance_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS performance_daily_manager_read ON public.performance_daily;
CREATE POLICY performance_daily_manager_read ON public.performance_daily FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('Owner','Admin'));
REVOKE INSERT,UPDATE,DELETE ON public.performance_daily FROM anon,authenticated;
GRANT SELECT ON public.performance_daily TO authenticated;
GRANT ALL ON public.performance_daily TO service_role;

CREATE OR REPLACE FUNCTION public.record_performance_metrics(
  p_metrics jsonb,
  p_role text DEFAULT 'Unknown'
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE item jsonb; metric_name text; duration integer; outcome text; recorded integer:=0; safe_role text; caller_role text;
BEGIN
  IF auth.role() NOT IN ('authenticated','service_role') THEN RAISE EXCEPTION 'Akses metrik ditolak' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(coalesce(p_metrics,'[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_metrics,'[]'::jsonb)) > 20 THEN
    RAISE EXCEPTION 'Batch metrik tidak valid';
  END IF;
  caller_role:=CASE WHEN auth.role()='service_role' THEN nullif(trim(p_role),'') ELSE public.get_my_role() END;
  safe_role:=left(coalesce(caller_role,'Unknown'),30);
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_metrics,'[]'::jsonb)) LOOP
    metric_name:=left(coalesce(item->>'name',''),80);
    duration:=greatest(0,least(coalesce((item->>'durationMs')::integer,0),120000));
    outcome:=coalesce(item->>'outcome','ok');
    IF metric_name !~ '^(bootstrap\.|dashboard\.|view_data\.|finance\.)' THEN CONTINUE; END IF;
    INSERT INTO public.performance_daily(
      day,metric,role,samples,successes,errors,duration_sum_ms,duration_min_ms,duration_max_ms,
      bucket_le_500,bucket_le_1000,bucket_le_3000,bucket_le_5000,bucket_gt_5000
    ) VALUES (
      current_date,metric_name,safe_role,1,(outcome<>'error')::int,(outcome='error')::int,duration,duration,duration,
      (duration<=500)::int,(duration>500 AND duration<=1000)::int,
      (duration>1000 AND duration<=3000)::int,(duration>3000 AND duration<=5000)::int,(duration>5000)::int
    ) ON CONFLICT(day,metric,role) DO UPDATE SET
      samples=performance_daily.samples+1,
      successes=performance_daily.successes+(outcome<>'error')::int,
      errors=performance_daily.errors+(outcome='error')::int,
      duration_sum_ms=performance_daily.duration_sum_ms+duration,
      duration_min_ms=least(performance_daily.duration_min_ms,duration),
      duration_max_ms=greatest(performance_daily.duration_max_ms,duration),
      bucket_le_500=performance_daily.bucket_le_500+(duration<=500)::int,
      bucket_le_1000=performance_daily.bucket_le_1000+(duration>500 AND duration<=1000)::int,
      bucket_le_3000=performance_daily.bucket_le_3000+(duration>1000 AND duration<=3000)::int,
      bucket_le_5000=performance_daily.bucket_le_5000+(duration>3000 AND duration<=5000)::int,
      bucket_gt_5000=performance_daily.bucket_gt_5000+(duration>5000)::int,
      updated_at=now();
    recorded:=recorded+1;
  END LOOP;
  RETURN recorded;
END $$;

REVOKE ALL ON FUNCTION public.record_performance_metrics(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_performance_metrics(jsonb,text) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at_desc ON public.agent_logs(created_at DESC);

COMMIT;
