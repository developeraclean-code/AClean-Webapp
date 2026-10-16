-- Admin-reviewed settlement, including payment from a different finance phone.
-- 2–3% is an OPERATIONAL TOLERANCE on labor, not a statutory tax-rate change.
-- Cash stays in invoice_payments.amount. Withholding is separate noncash credit,
-- explicitly estimated until the customer supplies their tax withholding slip.
-- No historical invoice, payment or suggestion is approved by this migration.
BEGIN;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS withheld_amount numeric NOT NULL DEFAULT 0 CHECK(withheld_amount>=0 AND withheld_amount::text NOT IN ('NaN','Infinity','-Infinity'));
ALTER TABLE public.invoice_payments ADD COLUMN IF NOT EXISTS withheld_amount numeric NOT NULL DEFAULT 0 CHECK(withheld_amount>=0 AND withheld_amount::text NOT IN ('NaN','Infinity','-Infinity'));
ALTER TABLE public.invoice_payments ADD COLUMN IF NOT EXISTS withholding_detail jsonb;

-- A cached browser's legacy Revert/Edit must not silently erase tax credit or
-- leave a PAID invoice with a changed financial basis. A reversal needs a
-- separately audited workflow, not the legacy status-only reset.
CREATE OR REPLACE FUNCTION public.guard_reviewed_withholding_212()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
  IF current_setting('app.reviewed_withholding_write',true)='allowed' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='invoice_payments' THEN
    IF TG_OP IN ('DELETE','UPDATE') THEN
      IF OLD.withheld_amount>0 THEN RAISE EXCEPTION 'Pembayaran dengan potongan PPh tidak boleh diubah/dihapus lewat jalur biasa; perlukan pembalikan terverifikasi'; END IF;
    END IF;
    IF TG_OP IN ('INSERT','UPDATE') THEN
      IF NEW.withheld_amount>0 OR NEW.withholding_detail IS NOT NULL THEN RAISE EXCEPTION 'Potongan PPh hanya boleh dicatat melalui verifikasi atomik'; END IF;
    END IF;
  ELSE
    IF TG_OP='DELETE' AND OLD.withheld_amount>0 THEN RAISE EXCEPTION 'Invoice dengan potongan PPh tidak boleh dihapus'; END IF;
    IF TG_OP='INSERT' AND NEW.withheld_amount>0 THEN RAISE EXCEPTION 'Potongan PPh hanya boleh dicatat melalui verifikasi atomik'; END IF;
    IF TG_OP='UPDATE' THEN
      IF NEW.withheld_amount IS DISTINCT FROM OLD.withheld_amount OR (OLD.withheld_amount>0 AND
        (to_jsonb(NEW)-ARRAY['updated_at','pdf_url','pdf_generated_at','last_changed_by','sent','sent_at','wa_sent_count','wa_last_sent_at','wa_last_sent_by','wa_last_sent_mode','wa_last_sent_method','wa_last_sent_batch']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['updated_at','pdf_url','pdf_generated_at','last_changed_by','sent','sent_at','wa_sent_count','wa_last_sent_at','wa_last_sent_by','wa_last_sent_mode','wa_last_sent_method','wa_last_sent_batch'])) THEN
        RAISE EXCEPTION 'Invoice dengan potongan PPh dikunci untuk perubahan/revert biasa; perlukan pembalikan terverifikasi';
      END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION public.guard_reviewed_withholding_212() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_guard_reviewed_withholding_212 ON public.invoices;
CREATE TRIGGER trg_guard_reviewed_withholding_212 BEFORE INSERT OR UPDATE OR DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_reviewed_withholding_212();
DROP TRIGGER IF EXISTS trg_guard_reviewed_withholding_212 ON public.invoice_payments;
CREATE TRIGGER trg_guard_reviewed_withholding_212 BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_reviewed_withholding_212();

CREATE OR REPLACE FUNCTION public.confirm_invoice_wa_withholding_atomic(
  p_request_id uuid,p_invoice_id text,p_suggestion_id uuid,p_expected_proof_url text,
  p_expected_invoice jsonb,p_paid_at date,p_note text,p_review_ack boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE role_name text; actor text; inv public.invoices%ROWTYPE; proof public.payment_suggestions%ROWTYPE;
  payment public.invoice_payments%ROWTYPE; snapshot jsonb; payload jsonb; detail jsonb;
  remaining numeric; deduction numeric; order_rows jsonb; previous_flag text;
BEGIN
  role_name:=CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name IS NULL OR role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses verifikasi potongan ditolak' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_suggestion_id IS NULL OR nullif(trim(p_expected_proof_url),'') IS NULL
    OR jsonb_typeof(p_expected_invoice) IS DISTINCT FROM 'object' OR p_paid_at IS NULL OR p_paid_at<'2000-01-01'
    OR p_paid_at>(now() AT TIME ZONE 'Asia/Jakarta')::date OR length(trim(coalesce(p_note,''))) NOT BETWEEN 10 AND 1000
    OR NOT coalesce(p_review_ack,false) THEN RAISE EXCEPTION 'Periksa bukti/pengirim/potongan, tanggal dan catatan (10–1000 karakter)'; END IF;
  payload:=jsonb_build_object('invoice',p_invoice_id,'suggestion',p_suggestion_id,'proof',p_expected_proof_url,
    'expected_invoice',p_expected_invoice,'paid_at',p_paid_at,'note',trim(p_note));
  -- Same lock order as migration 206. One media cannot settle two invoices.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_expected_proof_url,2));
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tidak ditemukan'; END IF;
  SELECT * INTO proof FROM public.payment_suggestions WHERE id=p_suggestion_id FOR UPDATE;
  IF NOT FOUND OR proof.image_url IS DISTINCT FROM p_expected_proof_url THEN RAISE EXCEPTION 'Bukti berubah; muat ulang'; END IF;
  SELECT * INTO payment FROM public.invoice_payments WHERE id=p_request_id;
  IF FOUND THEN
    IF payment.invoice_id IS DISTINCT FROM inv.id OR payment.withholding_detail->'request' IS DISTINCT FROM payload
      OR inv.status IS DISTINCT FROM 'PAID' OR inv.payment_proof_url IS DISTINCT FROM proof.image_url
      OR proof.invoice_id IS DISTINCT FROM inv.id OR proof.status IS DISTINCT FROM 'CONFIRMED' OR proof.validation_status IS DISTINCT FROM 'LINKED' THEN
      RAISE EXCEPTION 'ID pembayaran telah digunakan atau hasil berubah; periksa riwayat';
    END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) INTO order_rows FROM public.orders o WHERE o.id=inv.job_id OR o.invoice_id=inv.id;
    RETURN jsonb_build_object('invoice',to_jsonb(inv),'payment',to_jsonb(payment),'suggestion',to_jsonb(proof),'orders',order_rows,'replayed',true);
  END IF;
  snapshot:=jsonb_build_object('total',coalesce(inv.total,0),'labor',coalesce(inv.labor,0),
    'paid_amount',coalesce(inv.paid_amount,0),'withheld_amount',inv.withheld_amount,
    'pph23',coalesce(inv.pph23,false),'pph23_amount',coalesce(inv.pph23_amount,0),
    'status',inv.status,'phone',coalesce(inv.phone,''),'materials_detail',inv.materials_detail);
  IF snapshot IS DISTINCT FROM p_expected_invoice THEN RAISE EXCEPTION 'Invoice berubah sejak pratinjau; muat ulang dan periksa lagi'; END IF;
  IF inv.status IS NULL OR inv.status NOT IN ('UNPAID','OVERDUE','PARTIAL_PAID')
    OR coalesce(proof.status,'') NOT IN ('PENDING','DISMISSED') OR proof.validation_status IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'Invoice/bukti sudah diproses atau dibatalkan'; END IF;
  IF proof.invoice_id IS NOT NULL AND public.payment_review_invoice_target(proof.invoice_id)<>inv.id THEN RAISE EXCEPTION 'Bukti tertaut ke invoice lain'; END IF;
  IF inv.pph23 IS TRUE OR coalesce(inv.pph23_amount,0)>0 THEN RAISE EXCEPTION 'Invoice sudah memakai gross-up PPh; dilarang memotong PPh kedua kali'; END IF;
  IF inv.withheld_amount>0 OR EXISTS(SELECT 1 FROM public.invoice_payments WHERE invoice_id=inv.id AND withheld_amount>0) THEN RAISE EXCEPTION 'Potongan PPh sudah dicatat'; END IF;
  IF (SELECT coalesce(sum(amount+withheld_amount),0) FROM public.invoice_payments WHERE invoice_id=inv.id)>coalesce(inv.paid_amount,0) THEN
    RAISE EXCEPTION 'Saldo invoice tidak sesuai ledger; periksa pembayaran terdahulu'; END IF;
  remaining:=coalesce(inv.total,0)-coalesce(inv.paid_amount,0);
  deduction:=remaining-proof.amount;
  IF proof.amount IS NULL OR proof.amount::text IN ('NaN','Infinity','-Infinity') OR proof.amount<>trunc(proof.amount)
    OR proof.amount<=0 OR inv.labor IS NULL OR inv.labor<=0 OR inv.labor>inv.total OR coalesce(inv.paid_amount,0)<0
    OR coalesce(inv.paid_amount,0)::text IN ('NaN','Infinity','-Infinity') OR coalesce(inv.paid_amount,0)<>trunc(coalesce(inv.paid_amount,0))
    OR deduction<=0 OR deduction<round(inv.labor*0.02) OR deduction>round(inv.labor*0.03) THEN
    RAISE EXCEPTION 'Selisih di luar toleransi 2–3%% dari nilai jasa; gunakan cicilan/periksa invoice'; END IF;
  IF EXISTS(SELECT 1 FROM public.orders o WHERE (o.id=inv.job_id OR o.invoice_id=inv.id) AND o.status='CANCELLED') THEN RAISE EXCEPTION 'Job terkait dibatalkan'; END IF;
  IF nullif(trim(inv.payment_proof_url),'') IS NOT NULL AND inv.payment_proof_url NOT IN ('verified-no-proof','verified-manual-no-proof')
    AND inv.payment_proof_url IS DISTINCT FROM proof.image_url THEN RAISE EXCEPTION 'Invoice sudah memiliki bukti berbeda; periksa pembayaran terdahulu'; END IF;
  IF EXISTS(SELECT 1 FROM public.payment_suggestions s WHERE s.id<>proof.id AND s.image_url=proof.image_url AND s.status='CONFIRMED' AND s.validation_status='LINKED')
    OR EXISTS(SELECT 1 FROM public.invoices i WHERE i.id<>inv.id AND i.payment_proof_url=proof.image_url
      AND (i.status IN ('PAID','PARTIAL_PAID') OR coalesce(i.paid_amount,0)>0 OR EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=i.id)))
    OR EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.withholding_detail->>'proof_url'=proof.image_url) THEN
    RAISE EXCEPTION 'Bukti ini sudah digunakan; periksa riwayat pembayaran'; END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid(); actor:=coalesce(actor,role_name);
  detail:=jsonb_build_object('kind','PPH23_ESTIMATED','tax_slip_verified',false,'labor_base',inv.labor,
    'reference_rate',0.02,'tolerance_min',0.02,'tolerance_max',0.03,'effective_rate',deduction/inv.labor,
    'payer_phone',proof.phone,'payer_name',proof.sender_name,'customer_phone',inv.phone,
    'proof_url',proof.image_url,'suggestion_id',proof.id,'reviewed_by',actor,'reviewed_at',now(),'request',payload);
  previous_flag:=current_setting('app.reviewed_withholding_write',true);
  PERFORM set_config('app.reviewed_withholding_write','allowed',true);
  INSERT INTO public.invoice_payments(id,invoice_id,amount,withheld_amount,withholding_detail,method,notes,paid_at,recorded_by,recorded_by_name)
    VALUES(p_request_id,inv.id,proof.amount,deduction,detail,'transfer',
      'Transfer WA '||proof.id::text||'; potongan PPh estimasi (belum bukti potong): '||deduction::text||'. '||trim(p_note),p_paid_at,auth.uid()::text,actor)
    RETURNING * INTO payment;
  UPDATE public.invoices SET status='PAID',paid_amount=total,remaining_amount=0,withheld_amount=deduction,
    paid_at=p_paid_at,paid_method='transfer',paid_notes=payment.notes,payment_proof_url=proof.image_url,
    pdf_url=NULL,pdf_generated_at=NULL,last_changed_by=actor WHERE id=inv.id RETURNING * INTO inv;
  UPDATE public.orders SET status='PAID',last_changed_by=actor WHERE id=inv.job_id OR invoice_id=inv.id;
  UPDATE public.payment_suggestions SET invoice_id=inv.id,order_id=inv.job_id,status='CONFIRMED',validation_status='LINKED',
    match_source='manual_withholding',matched_at=now(),resolved_at=now(),resolved_by=actor WHERE id=proof.id RETURNING * INTO proof;
  IF nullif(trim(inv.phone),'') IS NOT NULL THEN UPDATE public.customers SET last_service=p_paid_at WHERE phone=inv.phone; END IF;
  PERFORM set_config('app.reviewed_withholding_write',coalesce(previous_flag,''),true);
  SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) INTO order_rows FROM public.orders o WHERE o.id=inv.job_id OR o.invoice_id=inv.id;
  RETURN jsonb_build_object('invoice',to_jsonb(inv),'payment',to_jsonb(payment),'suggestion',to_jsonb(proof),'orders',order_rows,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.confirm_invoice_wa_withholding_atomic(uuid,text,uuid,text,jsonb,date,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_invoice_wa_withholding_atomic(uuid,text,uuid,text,jsonb,date,text,boolean) TO authenticated,service_role;

-- Existing cash/date/DP semantics are preserved. The legacy fallback subtracts
-- ALL settlement credits, otherwise withholding would reappear as phantom cash.
CREATE OR REPLACE VIEW public.finance_cash_events AS
SELECT i.id,i.job_id,i.customer,i.service,i.status,i.total,
       ip.amount AS cash_amount,ip.amount AS paid_amount,ip.paid_at AS cash_date,ip.paid_at,i.created_at
  FROM public.invoice_payments ip JOIN public.invoices i ON i.id=ip.invoice_id WHERE ip.quotation_payment_id IS NULL
UNION ALL
SELECT 'DP-'||qp.id::text,q.job_id,q.customer,'Down Payment Quotation','DP_RECEIVED',q.total,
       qp.amount,qp.amount,qp.paid_at,qp.paid_at,qp.created_at
  FROM public.quotation_payments qp JOIN public.quotations q ON q.id=qp.quotation_id
UNION ALL
SELECT i.id,i.job_id,i.customer,i.service,i.status,i.total,
       greatest(CASE WHEN i.status='PAID' THEN coalesce(i.total,0) ELSE coalesce(i.paid_amount,0) END-ledger.amount,0),
       greatest(CASE WHEN i.status='PAID' THEN coalesce(i.total,0) ELSE coalesce(i.paid_amount,0) END-ledger.amount,0),
       i.paid_at::date,i.paid_at,i.created_at
  FROM public.invoices i CROSS JOIN LATERAL (
    SELECT coalesce(sum(ip.amount+ip.withheld_amount),0) amount FROM public.invoice_payments ip WHERE ip.invoice_id=i.id
  ) ledger
 WHERE i.status IN ('PAID','PARTIAL_PAID') AND i.paid_at IS NOT NULL
   AND (CASE WHEN i.status='PAID' THEN coalesce(i.total,0) ELSE coalesce(i.paid_amount,0) END)>ledger.amount;
REVOKE ALL ON public.finance_cash_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.finance_cash_events TO service_role;
COMMIT;
