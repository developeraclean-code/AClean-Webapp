-- Migration 246: reject missing JWT/application roles without changing RPC contracts.
-- Definitions captured read-only from production 15 Nov 2026; no data rewrites.
BEGIN;
SET LOCAL lock_timeout='5s';

-- Refuse to overwrite an RPC changed since the read-only 15 Nov capture.
-- Both the captured and verified patched definitions are accepted for reapply.
DO $preflight$
DECLARE expected record; target regprocedure; actual_hash text;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
      ('public.record_invoice_partial_payment_atomic(uuid,text,numeric,text,text,date,text)','6badf7f920a863a03c7d70ddf4de89bc','c83d4ca0309fe27fac836e5b98302585'),
      ('public.settle_invoice_atomic(text,uuid,date,text,text,text,text,text)','d46bef320095929df4f178e7fd2b83d1','8f80ffde55a401db36efde3b6e516fe1'),
      ('public.update_order_workflow_atomic(text,jsonb,text,text)','50f01dcb2c0acb8d898ff8e0a0f6c57c','848a72ae8b012771256a1da302b40be3')
    ) AS fingerprints(signature,original_hash,patched_hash)
  LOOP
    target:=to_regprocedure(expected.signature);
    IF target IS NULL THEN RAISE EXCEPTION 'Missing prerequisite function: %',expected.signature USING ERRCODE='55000'; END IF;
    actual_hash:=md5(pg_get_functiondef(target::oid));
    IF actual_hash NOT IN (expected.original_hash,expected.patched_hash) THEN
      RAISE EXCEPTION 'Definition drift: %. Review the current function before applying this migration',expected.signature USING ERRCODE='55000';
    END IF;
  END LOOP;
END $preflight$;


CREATE OR REPLACE FUNCTION public.settle_invoice_atomic(p_invoice_id text, p_payment_id uuid, p_paid_at date, p_method text DEFAULT 'transfer'::text, p_notes text DEFAULT NULL::text, p_payment_proof_url text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text, p_mutation_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public
AS $function$
DECLARE
  role_name text; actor text; inv public.invoices%ROWTYPE; payment public.invoice_payments%ROWTYPE;
  remaining numeric; result_value jsonb; claimed integer; mkey text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Sesi tidak terautentikasi' USING ERRCODE='42501';
  END IF;
  role_name := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name IS NULL OR role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses pelunasan ditolak' USING ERRCODE='42501'; END IF;
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
END $function$;

REVOKE ALL ON FUNCTION public.settle_invoice_atomic(text,uuid,date,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_invoice_atomic(text,uuid,date,text,text,text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_invoice_partial_payment_atomic(p_payment_id uuid, p_invoice_id text, p_amount numeric, p_method text, p_notes text, p_paid_at date, p_actor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public
AS $function$
DECLARE
  actor_role text;
  actor_name text;
  inv public.invoices%ROWTYPE;
  previous public.invoice_payments%ROWTYPE;
  already_paid numeric;
  remaining numeric;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Sesi tidak terautentikasi' USING ERRCODE='42501';
  END IF;
  actor_role := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role IS NULL OR actor_role NOT IN ('Owner','Admin','Finance','service_role') THEN
    RAISE EXCEPTION 'Akses pembayaran ditolak' USING ERRCODE = '42501';
  END IF;
  IF p_payment_id IS NULL OR nullif(trim(p_invoice_id),'') IS NULL
     OR p_amount IS NULL OR p_amount <= 0 OR p_paid_at IS NULL
     OR nullif(trim(p_method),'') IS NULL THEN
    RAISE EXCEPTION 'Data pembayaran tidak lengkap';
  END IF;

  -- Kunci invoice menserialkan dua admin/tab yang mencatat pembayaran bersamaan.
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tidak ditemukan'; END IF;
  SELECT * INTO previous FROM public.invoice_payments WHERE id = p_payment_id;
  IF FOUND THEN
    IF previous.invoice_id IS DISTINCT FROM p_invoice_id
       OR previous.amount IS DISTINCT FROM p_amount
       OR previous.method IS DISTINCT FROM p_method
       OR previous.paid_at IS DISTINCT FROM p_paid_at
       OR previous.notes IS DISTINCT FROM nullif(trim(p_notes),'') THEN
      RAISE EXCEPTION 'ID pembayaran sudah dipakai untuk data berbeda';
    END IF;
    RETURN jsonb_build_object('invoice',to_jsonb(inv),'payment',to_jsonb(previous),'replayed',true);
  END IF;

  IF inv.status IN ('PAID','CANCELLED') THEN RAISE EXCEPTION 'Invoice sudah lunas/dibatalkan'; END IF;
  already_paid := greatest(0, coalesce(inv.paid_amount, 0));
  remaining := greatest(0, coalesce(inv.total, 0) - already_paid);
  IF p_amount > remaining THEN RAISE EXCEPTION 'Nominal melebihi sisa tagihan (%)', remaining; END IF;

  SELECT name INTO actor_name FROM public.user_profiles WHERE id = auth.uid();
  actor_name := coalesce(actor_name, nullif(trim(p_actor_name),''), actor_role);
  INSERT INTO public.invoice_payments
    (id,invoice_id,amount,method,notes,paid_at,recorded_by_name)
  VALUES
    (p_payment_id,p_invoice_id,p_amount,p_method,nullif(trim(p_notes),''),p_paid_at,actor_name)
  RETURNING * INTO previous;

  UPDATE public.invoices
     SET paid_amount = already_paid + p_amount,
         remaining_amount = remaining - p_amount,
         status = CASE WHEN remaining = p_amount THEN 'PAID' ELSE 'PARTIAL_PAID' END,
         paid_at = CASE WHEN remaining = p_amount THEN p_paid_at ELSE paid_at END
   WHERE id = p_invoice_id RETURNING * INTO inv;

  RETURN jsonb_build_object('invoice',to_jsonb(inv),'payment',to_jsonb(previous),'replayed',false);
END $function$;

REVOKE ALL ON FUNCTION public.record_invoice_partial_payment_atomic(uuid,text,numeric,text,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_partial_payment_atomic(uuid,text,numeric,text,text,date,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_order_workflow_atomic(p_order_id text, p_patch jsonb, p_actor_name text DEFAULT NULL::text, p_mutation_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public
AS $function$
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
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Sesi tidak terautentikasi' USING ERRCODE='42501';
  END IF;
  role_name := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name IS NULL OR role_name NOT IN ('Owner','Admin','service_role') THEN
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
END $function$;

REVOKE ALL ON FUNCTION public.update_order_workflow_atomic(text,jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_workflow_atomic(text,jsonb,text,text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
