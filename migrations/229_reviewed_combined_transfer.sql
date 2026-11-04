-- Manual allocation of a single WA transfer that also pays for an AC unit.
-- This invoice receives only its outstanding amount; the rest is audit metadata
-- and must be reconciled against the separate AC sale. No historical rows change.
BEGIN;

ALTER TABLE public.invoice_payments ADD COLUMN IF NOT EXISTS combined_transfer_detail jsonb;

CREATE OR REPLACE FUNCTION public.guard_combined_transfer_229()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='invoice_payments' THEN
    IF TG_OP IN ('UPDATE','DELETE') AND OLD.combined_transfer_detail IS NOT NULL THEN
      RAISE EXCEPTION 'Alokasi transfer gabungan tidak boleh diubah/dihapus lewat jalur biasa';
    END IF;
    -- Custom GUCs can be set by clients. They are never sufficient on their own:
    -- allow only the security-definer owner to add audit metadata, without
    -- changing any existing financial field in the same UPDATE.
    IF TG_OP='UPDATE' AND NEW.combined_transfer_detail IS NOT NULL
      AND current_setting('app.combined_transfer_write',true)='allowed'
      AND current_user=(SELECT pg_get_userbyid(proowner) FROM pg_proc
        WHERE oid='public.confirm_invoice_wa_combined_transfer_atomic(uuid,text,uuid,text,jsonb,date,text,boolean)'::regprocedure)
      AND (to_jsonb(NEW)-ARRAY['combined_transfer_detail','updated_at']) IS NOT DISTINCT FROM
          (to_jsonb(OLD)-ARRAY['combined_transfer_detail','updated_at']) THEN
      RETURN NEW;
    END IF;
    IF TG_OP IN ('INSERT','UPDATE') AND NEW.combined_transfer_detail IS NOT NULL THEN
      RAISE EXCEPTION 'Alokasi transfer gabungan hanya boleh dicatat lewat verifikasi atomik';
    END IF;
  ELSE
    IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=OLD.id AND ip.combined_transfer_detail IS NOT NULL) THEN
      RAISE EXCEPTION 'Invoice dengan alokasi transfer gabungan tidak boleh dihapus';
    END IF;
    IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=OLD.id AND ip.combined_transfer_detail IS NOT NULL)
      AND (to_jsonb(NEW)-ARRAY['updated_at','pdf_url','pdf_generated_at','last_changed_by','sent','sent_at','wa_sent_count','wa_last_sent_at','wa_last_sent_by','wa_last_sent_mode','wa_last_sent_method']) IS DISTINCT FROM
          (to_jsonb(OLD)-ARRAY['updated_at','pdf_url','pdf_generated_at','last_changed_by','sent','sent_at','wa_sent_count','wa_last_sent_at','wa_last_sent_by','wa_last_sent_mode','wa_last_sent_method']) THEN
      RAISE EXCEPTION 'Invoice dengan alokasi transfer gabungan dikunci untuk perubahan/revert biasa';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION public.guard_combined_transfer_229() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_guard_combined_transfer_229 ON public.invoice_payments;
CREATE TRIGGER trg_guard_combined_transfer_229 BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_combined_transfer_229();
DROP TRIGGER IF EXISTS trg_guard_combined_transfer_229 ON public.invoices;
CREATE TRIGGER trg_guard_combined_transfer_229 BEFORE UPDATE OR DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_combined_transfer_229();

CREATE OR REPLACE FUNCTION public.confirm_invoice_wa_combined_transfer_atomic(
  p_request_id uuid,p_invoice_id text,p_suggestion_id uuid,p_expected_proof_url text,
  p_expected_invoice jsonb,p_paid_at date,p_note text,p_review_ack boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE role_name text; actor text; inv public.invoices%ROWTYPE; proof public.payment_suggestions%ROWTYPE;
  payment public.invoice_payments%ROWTYPE; snapshot jsonb; payload jsonb; detail jsonb;
  remaining numeric; orders_value jsonb; previous_flag text;
BEGIN
  role_name:=CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name IS NULL OR role_name NOT IN ('Owner','Admin') THEN RAISE EXCEPTION 'Akses alokasi transfer gabungan ditolak' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_suggestion_id IS NULL OR nullif(trim(p_expected_proof_url),'') IS NULL
    OR jsonb_typeof(p_expected_invoice) IS DISTINCT FROM 'object' OR p_paid_at IS NULL OR p_paid_at<'2000-01-01'
    OR p_paid_at>(now() AT TIME ZONE 'Asia/Jakarta')::date OR length(trim(coalesce(p_note,''))) NOT BETWEEN 10 AND 1000
    OR NOT coalesce(p_review_ack,false) THEN RAISE EXCEPTION 'Periksa bukti, nominal, tanggal dan catatan (10–1000 karakter)'; END IF;
  payload:=jsonb_build_object('invoice',p_invoice_id,'suggestion',p_suggestion_id,'proof',p_expected_proof_url,
    'expected_invoice',p_expected_invoice,'paid_at',p_paid_at,'note',trim(p_note));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_expected_proof_url,2));
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tidak ditemukan'; END IF;
  SELECT * INTO proof FROM public.payment_suggestions WHERE id=p_suggestion_id FOR UPDATE;
  IF NOT FOUND OR proof.image_url IS DISTINCT FROM p_expected_proof_url THEN RAISE EXCEPTION 'Bukti berubah; muat ulang'; END IF;
  SELECT * INTO payment FROM public.invoice_payments WHERE id=p_request_id;
  IF FOUND THEN
    IF payment.invoice_id IS DISTINCT FROM inv.id
      OR public.payment_review_request_213(payment.combined_transfer_detail->'request') IS DISTINCT FROM public.payment_review_request_213(payload)
      OR inv.status IS DISTINCT FROM 'PAID' OR inv.payment_proof_url IS DISTINCT FROM proof.image_url
      OR proof.invoice_id IS DISTINCT FROM inv.id OR proof.status IS DISTINCT FROM 'CONFIRMED' OR proof.validation_status IS DISTINCT FROM 'LINKED' THEN
      RAISE EXCEPTION 'ID pembayaran telah digunakan atau hasil berubah; periksa riwayat';
    END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) INTO orders_value FROM public.orders o WHERE o.id=inv.job_id OR o.invoice_id=inv.id;
    RETURN jsonb_build_object('invoice',to_jsonb(inv),'payment',to_jsonb(payment),'suggestion',to_jsonb(proof),'orders',orders_value,'replayed',true);
  END IF;
  snapshot:=jsonb_build_object('total',coalesce(inv.total,0),'labor',coalesce(inv.labor,0),
    'paid_amount',coalesce(inv.paid_amount,0),'withheld_amount',inv.withheld_amount,
    'pph23',coalesce(inv.pph23,false),'pph23_amount',coalesce(inv.pph23_amount,0),
    'status',inv.status,'phone',coalesce(inv.phone,''),'materials_detail',inv.materials_detail);
  IF public.payment_review_snapshot_213(snapshot) IS DISTINCT FROM public.payment_review_snapshot_213(p_expected_invoice) THEN
    RAISE EXCEPTION 'Invoice berubah sejak pratinjau; muat ulang dan periksa lagi'; END IF;
  IF inv.status IS NULL OR inv.status NOT IN ('UNPAID','OVERDUE','PARTIAL_PAID')
    OR coalesce(proof.status,'') NOT IN ('PENDING','DISMISSED') OR proof.validation_status IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'Invoice/bukti sudah diproses atau dibatalkan'; END IF;
  IF proof.invoice_id IS NOT NULL AND public.payment_review_invoice_target(proof.invoice_id) IS DISTINCT FROM inv.id THEN RAISE EXCEPTION 'Bukti tertaut ke invoice lain'; END IF;
  IF (SELECT coalesce(sum(amount+withheld_amount),0) FROM public.invoice_payments WHERE invoice_id=inv.id)>coalesce(inv.paid_amount,0) THEN
    RAISE EXCEPTION 'Saldo invoice tidak sesuai ledger; periksa pembayaran terdahulu'; END IF;
  remaining:=coalesce(inv.total,0)-coalesce(inv.paid_amount,0);
  IF proof.amount IS NULL OR proof.amount::text IN ('NaN','Infinity','-Infinity') OR proof.amount<>trunc(proof.amount)
    OR proof.amount<=remaining OR proof.amount>9007199254740991
    OR remaining<=0 OR remaining<>trunc(remaining) OR remaining>9007199254740991 OR coalesce(inv.paid_amount,0)<0
    OR coalesce(inv.withheld_amount,0)>0 OR EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=inv.id AND ip.withheld_amount>0) THEN
    RAISE EXCEPTION 'Transfer harus melebihi sisa tagihan yang valid dan tidak memakai potongan PPh'; END IF;
  IF EXISTS(SELECT 1 FROM public.orders o WHERE (o.id=inv.job_id OR o.invoice_id=inv.id) AND o.status='CANCELLED') THEN RAISE EXCEPTION 'Job terkait dibatalkan'; END IF;
  IF nullif(trim(inv.payment_proof_url),'') IS NOT NULL AND inv.payment_proof_url NOT IN ('verified-no-proof','verified-manual-no-proof')
    AND inv.payment_proof_url IS DISTINCT FROM proof.image_url THEN RAISE EXCEPTION 'Invoice sudah memiliki bukti berbeda'; END IF;
  IF EXISTS(SELECT 1 FROM public.payment_suggestions s WHERE s.id<>proof.id AND s.image_url=proof.image_url AND s.status='CONFIRMED' AND s.validation_status='LINKED')
    OR EXISTS(SELECT 1 FROM public.invoices i WHERE i.id<>inv.id AND i.payment_proof_url=proof.image_url
      AND (i.status IN ('PAID','PARTIAL_PAID') OR coalesce(i.paid_amount,0)>0 OR EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=i.id)))
    OR EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.withholding_detail->>'proof_url'=proof.image_url OR ip.combined_transfer_detail->>'proof_url'=proof.image_url) THEN
    RAISE EXCEPTION 'Bukti ini sudah digunakan; periksa riwayat pembayaran'; END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid(); actor:=coalesce(actor,role_name);
  detail:=jsonb_build_object('kind','AC_UNIT_PLUS_INSTALLATION','transfer_amount',proof.amount,
    'allocated_amount',remaining,'unallocated_amount',proof.amount-remaining,
    'payer_phone',proof.phone,'payer_name',proof.sender_name,'customer_phone',inv.phone,
    'proof_url',proof.image_url,'suggestion_id',proof.id,'reviewed_by',actor,'reviewed_at',now(),'request',payload);
  PERFORM public.settle_invoice_atomic(inv.id,p_request_id,p_paid_at,'transfer',
    'Transfer WA gabungan AC + instalasi '||proof.id::text||'; alokasi invoice '||remaining::text||
    '; kelebihan belum dialokasikan '||(proof.amount-remaining)::text||'. '||trim(p_note),proof.image_url,actor,
    'combined-transfer:'||p_request_id::text);
  previous_flag:=current_setting('app.combined_transfer_write',true);
  PERFORM set_config('app.combined_transfer_write','allowed',true);
  UPDATE public.invoice_payments SET combined_transfer_detail=detail WHERE id=p_request_id RETURNING * INTO payment;
  IF payment.invoice_id IS DISTINCT FROM inv.id OR payment.amount IS DISTINCT FROM remaining THEN RAISE EXCEPTION 'Ledger alokasi tidak sesuai invoice'; END IF;
  UPDATE public.payment_suggestions SET invoice_id=inv.id,order_id=inv.job_id,status='CONFIRMED',validation_status='LINKED',
    match_source='manual_combined_transfer',matched_at=now(),resolved_at=now(),resolved_by=actor WHERE id=proof.id RETURNING * INTO proof;
  PERFORM set_config('app.combined_transfer_write',coalesce(previous_flag,''),true);
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id;
  SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) INTO orders_value FROM public.orders o WHERE o.id=inv.job_id OR o.invoice_id=inv.id;
  RETURN jsonb_build_object('invoice',to_jsonb(inv),'payment',to_jsonb(payment),'suggestion',to_jsonb(proof),'orders',orders_value,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.confirm_invoice_wa_combined_transfer_atomic(uuid,text,uuid,text,jsonb,date,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_invoice_wa_combined_transfer_atomic(uuid,text,uuid,text,jsonb,date,text,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
