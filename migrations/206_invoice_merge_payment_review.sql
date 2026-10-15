-- 206: preserve review candidates through invoice consolidation, never count
-- an automatic match as payment. No cash/ledger writes in these functions.
BEGIN;

CREATE OR REPLACE FUNCTION public.payment_review_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT CASE WHEN trim(coalesce(p_phone,'')) LIKE '+%' THEN d
    WHEN d LIKE '08%' THEN '62'||substr(d,2)
    WHEN d LIKE '8%' THEN '62'||d ELSE d END
  FROM (SELECT regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') d) s;
$$;

-- Called by the candidate trigger. SHARE locks coordinate late webhook inserts
-- with consolidation/settlement; deadlocks/timeouts abort, never half-commit.
CREATE OR REPLACE FUNCTION public.payment_review_invoice_target(p_invoice_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE inv public.invoices%ROWTYPE; target text:=p_invoice_id; visited text[]:=ARRAY[]::text[]; marker text;
BEGIN
  FOR depth IN 1..20 LOOP
    IF target=ANY(visited) THEN RAISE EXCEPTION 'Rantai invoice gabungan berulang'; END IF;
    visited:=array_append(visited,target);
    SELECT * INTO inv FROM public.invoices WHERE id=target FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tujuan bukti tidak ditemukan'; END IF;
    marker:=substring(inv.service from '\[Digabung ke ([^]\s]+)\]');
    IF inv.status IS DISTINCT FROM 'CANCELLED' OR marker IS NULL THEN RETURN target; END IF;
    target:=marker;
  END LOOP;
  RAISE EXCEPTION 'Rantai invoice gabungan terlalu panjang';
END $$;
REVOKE ALL ON FUNCTION public.payment_review_invoice_target(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.route_unreviewed_payment_suggestion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE target text;
BEGIN
  -- Cached pre-206 browsers may still send the old automatic CONFIRMED patch.
  -- Keep it reviewable even before every admin has refreshed the frontend.
  IF NEW.status='CONFIRMED' AND NEW.validation_status='PENDING' AND NEW.resolved_by='retro-match' THEN
    NEW.status:='PENDING'; NEW.resolved_at:=NULL; NEW.resolved_by:=NULL; NEW.match_source:='retro_review';
  END IF;
  IF NEW.invoice_id IS NOT NULL AND NEW.status='PENDING' AND coalesce(NEW.validation_status,'PENDING')='PENDING' THEN
    target:=public.payment_review_invoice_target(NEW.invoice_id);
    IF target IS DISTINCT FROM NEW.invoice_id THEN
      NEW.invoice_id:=target;
      SELECT job_id INTO NEW.order_id FROM public.invoices WHERE id=target;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.route_unreviewed_payment_suggestion() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_route_unreviewed_payment_suggestion ON public.payment_suggestions;
CREATE TRIGGER trg_route_unreviewed_payment_suggestion
BEFORE INSERT OR UPDATE OF invoice_id,status,validation_status ON public.payment_suggestions
FOR EACH ROW EXECUTE FUNCTION public.route_unreviewed_payment_suggestion();

CREATE OR REPLACE FUNCTION public.link_payment_suggestion_for_review(p_invoice_id text,p_suggestion_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE role_name text; inv public.invoices%ROWTYPE; proof public.payment_suggestions%ROWTYPE; balance numeric;
BEGIN
  role_name:=CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name IS NULL OR role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses pencocokan bukti ditolak' USING ERRCODE='42501'; END IF;
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR coalesce(inv.status,'') NOT IN ('UNPAID','OVERDUE','PARTIAL_PAID') THEN RAISE EXCEPTION 'Invoice berubah; bukti harus diperiksa ulang'; END IF;
  SELECT * INTO proof FROM public.payment_suggestions WHERE id=p_suggestion_id FOR UPDATE;
  IF NOT FOUND OR proof.status IS DISTINCT FROM 'PENDING' OR proof.validation_status IS DISTINCT FROM 'PENDING'
    OR (proof.invoice_id IS NOT NULL AND proof.invoice_id<>inv.id)
    OR nullif(trim(proof.image_url),'') IS NULL THEN RAISE EXCEPTION 'Bukti sudah berubah/ditinjau'; END IF;
  balance:=greatest(0,coalesce(inv.remaining_amount,inv.total-coalesce(inv.paid_amount,0)));
  IF balance<=0 OR proof.amount IS DISTINCT FROM balance
    OR public.payment_review_phone(proof.phone) IS DISTINCT FROM public.payment_review_phone(inv.phone)
    OR length(public.payment_review_phone(inv.phone))<8 THEN RAISE EXCEPTION 'Nomor/nominal bukti tidak sesuai sisa tagihan'; END IF;
  IF (SELECT count(*) FROM public.invoices i WHERE i.status IN ('UNPAID','OVERDUE','PARTIAL_PAID')
    AND public.payment_review_phone(i.phone)=public.payment_review_phone(inv.phone)
    AND greatest(0,coalesce(i.remaining_amount,i.total-coalesce(i.paid_amount,0)))=balance)<>1 THEN
    RAISE EXCEPTION 'Beberapa invoice memiliki nominal sama; pilih bukti secara manual';
  END IF;
  IF (SELECT count(*) FROM public.payment_suggestions s WHERE s.status='PENDING' AND s.validation_status='PENDING'
    AND (s.invoice_id IS NULL OR s.invoice_id=inv.id) AND s.amount=balance
    AND nullif(trim(s.image_url),'') IS NOT NULL AND s.created_at>=now()-interval '30 days'
    AND public.payment_review_phone(s.phone)=public.payment_review_phone(inv.phone))<>1 THEN
    RAISE EXCEPTION 'Beberapa bukti cocok; pilih bukti secara manual';
  END IF;
  UPDATE public.payment_suggestions SET invoice_id=inv.id,order_id=inv.job_id,
    matched_at=now(),match_source='retro_review',resolved_at=NULL,resolved_by=NULL
    WHERE id=proof.id RETURNING * INTO proof;
  RETURN jsonb_build_object('suggestion',to_jsonb(proof));
END $$;
REVOKE ALL ON FUNCTION public.link_payment_suggestion_for_review(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_payment_suggestion_for_review(text,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.consolidate_invoices_atomic(p_sources jsonb,p_invoice jsonb,p_actor_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE role_name text; actor text; ids text[]; inv public.invoices%ROWTYPE; created public.invoices%ROWTYPE;
  first_row public.invoices%ROWTYPE; expected jsonb; result_value jsonb; source_rows jsonb; order_rows jsonb; proof_rows jsonb;
  mkey text; claimed integer; count_locked integer:=0;
  labor_total numeric:=0; material_total numeric:=0; discount_total numeric:=0; sum_total numeric:=0;
BEGIN
  role_name:=CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name IS NULL OR role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses konsolidasi ditolak' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_sources) IS DISTINCT FROM 'array' OR jsonb_array_length(p_sources) NOT BETWEEN 2 AND 20
    OR jsonb_typeof(p_invoice) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Pilih 2–20 invoice berbeda'; END IF;
  SELECT array_agg(DISTINCT x->>'id' ORDER BY x->>'id') INTO ids FROM jsonb_array_elements(p_sources) x;
  IF cardinality(ids)<>jsonb_array_length(p_sources) OR EXISTS(SELECT 1 FROM unnest(ids) id WHERE id IS NULL OR id='' OR length(id)>100) THEN RAISE EXCEPTION 'ID invoice sumber tidak valid/duplikat'; END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid(); actor:=coalesce(actor,nullif(trim(p_actor_name),''),role_name);
  -- Same source set cannot be consolidated twice, even from different tabs or
  -- after the first HTTP response is lost. The first transaction owns the key.
  mkey:='invoice-consolidate:'||md5(to_jsonb(ids)::text);
  INSERT INTO public.operational_mutations(mutation_key,operation,actor_id,actor_name)
    VALUES(mkey,'CONSOLIDATE_INVOICES',auth.uid(),actor) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed=ROW_COUNT;
  IF claimed=0 THEN
    SELECT result INTO result_value FROM public.operational_mutations WHERE mutation_key=mkey;
    IF result_value->'source_ids' IS DISTINCT FROM to_jsonb(ids) THEN RAISE EXCEPTION 'Permintaan konsolidasi tidak sesuai'; END IF;
    SELECT * INTO created FROM public.invoices WHERE id=result_value->'invoice'->>'id';
    IF NOT FOUND THEN RAISE EXCEPTION 'Hasil konsolidasi tidak ditemukan; periksa riwayat'; END IF;
  ELSE
    FOR inv IN SELECT * FROM public.invoices WHERE id=ANY(ids) ORDER BY id FOR UPDATE LOOP
      count_locked:=count_locked+1;
      SELECT x INTO expected FROM jsonb_array_elements(p_sources) x WHERE x->>'id'=inv.id;
      IF to_jsonb(inv) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Invoice berubah oleh proses lain; muat ulang' USING ERRCODE='40001'; END IF;
      IF coalesce(inv.status,'') NOT IN ('UNPAID','OVERDUE') OR coalesce(inv.paid_amount,0)<>0 OR inv.paid_at IS NOT NULL
        OR EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=inv.id) THEN
        RAISE EXCEPTION 'Invoice lunas/cicilan/DP tidak boleh dikonsolidasi; gunakan Gabung & Kirim PDF';
      END IF;
      IF coalesce(inv.pph23,false) OR coalesce(inv.trade_in_amount,0)>0 OR coalesce(inv.unit_ac_amount,0)>0 OR inv.quotation_id IS NOT NULL OR inv.invoice_type='UNIT_AC' THEN
        RAISE EXCEPTION 'Invoice PPh/trade-in/unit AC/quotation harus memakai Gabung & Kirim PDF';
      END IF;
      IF EXISTS(SELECT 1 FROM public.payment_suggestions s WHERE s.invoice_id=inv.id AND s.status='CONFIRMED' AND s.validation_status='LINKED') THEN
        RAISE EXCEPTION 'Bukti sudah diverifikasi; periksa pembayaran sebelum konsolidasi';
      END IF;
      IF first_row.id IS NULL THEN first_row:=inv;
      ELSIF public.payment_review_phone(inv.phone) IS DISTINCT FROM public.payment_review_phone(first_row.phone) THEN RAISE EXCEPTION 'Nomor customer berbeda'; END IF;
      labor_total:=labor_total+coalesce(inv.labor,0); material_total:=material_total+coalesce(inv.material,0);
      discount_total:=discount_total+coalesce(inv.discount,0); sum_total:=sum_total+coalesce(inv.total,0);
    END LOOP;
    IF count_locked<>cardinality(ids) THEN RAISE EXCEPTION 'Invoice sumber tidak lengkap'; END IF;
    IF EXISTS(SELECT 1 FROM public.orders o WHERE o.status='CANCELLED' AND (o.invoice_id=ANY(ids) OR o.id IN
      (SELECT i.job_id FROM public.invoices i WHERE i.id=ANY(ids)))) THEN RAISE EXCEPTION 'Job sumber dibatalkan; periksa hubungan invoice sebelum konsolidasi'; END IF;
    IF coalesce(p_invoice->>'id','') !~ '^INV-[0-9]{8}-[A-Z0-9]+$' OR length(p_invoice->>'id')>100
      OR public.payment_review_phone(p_invoice->>'phone') IS DISTINCT FROM public.payment_review_phone(first_row.phone)
      OR length(public.payment_review_phone(first_row.phone))<8
      OR nullif(trim(p_invoice->>'customer'),'') IS NULL THEN RAISE EXCEPTION 'Identitas invoice gabungan tidak valid'; END IF;
    IF (p_invoice->>'labor')::numeric IS DISTINCT FROM labor_total OR (p_invoice->>'material')::numeric IS DISTINCT FROM material_total
      OR (p_invoice->>'discount')::numeric IS DISTINCT FROM discount_total OR (p_invoice->>'total')::numeric IS DISTINCT FROM sum_total
      OR sum_total<=0 OR sum_total<>labor_total+material_total-discount_total THEN RAISE EXCEPTION 'Nilai invoice gabungan tidak sesuai sumber'; END IF;
    IF jsonb_typeof((p_invoice->>'materials_detail')::jsonb) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Item invoice gabungan tidak valid'; END IF;
    INSERT INTO public.invoices(id,customer,phone,service,job_id,units,labor,material,discount,total,status,due,teknisi,materials_detail,sent,paid_amount,remaining_amount,last_changed_by)
      VALUES(p_invoice->>'id',p_invoice->>'customer',p_invoice->>'phone','Invoice Gabungan ('||cardinality(ids)||' pekerjaan)',NULL,
        (p_invoice->>'units')::integer,labor_total,material_total,discount_total,sum_total,'UNPAID',nullif(p_invoice->>'due','')::date,
        p_invoice->>'teknisi',p_invoice->>'materials_detail',false,0,sum_total,actor) RETURNING * INTO created;
    UPDATE public.invoices SET status='CANCELLED',service=coalesce(service,'Servis AC')||' [Digabung ke '||created.id||']',
      pdf_url=NULL,pdf_generated_at=NULL,last_changed_by=actor WHERE id=ANY(ids);
    UPDATE public.orders SET invoice_id=created.id,last_changed_by=actor
      WHERE invoice_id=ANY(ids) OR id IN (SELECT i.job_id FROM public.invoices i WHERE i.id=ANY(ids));
    UPDATE public.payment_suggestions SET invoice_id=created.id,order_id=NULL,
      status='PENDING',validation_status='PENDING',matched_at=now(),
      match_source='invoice_merge_review',resolved_at=NULL,resolved_by=NULL
      WHERE invoice_id=ANY(ids) AND validation_status='PENDING'
      AND (status='PENDING' OR (status='CONFIRMED' AND resolved_by='retro-match'));
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) INTO source_rows FROM public.invoices i WHERE i.id=ANY(ids);
  SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) INTO order_rows FROM public.orders o WHERE o.invoice_id=created.id;
  SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) INTO proof_rows FROM public.payment_suggestions s WHERE s.invoice_id=created.id;
  result_value:=jsonb_build_object('invoice',to_jsonb(created),'sources',source_rows,'orders',order_rows,'suggestions',proof_rows,'source_ids',to_jsonb(ids),'replayed',claimed=0);
  IF claimed<>0 THEN UPDATE public.operational_mutations SET result=result_value,completed_at=now() WHERE mutation_key=mkey; END IF;
  RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.consolidate_invoices_atomic(jsonb,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consolidate_invoices_atomic(jsonb,jsonb,text) TO authenticated,service_role;

-- Used by both Invoice -> Attach WA proof and Pending AI -> verify. The proof
-- and settlement either both commit or both roll back. Upload/URL flows retain
-- their existing manual settlement; this RPC only consumes a specific WA row.
CREATE OR REPLACE FUNCTION public.confirm_invoice_wa_proof_atomic(
  p_request_id uuid,p_invoice_id text,p_suggestion_id uuid,p_expected_proof_url text,
  p_review_ack boolean DEFAULT false,p_actor_name text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE role_name text; actor text; inv public.invoices%ROWTYPE; proof public.payment_suggestions%ROWTYPE;
  remaining numeric; orders_value jsonb; was_paid boolean; existing public.invoice_payments%ROWTYPE;
BEGIN
  role_name:=CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name IS NULL OR role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses verifikasi bukti ditolak' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_suggestion_id IS NULL OR nullif(trim(p_expected_proof_url),'') IS NULL THEN RAISE EXCEPTION 'Permintaan bukti tidak lengkap'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_expected_proof_url,2));
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR coalesce(inv.status,'') NOT IN ('UNPAID','OVERDUE','PARTIAL_PAID','PAID') THEN RAISE EXCEPTION 'Invoice berubah/tidak tersedia'; END IF;
  SELECT * INTO proof FROM public.payment_suggestions WHERE id=p_suggestion_id FOR UPDATE;
  IF NOT FOUND OR proof.image_url IS DISTINCT FROM p_expected_proof_url THEN RAISE EXCEPTION 'Bukti berubah; muat ulang sebelum melanjutkan'; END IF;
  IF proof.status='CONFIRMED' AND proof.validation_status='LINKED' AND proof.invoice_id=inv.id AND inv.status='PAID' AND inv.payment_proof_url=proof.image_url THEN
    SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) INTO orders_value FROM public.orders o WHERE o.invoice_id=inv.id OR o.id=inv.job_id;
    RETURN jsonb_build_object('invoice',to_jsonb(inv),'suggestion',to_jsonb(proof),'orders',orders_value,'replayed',true);
  END IF;
  IF coalesce(proof.status,'') NOT IN ('PENDING','DISMISSED') OR proof.validation_status IS DISTINCT FROM 'PENDING' THEN RAISE EXCEPTION 'Bukti sudah ditinjau/digunakan'; END IF;
  IF proof.invoice_id IS NOT NULL AND public.payment_review_invoice_target(proof.invoice_id)<>inv.id THEN RAISE EXCEPTION 'Bukti tertaut ke invoice lain'; END IF;
  IF (proof.status='DISMISSED' OR proof.match_source='wa_image_review' OR proof.amount IS NULL OR proof.amount<=0
      OR public.payment_review_phone(proof.phone) IS DISTINCT FROM public.payment_review_phone(inv.phone)) AND NOT coalesce(p_review_ack,false) THEN
    RAISE EXCEPTION 'Buka bukti dan centang pemeriksaan manual terlebih dahulu';
  END IF;
  was_paid:=inv.status='PAID';
  remaining:=CASE WHEN was_paid THEN inv.total ELSE greatest(0,inv.total-coalesce(inv.paid_amount,0)) END;
  IF proof.amount>0 AND proof.amount<>remaining THEN RAISE EXCEPTION 'Nominal bukti berbeda dari sisa tagihan; gunakan verifikasi alokasi/cicilan, bukan tandai lunas'; END IF;
  IF nullif(trim(inv.payment_proof_url),'') IS NOT NULL AND inv.payment_proof_url NOT IN ('verified-no-proof','verified-manual-no-proof')
    AND inv.payment_proof_url IS DISTINCT FROM proof.image_url THEN RAISE EXCEPTION 'Invoice sudah memiliki bukti berbeda; muat ulang'; END IF;
  IF EXISTS(SELECT 1 FROM public.invoices i WHERE i.id<>inv.id AND i.payment_proof_url=proof.image_url
      AND (i.status IN ('PAID','PARTIAL_PAID') OR coalesce(i.paid_amount,0)>0 OR EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=i.id)))
    OR EXISTS(SELECT 1 FROM public.payment_suggestions s WHERE s.id<>proof.id AND s.image_url=proof.image_url AND s.status='CONFIRMED' AND s.validation_status='LINKED') THEN
    RAISE EXCEPTION 'Bukti ini sudah digunakan; periksa riwayat pembayaran';
  END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid(); actor:=coalesce(actor,nullif(trim(p_actor_name),''),role_name);
  IF was_paid THEN
    UPDATE public.invoices SET payment_proof_url=proof.image_url,last_changed_by=actor WHERE id=inv.id RETURNING * INTO inv;
  ELSE
    IF EXISTS(SELECT 1 FROM public.orders o WHERE (o.invoice_id=inv.id OR o.id=inv.job_id) AND o.status='CANCELLED') THEN
      RAISE EXCEPTION 'Job terkait dibatalkan; periksa sebelum melunasi';
    END IF;
    SELECT * INTO existing FROM public.invoice_payments WHERE id=p_request_id;
    IF FOUND THEN RAISE EXCEPTION 'ID pembayaran sudah digunakan untuk permintaan lain'; END IF;
    PERFORM public.settle_invoice_atomic(inv.id,p_request_id,(now() AT TIME ZONE 'Asia/Jakarta')::date,'transfer',
      'Bukti WA diperiksa '||proof.id::text,proof.image_url,actor,'invoice-wa-proof:'||p_request_id::text);
    SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id;
    IF inv.status<>'PAID' OR inv.payment_proof_url IS DISTINCT FROM proof.image_url THEN RAISE EXCEPTION 'Pelunasan bukti tidak berhasil'; END IF;
  END IF;
  UPDATE public.payment_suggestions SET invoice_id=inv.id,order_id=inv.job_id,status='CONFIRMED',validation_status='LINKED',
    match_source='manual',matched_at=now(),resolved_at=now(),resolved_by=actor WHERE id=proof.id RETURNING * INTO proof;
  SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) INTO orders_value FROM public.orders o WHERE o.invoice_id=inv.id OR o.id=inv.job_id;
  RETURN jsonb_build_object('invoice',to_jsonb(inv),'suggestion',to_jsonb(proof),'orders',orders_value,'attach_only',was_paid,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.confirm_invoice_wa_proof_atomic(uuid,text,uuid,text,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_invoice_wa_proof_atomic(uuid,text,uuid,text,boolean,text) TO authenticated,service_role;

-- Keep WhatsApp Workspace's partial/multi-invoice allocation compatible with
-- recovered proofs. A historical CANCELLED source is not a consumed payment.
CREATE OR REPLACE FUNCTION public.apply_wa_payment(p_id uuid,p_suggestion_id uuid,p_allocations jsonb,p_amount numeric,p_method text,p_note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE sug public.payment_suggestions%ROWTYPE; receipt public.wa_payment_receipts%ROWTYPE; inv public.invoices%ROWTYPE;
  payload_value jsonb; part jsonb; result_value jsonb:='[]'; actor text; total_value numeric; count_value integer; proof_url text;
BEGIN
  IF coalesce(public.get_my_role(),'') NOT IN ('Owner','Admin') THEN RAISE EXCEPTION 'Akses pembayaran ditolak' USING ERRCODE='42501'; END IF;
  IF p_id IS NULL OR p_suggestion_id IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<=0 OR p_method IS NULL OR p_method NOT IN ('transfer','cash','qris','card','other')
    OR jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_allocations) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Data pembayaran tidak valid'; END IF;
  payload_value:=jsonb_build_object('suggestion',p_suggestion_id,'allocations',p_allocations,'amount',p_amount,'method',p_method,'note',coalesce(p_note,''));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,1));
  SELECT * INTO receipt FROM public.wa_payment_receipts WHERE id=p_id;
  IF FOUND THEN
    IF receipt.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'ID pembayaran dipakai untuk data berbeda'; END IF;
    RETURN receipt.result;
  END IF;
  SELECT image_url INTO proof_url FROM public.payment_suggestions WHERE id=p_suggestion_id;
  IF nullif(proof_url,'') IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(proof_url,2)); END IF;
  -- Same invoice -> suggestion lock order as the merge and single-proof RPCs.
  PERFORM 1 FROM public.invoices WHERE id IN (SELECT value->>'invoice_id' FROM jsonb_array_elements(p_allocations)) ORDER BY id FOR UPDATE;
  SELECT * INTO sug FROM public.payment_suggestions WHERE id=p_suggestion_id FOR UPDATE;
  IF NOT FOUND OR sug.status IS DISTINCT FROM 'PENDING' OR coalesce(sug.validation_status,'PENDING')<>'PENDING' OR sug.image_url IS DISTINCT FROM proof_url THEN RAISE EXCEPTION 'Bukti sudah diproses atau berubah'; END IF;
  IF sug.amount IS DISTINCT FROM p_amount AND length(trim(coalesce(p_note,'')))<10 THEN RAISE EXCEPTION 'Jelaskan koreksi nominal bukti (minimal 10 karakter)'; END IF;
  IF nullif(sug.image_url,'') IS NOT NULL AND (
    EXISTS(SELECT 1 FROM public.invoices i WHERE i.payment_proof_url=sug.image_url
      AND (i.status IN ('PAID','PARTIAL_PAID') OR coalesce(i.paid_amount,0)>0 OR EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=i.id)))
    OR EXISTS(SELECT 1 FROM public.payment_suggestions WHERE id<>sug.id AND image_url=sug.image_url AND status='CONFIRMED' AND validation_status='LINKED')
  ) THEN RAISE EXCEPTION 'Bukti ini sudah digunakan. Periksa riwayat pembayaran'; END IF;
  SELECT sum((value->>'amount')::numeric),count(DISTINCT value->>'invoice_id') INTO total_value,count_value FROM jsonb_array_elements(p_allocations);
  IF total_value IS DISTINCT FROM p_amount OR count_value<>jsonb_array_length(p_allocations) THEN RAISE EXCEPTION 'Alokasi harus unik dan sama dengan nominal transfer'; END IF;
  IF sug.invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_allocations) a WHERE a->>'invoice_id'=public.payment_review_invoice_target(sug.invoice_id)) THEN RAISE EXCEPTION 'Bukti tertaut ke invoice lain'; END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid(); actor:=coalesce(actor,'Admin');
  INSERT INTO public.wa_payment_receipts(id,suggestion_id,payload,actor) VALUES(p_id,p_suggestion_id,payload_value,actor);
  FOR part IN SELECT value FROM jsonb_array_elements(p_allocations) ORDER BY value->>'invoice_id' LOOP
    SELECT * INTO inv FROM public.invoices WHERE id=part->>'invoice_id';
    IF NOT FOUND OR coalesce(inv.status,'') NOT IN ('UNPAID','OVERDUE','PARTIAL_PAID') THEN RAISE EXCEPTION 'Invoice tidak tersedia untuk pembayaran'; END IF;
    IF public.payment_review_phone(inv.phone) IS DISTINCT FROM public.payment_review_phone(sug.phone) THEN RAISE EXCEPTION 'Nomor invoice tidak cocok dengan bukti'; END IF;
    IF (part->>'amount') IS NULL OR (part->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'Alokasi harus positif'; END IF;
    PERFORM public.record_invoice_partial_payment_atomic(gen_random_uuid(),inv.id,(part->>'amount')::numeric,p_method,
      'Bukti WA '||sug.id::text||' · '||coalesce(p_note,''),(now() AT TIME ZONE 'Asia/Jakarta')::date,actor);
    UPDATE public.invoices SET payment_proof_url=coalesce(nullif(sug.image_url,''),payment_proof_url),paid_method=p_method WHERE id=inv.id RETURNING * INTO inv;
    IF inv.status='PAID' THEN UPDATE public.orders SET status='PAID' WHERE (id=inv.job_id OR invoice_id=inv.id) AND status NOT IN ('CANCELLED'); END IF;
    result_value:=result_value||jsonb_build_array(to_jsonb(inv));
  END LOOP;
  UPDATE public.payment_suggestions SET status='CONFIRMED',validation_status='LINKED',
    invoice_id=CASE WHEN count_value=1 THEN p_allocations->0->>'invoice_id' ELSE NULL END,
    order_id=CASE WHEN count_value=1 THEN inv.job_id ELSE NULL END,
    matched_at=now(),match_source='manual_allocation',resolved_at=now(),resolved_by=actor WHERE id=sug.id;
  UPDATE public.wa_payment_receipts SET result=result_value WHERE id=p_id;
  RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.apply_wa_payment(uuid,uuid,jsonb,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_wa_payment(uuid,uuid,jsonb,numeric,text,text) TO authenticated;

-- Recover only the exact legacy failure: automatically CONFIRMED by retro-match,
-- still unvalidated, stuck on a CANCELLED merged source, with NO recorded cash
-- on source or target. Preserve old proof files/history and all financial values.
DO $$
DECLARE proof record; target text; dest public.invoices%ROWTYPE;
BEGIN
  FOR proof IN SELECT s.id,s.invoice_id FROM public.payment_suggestions s JOIN public.invoices i ON i.id=s.invoice_id
    WHERE s.status='CONFIRMED' AND s.validation_status='PENDING' AND s.resolved_by='retro-match'
      AND i.status='CANCELLED' AND i.service LIKE '%[Digabung ke %' AND coalesce(i.paid_amount,0)=0 AND i.paid_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=i.id)
    FOR UPDATE OF s
  LOOP
    target:=public.payment_review_invoice_target(proof.invoice_id);
    SELECT * INTO dest FROM public.invoices WHERE id=target FOR UPDATE;
    IF dest.status IN ('UNPAID','OVERDUE') AND coalesce(dest.paid_amount,0)=0 AND dest.paid_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=target)
      AND NOT EXISTS(SELECT 1 FROM public.invoices sibling WHERE sibling.status='CANCELLED'
        AND sibling.service LIKE '%[Digabung ke '||target||']%'
        AND (coalesce(sibling.paid_amount,0)>0 OR sibling.paid_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=sibling.id))) THEN
      UPDATE public.payment_suggestions SET invoice_id=target,order_id=dest.job_id,status='PENDING',matched_at=now(),
        match_source='retro_merge_recovered',resolved_at=NULL,resolved_by=NULL
        WHERE id=proof.id AND status='CONFIRMED' AND validation_status='PENDING' AND resolved_by='retro-match';
      UPDATE public.orders SET invoice_id=target WHERE invoice_id=proof.invoice_id OR invoice_id IN
        (SELECT i.id FROM public.invoices i WHERE i.status='CANCELLED' AND i.service LIKE '%[Digabung ke '||target||']%');
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
