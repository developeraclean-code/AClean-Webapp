-- 174 — Satu quotation hanya boleh melahirkan satu order, termasuk dua admin/tab.
BEGIN;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS source_quotation_id text;
UPDATE public.orders o SET source_quotation_id = q.id
  FROM public.quotations q
 WHERE q.job_id = o.id AND o.source_quotation_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_source_quotation_id
  ON public.orders(source_quotation_id) WHERE source_quotation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.approve_quotation_order_atomic(
  p_quotation_id text, p_job_id text, p_order jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  actor_role text;
  quo public.quotations%ROWTYPE;
  existing public.orders%ROWTYPE;
  created public.orders%ROWTYPE;
BEGIN
  actor_role := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Akses approve quotation ditolak' USING ERRCODE = '42501';
  END IF;
  IF nullif(trim(p_quotation_id),'') IS NULL OR nullif(trim(p_job_id),'') IS NULL
     OR jsonb_typeof(p_order) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Data approve quotation tidak lengkap';
  END IF;

  SELECT * INTO quo FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation tidak ditemukan'; END IF;
  SELECT * INTO existing FROM public.orders WHERE source_quotation_id = p_quotation_id;
  IF FOUND THEN
    IF quo.status IS DISTINCT FROM 'APPROVED' OR quo.job_id IS DISTINCT FROM existing.id THEN
      UPDATE public.quotations SET status='APPROVED',job_id=existing.id,updated_at=now()
       WHERE id=p_quotation_id;
    END IF;
    RETURN jsonb_build_object('order',to_jsonb(existing),'replayed',true);
  END IF;
  IF quo.status NOT IN ('DRAFT','SENT') THEN RAISE EXCEPTION 'Quotation tidak dapat di-approve dari status %', quo.status; END IF;
  IF quo.job_id IS NOT NULL THEN RAISE EXCEPTION 'Quotation sudah terhubung ke order %', quo.job_id; END IF;

  INSERT INTO public.orders
    (id,customer,phone,address,area,service,type,units,date,time,time_end,
     status,dispatch,source,notes,maintenance_client_id,source_quotation_id)
  VALUES
    (p_job_id,quo.customer,quo.phone,quo.address,quo.area,
     p_order->>'service',p_order->>'type',coalesce((p_order->>'units')::integer,1),
     (p_order->>'date')::date,coalesce(p_order->>'time','09:00'),
     coalesce(p_order->>'time_end','11:00'),'PENDING',false,'quotation',
     p_order->>'notes',nullif(p_order->>'maintenance_client_id','')::uuid,p_quotation_id)
  RETURNING * INTO created;

  UPDATE public.quotations SET status='APPROVED',job_id=created.id,updated_at=now()
   WHERE id=p_quotation_id;
  RETURN jsonb_build_object('order',to_jsonb(created),'replayed',false);
END $$;

REVOKE ALL ON FUNCTION public.approve_quotation_order_atomic(text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_quotation_order_atomic(text,text,jsonb) TO authenticated, service_role;
COMMIT;
