-- Migration 220: one reviewed transfer, one atomic multi-invoice settlement.
-- Legacy browser code ignored ledger errors (the old payment_id column was
-- removed by 029) and marked the UI PAID before persistence. Do not repair or
-- approve historical payments here. Reuse a request ID after uncertain replies.
BEGIN;

-- Existing permissive policies exposed header/proof data to every logged-in
-- field user. Restrictive policies intersect those policies without widening
-- any existing grant or changing the service_role worker policy.
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_financial_roles_220 ON public.payments;
CREATE POLICY payments_financial_roles_220 ON public.payments AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.user_profiles WHERE id=(SELECT auth.uid()) AND active IS DISTINCT FROM false AND role IN ('Owner','Admin','Finance')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.user_profiles WHERE id=(SELECT auth.uid()) AND active IS DISTINCT FROM false AND role IN ('Owner','Admin','Finance')));
DROP POLICY IF EXISTS payments_delete_roles_220 ON public.payments;
CREATE POLICY payments_delete_roles_220 ON public.payments AS RESTRICTIVE FOR DELETE TO authenticated
  USING (EXISTS(SELECT 1 FROM public.user_profiles WHERE id=(SELECT auth.uid()) AND active IS DISTINCT FROM false AND role IN ('Owner','Admin')));
DROP POLICY IF EXISTS payment_suggestions_financial_roles_220 ON public.payment_suggestions;
CREATE POLICY payment_suggestions_financial_roles_220 ON public.payment_suggestions AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS(SELECT 1 FROM public.user_profiles WHERE id=(SELECT auth.uid()) AND active IS DISTINCT FROM false AND role IN ('Owner','Admin','Finance')))
  WITH CHECK (EXISTS(SELECT 1 FROM public.user_profiles WHERE id=(SELECT auth.uid()) AND active IS DISTINCT FROM false AND role IN ('Owner','Admin','Finance')));

ALTER TABLE public.invoice_payments ADD COLUMN IF NOT EXISTS group_payment_id bigint REFERENCES public.payments(id);
ALTER TABLE public.payment_suggestions ADD COLUMN IF NOT EXISTS group_payment_id bigint REFERENCES public.payments(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_payments_group_invoice
  ON public.invoice_payments(group_payment_id,invoice_id) WHERE group_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_suggestions_group
  ON public.payment_suggestions(group_payment_id) WHERE group_payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_group_payment_atomic(
  p_request_id uuid,p_invoice_ids text[],p_total_received numeric,p_paid_at timestamptz,
  p_method text,p_customer_phone text,p_expected jsonb,p_payment_proof_url text DEFAULT NULL,
  p_suggestion_id uuid DEFAULT NULL,p_review_ack boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog
SET lock_timeout='2s' SET statement_timeout='8s' AS $$
DECLARE
  actor text; actor_role text; ids text[]; inv public.invoices%ROWTYPE;
  proof public.payment_suggestions%ROWTYPE; header public.payments%ROWTYPE;
  request jsonb; previous public.operational_mutations%ROWTYPE; expected jsonb;
  result_value jsonb; allocations jsonb:='{}'; invoice_rows jsonb; order_rows jsonb;
  total_due numeric:=0; left_over numeric; allocated numeric; balance numeric;
  locked_count integer:=0; claimed integer; mkey text; proof_url text:=nullif(trim(p_payment_proof_url),'');
  customer_phone text:=public.payment_review_phone(p_customer_phone); first_customer text;
  payment_date date:=(p_paid_at AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF auth.role()='service_role' THEN actor_role:='service_role'; actor:='service_role';
  ELSE
    SELECT role,name INTO actor_role,actor FROM public.user_profiles
      WHERE id=auth.uid() AND active IS DISTINCT FROM false;
  END IF;
  IF actor_role IS NULL OR actor_role NOT IN ('Owner','Admin','Finance','service_role') THEN
    RAISE EXCEPTION 'Akses pembayaran gabungan ditolak' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR cardinality(p_invoice_ids) IS NULL OR cardinality(p_invoice_ids) NOT BETWEEN 1 AND 20
    OR p_total_received IS NULL OR p_total_received::text IN ('NaN','Infinity','-Infinity')
    OR p_total_received<=0 OR p_total_received<>trunc(p_total_received) OR p_total_received>9007199254740991
    OR payment_date IS NULL OR payment_date<'2000-01-01' OR payment_date>(now() AT TIME ZONE 'Asia/Jakarta')::date
    OR p_method IS NULL OR p_method NOT IN ('transfer','transfer_bca','transfer_bni','transfer_bri','transfer_mandiri','transfer_gopay','transfer_ovo','transfer_dana','cash','qris','lainnya')
    OR length(customer_phone)<8 OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
    OR NOT coalesce(p_review_ack,false) OR length(coalesce(proof_url,''))>4096 THEN
    RAISE EXCEPTION 'Periksa pilihan invoice, nominal rupiah, tanggal, metode dan konfirmasi bukti';
  END IF;
  SELECT array_agg(DISTINCT id ORDER BY id) INTO ids FROM unnest(p_invoice_ids) id;
  IF cardinality(ids)<>cardinality(p_invoice_ids) OR EXISTS(SELECT 1 FROM unnest(ids) id WHERE nullif(trim(id),'') IS NULL OR length(id)>100)
    OR (SELECT count(*) FROM jsonb_object_keys(p_expected))<>cardinality(ids) THEN
    RAISE EXCEPTION 'Daftar invoice duplikat/tidak lengkap';
  END IF;
  request:=jsonb_build_object('ids',ids,'amount',p_total_received,'paid_at',p_paid_at,'method',p_method,
    'phone',customer_phone,'expected',p_expected,'proof',proof_url,'suggestion',p_suggestion_id);
  mkey:='group-payment:'||p_request_id::text;
  -- Lock proof first, matching the existing reviewed WA settlement lock order.
  IF proof_url IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(proof_url,2)); END IF;
  INSERT INTO public.operational_mutations(mutation_key,operation,actor_id,actor_name)
    VALUES(mkey,'GROUP_PAYMENT',auth.uid(),actor) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed=ROW_COUNT;
  IF claimed=0 THEN
    SELECT * INTO previous FROM public.operational_mutations WHERE mutation_key=mkey;
    IF previous.operation IS DISTINCT FROM 'GROUP_PAYMENT' OR previous.actor_id IS DISTINCT FROM auth.uid()
      OR previous.result->'request' IS DISTINCT FROM request OR previous.completed_at IS NULL THEN
      RAISE EXCEPTION 'ID pembayaran sudah digunakan untuk permintaan berbeda; periksa riwayat';
    END IF;
    IF (SELECT count(*) FROM public.invoices WHERE id=ANY(ids))<>cardinality(ids)
      OR EXISTS(SELECT 1 FROM public.invoices i JOIN jsonb_array_elements(previous.result->'invoices') saved ON saved->>'id'=i.id
      WHERE i.id=ANY(ids) AND jsonb_build_object('total',coalesce(i.total,0),'paid_amount',coalesce(i.paid_amount,0),
        'remaining_amount',i.remaining_amount,'status',i.status,'proof',i.payment_proof_url)
      IS DISTINCT FROM jsonb_build_object('total',(saved->>'total')::numeric,'paid_amount',(saved->>'paid_amount')::numeric,
        'remaining_amount',(saved->>'remaining_amount')::numeric,'status',saved->>'status','proof',saved->>'payment_proof_url')) THEN
      RAISE EXCEPTION 'Permintaan sudah tersimpan tetapi saldo terbaru berubah; muat ulang riwayat, jangan membayar ulang';
    END IF;
    RETURN (previous.result-'request')||jsonb_build_object('replayed',true);
  END IF;

  -- Stable ID lock order prevents two admins selecting overlapping groups from
  -- locking the same invoices in opposite orders. Allocation order is oldest first.
  FOR inv IN SELECT * FROM public.invoices WHERE id=ANY(ids) ORDER BY id FOR UPDATE LOOP
    locked_count:=locked_count+1;
    expected:=jsonb_build_object('total',coalesce(inv.total,0),'paid_amount',coalesce(inv.paid_amount,0),
      'remaining_amount',inv.remaining_amount,'withheld_amount',coalesce(inv.withheld_amount,0),
      'status',inv.status,'phone',coalesce(inv.phone,''),'customer',coalesce(inv.customer,''),'job_id',inv.job_id);
    IF expected IS DISTINCT FROM p_expected->inv.id THEN
      RAISE EXCEPTION 'Invoice berubah sejak pratinjau; muat ulang dan periksa riwayat' USING ERRCODE='40001';
    END IF;
    balance:=coalesce(inv.total,0)-coalesce(inv.paid_amount,0);
    IF coalesce(inv.status,'') NOT IN ('UNPAID','OVERDUE','PARTIAL_PAID') OR balance<=0
      OR coalesce(inv.paid_amount,0)<0 OR coalesce(inv.paid_amount,0)<>trunc(coalesce(inv.paid_amount,0))
      OR coalesce(inv.paid_amount,0)::text IN ('NaN','Infinity','-Infinity') OR coalesce(inv.withheld_amount,0)<>0
      OR (inv.remaining_amount IS NOT NULL AND inv.remaining_amount<>balance) THEN
      RAISE EXCEPTION 'Saldo/status invoice tidak valid; periksa riwayat pembayaran';
    END IF;
    IF public.payment_review_phone(inv.phone) IS DISTINCT FROM customer_phone THEN
      RAISE EXCEPTION 'Nomor customer antar-invoice berbeda';
    END IF;
    IF (SELECT coalesce(sum(amount+withheld_amount),0) FROM public.invoice_payments WHERE invoice_id=inv.id)>coalesce(inv.paid_amount,0) THEN
      RAISE EXCEPTION 'Ledger melebihi saldo tercatat; periksa pembayaran terdahulu';
    END IF;
    first_customer:=coalesce(first_customer,inv.customer);
    total_due:=total_due+balance;
  END LOOP;
  IF locked_count<>cardinality(ids) THEN RAISE EXCEPTION 'Invoice terpilih tidak ditemukan'; END IF;
  IF p_total_received>total_due THEN RAISE EXCEPTION 'Nominal melebihi sisa tagihan; kelebihan tidak boleh dibuang'; END IF;
  PERFORM id FROM public.orders WHERE id IN (SELECT job_id FROM public.invoices WHERE id=ANY(ids)) OR invoice_id=ANY(ids) ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.orders o JOIN public.invoices i ON o.id=i.job_id OR o.invoice_id=i.id
    WHERE i.id=ANY(ids) AND ((o.invoice_id IS NOT NULL AND o.invoice_id<>i.id)
      OR (nullif(trim(o.customer),'') IS NOT NULL AND lower(trim(o.customer)) IS DISTINCT FROM lower(trim(i.customer))))) THEN
    RAISE EXCEPTION 'Hubungan customer/order dan invoice tidak sesuai; periksa sebelum pembayaran';
  END IF;
  IF EXISTS(SELECT 1 FROM public.orders WHERE (id IN (SELECT job_id FROM public.invoices WHERE id=ANY(ids)) OR invoice_id=ANY(ids)) AND status='CANCELLED') THEN
    RAISE EXCEPTION 'Job terkait dibatalkan; periksa invoice';
  END IF;
  IF p_suggestion_id IS NOT NULL THEN
    SELECT * INTO proof FROM public.payment_suggestions WHERE id=p_suggestion_id FOR UPDATE;
    IF NOT FOUND OR proof_url IS NULL OR proof.image_url IS DISTINCT FROM proof_url
      OR proof.amount IS DISTINCT FROM p_total_received OR proof.status IS DISTINCT FROM 'PENDING'
      OR proof.validation_status IS DISTINCT FROM 'PENDING' OR proof.group_payment_id IS NOT NULL
      OR (proof.invoice_id IS NOT NULL AND NOT(proof.invoice_id=ANY(ids))) THEN
      RAISE EXCEPTION 'Bukti/nominal berubah atau sudah digunakan; periksa bukti WA';
    END IF;
  END IF;
  IF proof_url IS NOT NULL AND (
    EXISTS(SELECT 1 FROM public.payments WHERE payment_proof_url=proof_url)
    OR EXISTS(SELECT 1 FROM public.payment_suggestions WHERE image_url=proof_url AND status='CONFIRMED' AND validation_status='LINKED')
    OR EXISTS(SELECT 1 FROM public.invoices WHERE payment_proof_url=proof_url AND
      (status IN ('PAID','PARTIAL_PAID') OR coalesce(paid_amount,0)>0))
  ) THEN RAISE EXCEPTION 'Bukti ini sudah digunakan; periksa riwayat sebelum membayar ulang'; END IF;

  left_over:=p_total_received;
  FOR inv IN SELECT * FROM public.invoices WHERE id=ANY(ids) ORDER BY created_at ASC NULLS FIRST,id LOOP
    EXIT WHEN left_over<=0;
    allocated:=least(left_over,inv.total-coalesce(inv.paid_amount,0));
    allocations:=allocations||jsonb_build_object(inv.id,allocated);
    left_over:=left_over-allocated;
  END LOOP;
  INSERT INTO public.payments(customer_phone,customer_name,total_amount,amount,method,is_partial,invoice_ids,
    allocation_detail,payment_proof_url,paid_at,notes)
    VALUES(customer_phone,first_customer,p_total_received,p_total_received,p_method,p_total_received<total_due,ids,
      allocations,proof_url,p_paid_at,'Group payment: '||array_to_string(ids,', ')) RETURNING * INTO header;
  FOR inv IN SELECT * FROM public.invoices WHERE id=ANY(ids) ORDER BY id LOOP
    allocated:=coalesce((allocations->>inv.id)::numeric,0);
    CONTINUE WHEN allocated<=0;
    balance:=inv.total-coalesce(inv.paid_amount,0)-allocated;
    INSERT INTO public.invoice_payments(invoice_id,group_payment_id,amount,method,notes,paid_at,recorded_by,recorded_by_name)
      VALUES(inv.id,header.id,allocated,p_method,'Group payment #'||header.id,payment_date,auth.uid()::text,actor);
    UPDATE public.invoices SET paid_amount=coalesce(inv.paid_amount,0)+allocated,remaining_amount=balance,
      status=CASE WHEN balance=0 THEN 'PAID' ELSE 'PARTIAL_PAID' END,
      paid_at=CASE WHEN balance=0 THEN p_paid_at ELSE inv.paid_at END,paid_method=p_method,
      payment_proof_url=coalesce(proof_url,inv.payment_proof_url),last_changed_by=actor,pdf_url=NULL,pdf_generated_at=NULL
      WHERE id=inv.id;
    IF balance=0 THEN
      UPDATE public.orders SET status='PAID',last_changed_by=actor WHERE id=inv.job_id OR invoice_id=inv.id;
    END IF;
  END LOOP;
  -- Existing BEFORE triggers may rewrite prices even on a status update. Never
  -- commit a ledger against a different total than the admin reviewed.
  IF EXISTS(SELECT 1 FROM public.invoices i WHERE i.id=ANY(ids) AND
    ((i.total::numeric IS DISTINCT FROM (p_expected->i.id->>'total')::numeric)
      OR (coalesce(i.paid_amount,0) IS DISTINCT FROM ((p_expected->i.id->>'paid_amount')::numeric+coalesce((allocations->>i.id)::numeric,0)))
      OR (allocations ? i.id AND (i.remaining_amount IS DISTINCT FROM (i.total-i.paid_amount)
        OR i.status IS DISTINCT FROM CASE WHEN i.total=i.paid_amount THEN 'PAID' ELSE 'PARTIAL_PAID' END)))) THEN
    RAISE EXCEPTION 'Nilai invoice berubah saat disimpan; seluruh pembayaran dibatalkan, periksa rincian invoice';
  END IF;
  -- One update per customer, not per invoice. Do not move last_service backwards.
  UPDATE public.customers SET last_service=greatest(last_service,payment_date)
    WHERE public.payment_review_phone(phone)=customer_phone;
  IF p_suggestion_id IS NOT NULL THEN
    UPDATE public.payment_suggestions SET status='CONFIRMED',validation_status='LINKED',group_payment_id=header.id,
      invoice_id=CASE WHEN cardinality(ids)=1 THEN ids[1] ELSE NULL END,
      order_id=CASE WHEN cardinality(ids)=1 THEN (SELECT job_id FROM public.invoices WHERE id=ids[1]) ELSE NULL END,
      matched_at=now(),match_source='manual_group',resolved_at=now(),resolved_by=actor
      WHERE id=p_suggestion_id RETURNING * INTO proof;
  END IF;
  SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) INTO invoice_rows FROM public.invoices i WHERE id=ANY(ids);
  SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') INTO order_rows FROM public.orders o
    WHERE o.id IN (SELECT job_id FROM public.invoices WHERE id=ANY(ids)) OR o.invoice_id=ANY(ids);
  result_value:=jsonb_build_object('payment',to_jsonb(header),'invoices',invoice_rows,'orders',order_rows,
    'suggestion',CASE WHEN p_suggestion_id IS NOT NULL THEN to_jsonb(proof) ELSE NULL END,'replayed',false);
  UPDATE public.operational_mutations SET result=result_value||jsonb_build_object('request',request),completed_at=now() WHERE mutation_key=mkey;
  RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.record_group_payment_atomic(uuid,text[],numeric,timestamptz,text,text,jsonb,text,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_group_payment_atomic(uuid,text[],numeric,timestamptz,text,text,jsonb,text,uuid,boolean) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
