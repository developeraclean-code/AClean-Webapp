-- B2B invoice + source log links commit together. No historical invoices/prices are repriced.
BEGIN;
ALTER TABLE public.maintenance_logs ADD COLUMN IF NOT EXISTS invoice_id text
  REFERENCES public.invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_maintenance_logs_invoice_id ON public.maintenance_logs(invoice_id);

CREATE OR REPLACE FUNCTION public.create_maintenance_invoice_atomic(
  p_invoice jsonb, p_log_ids uuid[], p_snapshot jsonb, p_actor_name text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  client public.maintenance_clients%ROWTYPE; inv public.invoices%ROWTYPE;
  cid uuid; ids uuid[]; n integer; linked_id text; lines jsonb; amount numeric; cut numeric;
  actor text := coalesce(nullif(trim(p_actor_name),''),'Owner/Admin');
BEGIN
  -- Price calculation is trusted server code after the endpoint's Owner/Admin gate.
  -- Do not expose this server-only writer to anon/authenticated callers with arbitrary amounts.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Akses pembuatan invoice maintenance ditolak' USING ERRCODE='42501';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_log_ids) x;
  n := cardinality(ids);
  IF n IS NULL OR n<1 OR n>200 OR n<>cardinality(p_log_ids) OR array_position(ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Pilih 1–200 log unik';
  END IF;
  cid := (p_invoice->>'maintenance_client_id')::uuid;
  SELECT * INTO client FROM public.maintenance_clients WHERE id=cid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perusahaan tidak ditemukan'; END IF;
  -- Same lock order as order finalization: order first, then maintenance logs.
  PERFORM o.id FROM public.orders o WHERE o.id IN
    (SELECT l.order_id FROM public.maintenance_logs l WHERE l.id=ANY(ids)) ORDER BY o.id FOR UPDATE;
  PERFORM l.id FROM public.maintenance_logs l WHERE l.id=ANY(ids) ORDER BY l.id FOR UPDATE;
  IF (SELECT count(*) FROM public.maintenance_logs WHERE id=ANY(ids) AND client_id=cid)<>n THEN
    RAISE EXCEPTION 'Ada log hilang atau bukan milik perusahaan ini';
  END IF;
  lines := (p_invoice->>'materials_detail')::jsonb;
  IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines)<>n THEN
    RAISE EXCEPTION 'Item invoice tidak lengkap';
  END IF;
  cut := (p_invoice->>'discount')::numeric;
  IF cut IS NULL OR cut<0 OR cut<>trunc(cut) OR cut::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Diskon tidak valid';
  END IF;

  -- Timeout/retry with exactly the same source set returns the first result.
  SELECT min(invoice_id) INTO linked_id FROM public.maintenance_logs WHERE id=ANY(ids);
  IF linked_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.maintenance_logs WHERE id=ANY(ids) AND invoice_id IS DISTINCT FROM linked_id) THEN
    SELECT * INTO inv FROM public.invoices WHERE id=linked_id;
    IF FOUND AND inv.status<>'CANCELLED'
      AND (SELECT count(*) FROM public.maintenance_logs WHERE invoice_id=linked_id)=n
      AND inv.discount IS NOT DISTINCT FROM cut
      AND inv.notes IS NOT DISTINCT FROM nullif(trim(p_invoice->>'notes'),'')
      AND inv.materials_detail::jsonb IS NOT DISTINCT FROM lines THEN
      RETURN jsonb_build_object('invoice',to_jsonb(inv),'replayed',true);
    END IF;
    RAISE EXCEPTION 'Log sudah digunakan invoice lain atau isi permintaan berubah';
  END IF;
  IF EXISTS(SELECT 1 FROM public.maintenance_logs WHERE id=ANY(ids) AND (invoiced IS TRUE OR invoice_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Log sudah ditagih; gunakan invoice yang ada';
  END IF;
  IF EXISTS(SELECT 1 FROM public.maintenance_logs l JOIN public.orders o ON o.id=l.order_id
    WHERE l.id=ANY(ids) AND (o.status='CANCELLED' OR EXISTS
      (SELECT 1 FROM public.invoices i WHERE i.status<>'CANCELLED' AND (i.id=o.invoice_id OR i.job_id=o.id)))) THEN
    RAISE EXCEPTION 'Pekerjaan sudah memiliki invoice atau dibatalkan; gunakan Mode Gabung Invoice';
  END IF;
  IF EXISTS(SELECT 1 FROM public.maintenance_logs l JOIN public.invoices i ON i.job_id=l.order_id
    WHERE l.id=ANY(ids) AND i.status<>'CANCELLED') THEN
    RAISE EXCEPTION 'Pekerjaan sudah memiliki invoice';
  END IF;

  -- Reject edits made after the API's authoritative read, before any insert happens.
  IF jsonb_typeof(p_snapshot->'logs') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_snapshot->'logs')<>n OR EXISTS (
      SELECT 1 FROM public.maintenance_logs l LEFT JOIN jsonb_to_recordset(p_snapshot->'logs') AS e(
        id uuid, client_id uuid, unit_id uuid, service_type text, service_category text, service_date date, cost bigint, order_id text
      ) ON e.id=l.id WHERE l.id=ANY(ids) AND (e.id IS NULL OR e.client_id IS DISTINCT FROM l.client_id
        OR e.unit_id IS DISTINCT FROM l.unit_id OR e.service_type IS DISTINCT FROM l.service_type
        OR e.service_category IS DISTINCT FROM l.service_category OR e.service_date IS DISTINCT FROM l.service_date
        OR e.cost IS DISTINCT FROM l.cost OR e.order_id IS DISTINCT FROM l.order_id)
    ) THEN RAISE EXCEPTION 'Log berubah; preview kembali sebelum membuat invoice'; END IF;
  PERFORM u.id FROM public.maintenance_units u WHERE u.id IN
    (SELECT l.unit_id FROM public.maintenance_logs l WHERE l.id=ANY(ids)) ORDER BY u.id FOR SHARE;
  IF EXISTS(SELECT 1 FROM public.maintenance_logs l LEFT JOIN public.maintenance_units u ON u.id=l.unit_id
    LEFT JOIN jsonb_to_recordset(p_snapshot->'units') AS e(id uuid,client_id uuid,ac_type text,capacity_pk numeric) ON e.id=u.id
    WHERE l.id=ANY(ids) AND (u.id IS NULL OR u.client_id IS DISTINCT FROM cid OR e.id IS NULL
      OR e.ac_type IS DISTINCT FROM u.ac_type OR e.capacity_pk IS DISTINCT FROM u.capacity_pk)) THEN
    RAISE EXCEPTION 'Aset/kapasitas berubah; preview kembali sebelum membuat invoice';
  END IF;
  PERFORM p.id FROM public.maintenance_client_prices p WHERE p.client_id=cid ORDER BY p.id FOR SHARE;
  IF jsonb_typeof(p_snapshot->'prices') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_snapshot->'prices')<>(SELECT count(*) FROM public.maintenance_client_prices WHERE client_id=cid)
    OR EXISTS(SELECT 1 FROM public.maintenance_client_prices p LEFT JOIN jsonb_to_recordset(p_snapshot->'prices') AS e(
      id uuid,service_type text,ac_type text,capacity_pk numeric,unit_price bigint,included_in_service boolean
    ) ON e.id=p.id WHERE p.client_id=cid AND (e.id IS NULL OR e.service_type IS DISTINCT FROM p.service_type
      OR e.ac_type IS DISTINCT FROM p.ac_type OR e.capacity_pk IS DISTINCT FROM p.capacity_pk
      OR e.unit_price IS DISTINCT FROM p.unit_price OR e.included_in_service IS DISTINCT FROM p.included_in_service)) THEN
    RAISE EXCEPTION 'Harga khusus berubah; preview kembali sebelum membuat invoice';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(lines) x WHERE x->>'price_source'='price_list') THEN
    PERFORM 1 FROM public.price_list WHERE service='Cleaning' AND is_active IS TRUE ORDER BY type FOR SHARE;
    IF jsonb_typeof(p_snapshot->'catalog') IS DISTINCT FROM 'array' OR EXISTS (
      (SELECT service,type,price,is_active FROM public.price_list WHERE service='Cleaning' AND is_active IS TRUE
       EXCEPT SELECT e.service,e.type,e.price,e.is_active FROM jsonb_to_recordset(p_snapshot->'catalog')
         AS e(service text,type text,price numeric,is_active boolean))
      UNION ALL
      (SELECT e.service,e.type,e.price,e.is_active FROM jsonb_to_recordset(p_snapshot->'catalog')
         AS e(service text,type text,price numeric,is_active boolean)
       EXCEPT SELECT service,type,price,is_active FROM public.price_list WHERE service='Cleaning' AND is_active IS TRUE)
    ) THEN RAISE EXCEPTION 'Price list berubah; preview kembali sebelum membuat invoice'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(lines) x WHERE
    NOT ((x->>'log_id')::uuid=ANY(ids)) OR (x->>'jumlah') IS DISTINCT FROM '1'
    OR (x->>'harga_satuan') !~ '^[0-9]+$' OR x->>'subtotal' IS DISTINCT FROM x->>'harga_satuan'
    OR nullif(trim(x->>'nama'),'') IS NULL OR x->>'category' IS DISTINCT FROM 'LABOR')
    OR (SELECT count(DISTINCT x->>'log_id') FROM jsonb_array_elements(lines) x)<>n THEN
    RAISE EXCEPTION 'Item/nilai invoice tidak valid';
  END IF;
  SELECT sum((x->>'subtotal')::numeric) INTO amount FROM jsonb_array_elements(lines) x;
  IF cut>amount OR (p_invoice->>'labor')::numeric IS DISTINCT FROM amount
    OR (p_invoice->>'total')::numeric IS DISTINCT FROM amount-cut
    OR (p_invoice->>'material')::numeric IS DISTINCT FROM 0 OR (p_invoice->>'units')::integer IS DISTINCT FROM n
    OR coalesce(p_invoice->>'id','') !~ '^INV-[0-9]{8}-[A-Z0-9]+$' THEN
    RAISE EXCEPTION 'Total invoice tidak sesuai item';
  END IF;

  INSERT INTO public.invoices(id,customer,phone,address,service,job_id,invoice_type,units,labor,material,
    discount,total,status,maintenance_client_id,materials_detail,notes,sent,paid_amount,remaining_amount,last_changed_by)
  VALUES(p_invoice->>'id',client.name,client.pic_phone,client.address,p_invoice->>'service',NULL,'service',n,amount,0,
    cut,amount-cut,'PENDING_APPROVAL',cid,lines::text,nullif(trim(p_invoice->>'notes'),''),false,0,amount-cut,actor)
  RETURNING * INTO inv;
  UPDATE public.maintenance_logs SET invoiced=true,invoice_id=inv.id WHERE id=ANY(ids);
  UPDATE public.orders SET invoice_id=inv.id,last_changed_by=actor WHERE id IN
    (SELECT order_id FROM public.maintenance_logs WHERE id=ANY(ids));
  RETURN jsonb_build_object('invoice',to_jsonb(inv),'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.create_maintenance_invoice_atomic(jsonb,uuid[],jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_maintenance_invoice_atomic(jsonb,uuid[],jsonb,text) TO service_role;
COMMIT;
