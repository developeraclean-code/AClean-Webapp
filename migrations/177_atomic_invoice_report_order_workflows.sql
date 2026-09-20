-- 177 — Workflow atomik Invoice → Laporan → Order.
-- Semua RPC mutasi memakai idempotency key: retry/double-click mengembalikan hasil
-- pertama dan tidak membuat pembayaran, laporan, invoice, order, atau slot ganda.

BEGIN;

CREATE TABLE IF NOT EXISTS public.operational_mutations (
  mutation_key text PRIMARY KEY,
  operation text NOT NULL,
  actor_id uuid,
  actor_name text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.operational_mutations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.operational_mutations TO authenticated;
DROP POLICY IF EXISTS operational_mutations_manager_read ON public.operational_mutations;
CREATE POLICY operational_mutations_manager_read ON public.operational_mutations
  FOR SELECT TO authenticated USING (public.get_my_role() IN ('Owner','Admin'));
CREATE INDEX IF NOT EXISTS idx_operational_mutations_created
  ON public.operational_mutations(created_at DESC);

CREATE OR REPLACE FUNCTION public.settle_invoice_atomic(
  p_invoice_id text,
  p_payment_id uuid,
  p_paid_at date,
  p_method text DEFAULT 'transfer',
  p_notes text DEFAULT NULL,
  p_payment_proof_url text DEFAULT NULL,
  p_actor_name text DEFAULT NULL,
  p_mutation_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  role_name text; actor text; inv public.invoices%ROWTYPE; payment public.invoice_payments%ROWTYPE;
  remaining numeric; result_value jsonb; claimed integer; mkey text;
BEGIN
  role_name := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses pelunasan ditolak' USING ERRCODE='42501'; END IF;
  IF nullif(trim(p_invoice_id),'') IS NULL OR p_payment_id IS NULL OR p_paid_at IS NULL OR nullif(trim(p_method),'') IS NULL THEN
    RAISE EXCEPTION 'Data pelunasan tidak lengkap';
  END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid();
  actor:=coalesce(actor,nullif(trim(p_actor_name),''),role_name);
  mkey:=coalesce(nullif(trim(p_mutation_key),''),'settle:'||p_payment_id::text);
  INSERT INTO public.operational_mutations(mutation_key,operation,actor_id,actor_name)
  VALUES(mkey,'SETTLE_INVOICE',auth.uid(),actor) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed=ROW_COUNT;
  IF claimed=0 THEN
    SELECT om.result INTO result_value FROM public.operational_mutations om WHERE om.mutation_key=mkey;
    RETURN result_value||jsonb_build_object('replayed',true);
  END IF;

  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tidak ditemukan'; END IF;
  SELECT * INTO payment FROM public.invoice_payments WHERE id=p_payment_id;
  IF FOUND THEN RAISE EXCEPTION 'ID pembayaran telah digunakan'; END IF;
  IF inv.status NOT IN ('UNPAID','OVERDUE','PARTIAL_PAID','PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'Invoice sudah % — tidak dapat dilunasi ulang',inv.status;
  END IF;
  remaining:=greatest(0,coalesce(inv.total,0)-coalesce(inv.paid_amount,0));
  IF remaining<=0 THEN RAISE EXCEPTION 'Sisa tagihan invoice sudah nol'; END IF;

  INSERT INTO public.invoice_payments(id,invoice_id,amount,method,notes,paid_at,recorded_by,recorded_by_name)
  VALUES(p_payment_id,inv.id,remaining,lower(trim(p_method)),nullif(trim(p_notes),''),p_paid_at,auth.uid()::text,actor)
  RETURNING * INTO payment;

  UPDATE public.invoices SET status='PAID',paid_at=p_paid_at,paid_method=lower(trim(p_method)),
    paid_amount=coalesce(total,0),remaining_amount=0,
    payment_proof_url=coalesce(nullif(trim(p_payment_proof_url),''),payment_proof_url),
    pdf_url=NULL,pdf_generated_at=NULL,last_changed_by=actor
  WHERE id=inv.id RETURNING * INTO inv;
  UPDATE public.orders SET status='PAID',last_changed_by=actor
    WHERE id=inv.job_id OR invoice_id=inv.id;
  IF nullif(trim(inv.phone),'') IS NOT NULL THEN
    UPDATE public.customers SET last_service=p_paid_at WHERE phone=inv.phone;
  END IF;

  result_value:=jsonb_build_object('invoice',to_jsonb(inv),'payment',to_jsonb(payment),'replayed',false);
  UPDATE public.operational_mutations SET result=result_value,completed_at=now() WHERE mutation_key=mkey;
  RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.settle_invoice_atomic(text,uuid,date,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.settle_invoice_atomic(text,uuid,date,text,text,text,text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.submit_service_report_atomic(
  p_report jsonb,
  p_actor_name text DEFAULT NULL,
  p_mutation_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  role_name text; profile_name text; actor text; ord public.orders%ROWTYPE;
  report_row public.service_reports%ROWTYPE; result_value jsonb; claimed integer; mkey text;
  rid text:=nullif(p_report->>'id',''); jid text:=nullif(p_report->>'job_id','');
BEGIN
  role_name:=CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  SELECT name INTO profile_name FROM public.user_profiles WHERE id=auth.uid() AND active IS DISTINCT FROM false;
  actor:=coalesce(profile_name,nullif(trim(p_actor_name),''),role_name);
  IF role_name NOT IN ('Owner','Admin','Teknisi','Helper','service_role') THEN RAISE EXCEPTION 'Akses submit laporan ditolak' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_report) IS DISTINCT FROM 'object' OR rid IS NULL OR jid IS NULL THEN RAISE EXCEPTION 'Payload laporan tidak lengkap'; END IF;
  mkey:=coalesce(nullif(trim(p_mutation_key),''),'report-submit:'||rid);
  INSERT INTO public.operational_mutations(mutation_key,operation,actor_id,actor_name)
  VALUES(mkey,'SUBMIT_REPORT',auth.uid(),actor) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed=ROW_COUNT;
  IF claimed=0 THEN SELECT om.result INTO result_value FROM public.operational_mutations om WHERE om.mutation_key=mkey; RETURN result_value||jsonb_build_object('replayed',true); END IF;

  SELECT * INTO ord FROM public.orders WHERE id=jid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % tidak ditemukan',jid; END IF;
  IF role_name IN ('Teknisi','Helper') AND profile_name NOT IN (ord.teknisi,ord.teknisi2,ord.teknisi3,ord.helper,ord.helper2,ord.helper3) THEN
    RAISE EXCEPTION 'Laporan bukan milik tim pengguna aktif' USING ERRCODE='42501';
  END IF;
  IF ord.customer IS DISTINCT FROM p_report->>'customer' THEN RAISE EXCEPTION 'Customer laporan tidak cocok dengan order'; END IF;

  DELETE FROM public.service_reports WHERE job_id=jid AND id<>rid;
  INSERT INTO public.service_reports(
    id,job_id,teknisi,helper,customer,service,date,status,total_units,total_freon,
    submitted_at,submitted,units,materials_used,foto_urls,fotos,rekomendasi,
    catatan_global,unit_mismatch,is_substitute,hasil_survey,catatan_rekomendasi,last_changed_by
  ) VALUES(
    rid,jid,p_report->>'teknisi',nullif(p_report->>'helper',''),p_report->>'customer',p_report->>'service',
    (p_report->>'date')::date,'SUBMITTED',coalesce((p_report->>'total_units')::integer,0),coalesce((p_report->>'total_freon')::numeric,0),
    coalesce(nullif(p_report->>'submitted_at','')::timestamptz,now()),p_report->>'submitted',
    coalesce(p_report->'units','[]'::jsonb),coalesce(p_report->'materials_used',p_report->'materials','[]'::jsonb),
    coalesce(p_report->'foto_urls','[]'::jsonb),coalesce(p_report->'fotos','[]'::jsonb),coalesce(p_report->>'rekomendasi',''),
    coalesce(p_report->>'catatan_global',''),coalesce((p_report->>'unit_mismatch')::boolean,false),
    coalesce((p_report->>'is_substitute')::boolean,false),p_report->>'hasil_survey',p_report->>'catatan_rekomendasi',actor
  ) ON CONFLICT(id) DO UPDATE SET
    teknisi=excluded.teknisi,helper=excluded.helper,customer=excluded.customer,service=excluded.service,date=excluded.date,
    status='SUBMITTED',total_units=excluded.total_units,total_freon=excluded.total_freon,submitted_at=excluded.submitted_at,
    submitted=excluded.submitted,units=excluded.units,materials_used=excluded.materials_used,foto_urls=excluded.foto_urls,
    fotos=excluded.fotos,rekomendasi=excluded.rekomendasi,catatan_global=excluded.catatan_global,
    unit_mismatch=excluded.unit_mismatch,is_substitute=excluded.is_substitute,hasil_survey=excluded.hasil_survey,
    catatan_rekomendasi=excluded.catatan_rekomendasi,last_changed_by=actor,updated_at=now()
  RETURNING * INTO report_row;
  UPDATE public.orders SET status='REPORT_SUBMITTED',last_changed_by=actor WHERE id=jid;
  UPDATE public.user_profiles SET status='active' WHERE name IN (ord.teknisi,ord.helper) AND active IS DISTINCT FROM false;
  result_value:=jsonb_build_object('report',to_jsonb(report_row),'order_status','REPORT_SUBMITTED','replayed',false);
  UPDATE public.operational_mutations SET result=result_value,completed_at=now() WHERE mutation_key=mkey;
  RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.submit_service_report_atomic(jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_service_report_atomic(jsonb,text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.finalize_service_report_atomic(
  p_report_id text,
  p_invoice jsonb DEFAULT NULL,
  p_actor_name text DEFAULT NULL,
  p_mutation_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  role_name text; actor text; report_row public.service_reports%ROWTYPE; ord public.orders%ROWTYPE;
  inv public.invoices%ROWTYPE; result_value jsonb; claimed integer; mkey text; invoice_status text;
BEGIN
  role_name:=CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','service_role') THEN RAISE EXCEPTION 'Hanya Owner/Admin dapat memfinalisasi laporan' USING ERRCODE='42501'; END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid(); actor:=coalesce(actor,nullif(trim(p_actor_name),''),role_name);
  IF nullif(trim(p_report_id),'') IS NULL THEN RAISE EXCEPTION 'Report ID wajib diisi'; END IF;
  mkey:=coalesce(nullif(trim(p_mutation_key),''),'report-finalize:'||p_report_id);
  INSERT INTO public.operational_mutations(mutation_key,operation,actor_id,actor_name)
  VALUES(mkey,'FINALIZE_REPORT',auth.uid(),actor) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed=ROW_COUNT;
  IF claimed=0 THEN SELECT om.result INTO result_value FROM public.operational_mutations om WHERE om.mutation_key=mkey; RETURN result_value||jsonb_build_object('replayed',true); END IF;

  SELECT * INTO report_row FROM public.service_reports WHERE id=p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Laporan tidak ditemukan'; END IF;
  IF report_row.status NOT IN ('SUBMITTED','REVISION','VERIFIED') THEN RAISE EXCEPTION 'Status laporan % tidak dapat diverifikasi',report_row.status; END IF;
  SELECT * INTO ord FROM public.orders WHERE id=report_row.job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order laporan tidak ditemukan'; END IF;
  SELECT * INTO inv FROM public.invoices WHERE job_id=report_row.job_id AND status<>'CANCELLED' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND AND report_row.service<>'Survey' AND p_invoice IS NOT NULL THEN
    IF nullif(p_invoice->>'id','') IS NULL THEN RAISE EXCEPTION 'Invoice ID wajib diisi'; END IF;
    invoice_status:=coalesce(nullif(p_invoice->>'status',''),'PENDING_APPROVAL');
    INSERT INTO public.invoices(
      id,job_id,laporan_id,customer,phone,address,service,units,teknisi,labor,material,materials_detail,
      discount,trade_in,trade_in_amount,total,status,garansi_days,garansi_expires,due,
      maintenance_client_id,sent,created_at,paid_at,paid_amount,remaining_amount,last_changed_by
    ) VALUES(
      p_invoice->>'id',report_row.job_id,report_row.id,p_invoice->>'customer',p_invoice->>'phone',p_invoice->>'address',
      p_invoice->>'service',coalesce((p_invoice->>'units')::integer,1),p_invoice->>'teknisi',
      coalesce((p_invoice->>'labor')::numeric,0),coalesce((p_invoice->>'material')::numeric,0),p_invoice->>'materials_detail',
      coalesce((p_invoice->>'discount')::numeric,0),coalesce((p_invoice->>'trade_in')::boolean,false),
      coalesce((p_invoice->>'trade_in_amount')::numeric,0),coalesce((p_invoice->>'total')::numeric,0),invoice_status,
      coalesce((p_invoice->>'garansi_days')::integer,30),nullif(p_invoice->>'garansi_expires','')::date,
      nullif(p_invoice->>'due','')::date,nullif(p_invoice->>'maintenance_client_id','')::uuid,
      false,coalesce(nullif(p_invoice->>'created_at','')::timestamptz,now()),
      CASE WHEN invoice_status='PAID' THEN current_date ELSE NULL END,
      CASE WHEN invoice_status='PAID' THEN coalesce((p_invoice->>'total')::numeric,0) ELSE 0 END,
      CASE WHEN invoice_status='PAID' THEN 0 ELSE coalesce((p_invoice->>'total')::numeric,0) END,actor
    ) RETURNING * INTO inv;
  END IF;

  UPDATE public.service_reports SET status='VERIFIED',last_changed_by=actor,updated_at=now() WHERE id=report_row.id RETURNING * INTO report_row;
  UPDATE public.orders SET status=CASE WHEN inv.id IS NOT NULL AND inv.status='PAID' THEN 'PAID' ELSE 'COMPLETED' END,
    invoice_id=coalesce(inv.id,invoice_id),last_changed_by=actor WHERE id=ord.id RETURNING * INTO ord;
  result_value:=jsonb_build_object('report',to_jsonb(report_row),'order',to_jsonb(ord),'invoice',CASE WHEN inv.id IS NULL THEN NULL ELSE to_jsonb(inv) END,'replayed',false);
  UPDATE public.operational_mutations SET result=result_value,completed_at=now() WHERE mutation_key=mkey;
  RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.finalize_service_report_atomic(text,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_service_report_atomic(text,jsonb,text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.create_order_workflow_atomic(
  p_order jsonb,
  p_auto_dispatch boolean DEFAULT false,
  p_actor_name text DEFAULT NULL,
  p_mutation_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  role_name text; actor text; ord public.orders%ROWTYPE; customer_row public.customers%ROWTYPE;
  result_value jsonb; claimed integer; mkey text; slot_ok boolean; normalized_phone text;
  oid text:=nullif(p_order->>'id','');
BEGIN
  role_name:=CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses membuat order ditolak' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_order) IS DISTINCT FROM 'object' OR oid IS NULL THEN RAISE EXCEPTION 'Payload order tidak lengkap'; END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid(); actor:=coalesce(actor,nullif(trim(p_actor_name),''),role_name);
  mkey:=coalesce(nullif(trim(p_mutation_key),''),'order-create:'||oid);
  INSERT INTO public.operational_mutations(mutation_key,operation,actor_id,actor_name)
  VALUES(mkey,'CREATE_ORDER',auth.uid(),actor) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed=ROW_COUNT;
  IF claimed=0 THEN SELECT om.result INTO result_value FROM public.operational_mutations om WHERE om.mutation_key=mkey; RETURN result_value||jsonb_build_object('replayed',true); END IF;

  normalized_phone:=regexp_replace(coalesce(p_order->>'phone',''),'[^0-9]','','g');
  IF normalized_phone LIKE '0%' THEN normalized_phone:='62'||substr(normalized_phone,2); END IF;
  IF nullif(p_order->>'customer_id','') IS NOT NULL THEN
    SELECT * INTO customer_row FROM public.customers WHERE id=(p_order->>'customer_id')::uuid FOR UPDATE;
  END IF;
  IF customer_row.id IS NULL AND normalized_phone<>'' THEN
    SELECT * INTO customer_row FROM public.customers
    WHERE phone=normalized_phone AND lower(trim(name))=lower(trim(p_order->>'customer')) LIMIT 1 FOR UPDATE;
  END IF;
  IF customer_row.id IS NULL AND normalized_phone<>'' THEN
    INSERT INTO public.customers(name,phone,address,area,notes,is_vip,total_orders,joined_date,last_service)
    VALUES(trim(p_order->>'customer'),normalized_phone,coalesce(p_order->>'address',''),coalesce(p_order->>'area',''),'',false,0,
      (p_order->>'date')::date,(p_order->>'date')::date)
    RETURNING * INTO customer_row;
  END IF;

  INSERT INTO public.orders(
    id,customer,customer_id,phone,address,area,service,type,units,teknisi,helper,teknisi2,helper2,teknisi3,helper3,
    date,time,time_end,status,team_slot,invoice_id,dispatch,dispatch_at,notes,parent_job_id,is_multi_day,
    maintenance_client_id,maintenance_unit_ids,source,last_changed_by
  ) VALUES(
    oid,p_order->>'customer',customer_row.id,normalized_phone,p_order->>'address',p_order->>'area',p_order->>'service',p_order->>'type',
    greatest(coalesce((p_order->>'units')::integer,1),1),p_order->>'teknisi',nullif(p_order->>'helper',''),
    nullif(p_order->>'teknisi2',''),nullif(p_order->>'helper2',''),nullif(p_order->>'teknisi3',''),nullif(p_order->>'helper3',''),
    (p_order->>'date')::date,p_order->>'time',p_order->>'time_end',CASE WHEN p_auto_dispatch THEN 'DISPATCHED' ELSE 'CONFIRMED' END,
    nullif(p_order->>'team_slot',''),NULL,p_auto_dispatch,CASE WHEN p_auto_dispatch THEN now() ELSE NULL END,
    coalesce(p_order->>'notes',''),nullif(p_order->>'parent_job_id',''),coalesce((p_order->>'is_multi_day')::boolean,false),
    nullif(p_order->>'maintenance_client_id','')::uuid,coalesce(p_order->'maintenance_unit_ids','[]'::jsonb),
    coalesce(nullif(p_order->>'source',''),'manual'),actor
  ) RETURNING * INTO ord;

  IF nullif(ord.teknisi,'') IS NOT NULL AND ord.date IS NOT NULL AND nullif(ord.time,'') IS NOT NULL AND nullif(ord.time_end,'') IS NOT NULL THEN
    SELECT public.try_claim_teknisi_slot(ord.teknisi,ord.date,ord.id,ord.time,ord.time_end) INTO slot_ok;
    IF slot_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Slot teknisi baru saja terisi'; END IF;
  END IF;
  IF customer_row.id IS NOT NULL THEN
    UPDATE public.customers SET total_orders=coalesce(total_orders,0)+1,last_service=ord.date WHERE id=customer_row.id RETURNING * INTO customer_row;
  END IF;
  result_value:=jsonb_build_object('order',to_jsonb(ord),'customer',CASE WHEN customer_row.id IS NULL THEN NULL ELSE to_jsonb(customer_row) END,'replayed',false);
  UPDATE public.operational_mutations SET result=result_value,completed_at=now() WHERE mutation_key=mkey;
  RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.create_order_workflow_atomic(jsonb,boolean,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_order_workflow_atomic(jsonb,boolean,text,text) TO authenticated,service_role;

COMMIT;
