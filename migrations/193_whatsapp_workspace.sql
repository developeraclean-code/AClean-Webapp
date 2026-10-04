-- 193 — Persistent follow-up, durable outbound messages and atomic proof allocation.
BEGIN;
CREATE TABLE public.wa_followups (
  phone text PRIMARY KEY, status text NOT NULL DEFAULT 'NEEDS_REPLY'
    CHECK (status IN ('NEEDS_REPLY','WAITING_CUSTOMER','WAITING_SCHEDULE','PAYMENT_REVIEW','DONE')),
  due_at timestamptz, assignee text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), updated_by text
);
CREATE TABLE public.wa_outbox (
  id uuid PRIMARY KEY, phone text NOT NULL, kind text NOT NULL CHECK (kind IN ('TEXT','INVOICE','REPORT','SERVICE_REMINDER')),
  customer_id text, document_id text, message text NOT NULL, attachment_url text, filename text,
  payload jsonb NOT NULL, status text NOT NULL CHECK (status IN ('SENDING','ACCEPTED','FAILED','UNCERTAIN')),
  error text, provider_id text, message_id bigint, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX wa_outbox_phone ON public.wa_outbox(phone,created_at DESC);
CREATE INDEX wa_outbox_reminder ON public.wa_outbox(customer_id,created_at DESC) WHERE kind='SERVICE_REMINDER';
CREATE TABLE public.wa_payment_receipts (
  id uuid PRIMARY KEY, suggestion_id uuid NOT NULL UNIQUE REFERENCES public.payment_suggestions(id),
  payload jsonb NOT NULL, result jsonb, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wa_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_payment_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_followups_read ON public.wa_followups FOR SELECT TO authenticated USING (public.get_my_role() IN ('Owner','Admin'));
CREATE POLICY wa_outbox_read ON public.wa_outbox FOR SELECT TO authenticated USING (public.get_my_role() IN ('Owner','Admin'));
CREATE POLICY wa_receipts_read ON public.wa_payment_receipts FOR SELECT TO authenticated USING (public.get_my_role() IN ('Owner','Admin'));
REVOKE ALL ON public.wa_followups,public.wa_outbox,public.wa_payment_receipts FROM anon,authenticated;
GRANT SELECT ON public.wa_followups,public.wa_outbox,public.wa_payment_receipts TO authenticated;
GRANT ALL ON public.wa_followups,public.wa_outbox,public.wa_payment_receipts TO service_role;

CREATE FUNCTION public.save_wa_followup(p_phone text,p_version integer,p_status text,p_due_at timestamptz,p_assignee text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE row_value public.wa_followups%ROWTYPE; actor text;
BEGIN
  IF coalesce(public.get_my_role(),'') NOT IN ('Owner','Admin') THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
  IF p_phone IS NULL OR p_phone !~ '^[0-9]{8,15}$' OR p_version IS NULL OR p_status IS NULL OR p_status NOT IN ('NEEDS_REPLY','WAITING_CUSTOMER','WAITING_SCHEDULE','PAYMENT_REVIEW','DONE')
    OR length(coalesce(p_note,''))>2000 OR length(coalesce(p_assignee,''))>100 THEN RAISE EXCEPTION 'Data tindak lanjut tidak valid'; END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid();
  INSERT INTO public.wa_followups(phone) VALUES(p_phone) ON CONFLICT DO NOTHING;
  SELECT * INTO row_value FROM public.wa_followups WHERE phone=p_phone FOR UPDATE;
  IF row_value.version<>p_version THEN RAISE EXCEPTION 'Tindak lanjut diubah admin lain. Muat ulang sebelum menyimpan.' USING ERRCODE='40001'; END IF;
  UPDATE public.wa_followups SET status=p_status,due_at=CASE WHEN p_status='DONE' THEN NULL ELSE p_due_at END,
    assignee=coalesce(p_assignee,''),note=coalesce(p_note,''),version=version+1,updated_at=now(),updated_by=actor
    WHERE phone=p_phone RETURNING * INTO row_value;
  RETURN to_jsonb(row_value);
END $$;
REVOKE ALL ON FUNCTION public.save_wa_followup(text,integer,text,timestamptz,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_wa_followup(text,integer,text,timestamptz,text,text) TO authenticated;

CREATE FUNCTION public.wa_reopen_followup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF NEW.role='customer' THEN
    UPDATE public.wa_followups SET status='NEEDS_REPLY',version=version+1,updated_at=now(),updated_by='Pesan pelanggan'
      WHERE phone=NEW.phone AND status IN ('DONE','WAITING_CUSTOMER');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wa_reopen_followup AFTER INSERT ON public.wa_messages FOR EACH ROW EXECUTE FUNCTION public.wa_reopen_followup();

-- Only the server can claim/finalize a send. A repeated ID NEVER calls the provider again.
CREATE FUNCTION public.claim_wa_send(p_id uuid,p_payload jsonb,p_actor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE existing public.wa_outbox%ROWTYPE; last_contact timestamptz; cid text:=p_payload->>'customer_id';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO existing FROM public.wa_outbox WHERE id=p_id;
  IF FOUND THEN
    IF existing.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'ID kirim sudah digunakan untuk pesan berbeda'; END IF;
    RETURN jsonb_build_object('claimed',false,'row',to_jsonb(existing));
  END IF;
  IF p_payload->>'kind'='SERVICE_REMINDER' THEN
    IF cid IS NULL THEN RAISE EXCEPTION 'Lokasi pelanggan wajib dipilih'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('wa-reminder:'||cid,0));
    SELECT last_rating_request::timestamptz INTO last_contact FROM public.customers WHERE id::text=cid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer tidak ditemukan'; END IF;
    IF last_contact>now()-interval '30 days' OR EXISTS(SELECT 1 FROM public.wa_outbox WHERE customer_id=cid AND kind='SERVICE_REMINDER'
      AND status IN ('SENDING','ACCEPTED','UNCERTAIN') AND created_at>now()-interval '30 days') THEN
      RAISE EXCEPTION 'Pengingat servis sudah dikirim/diproses dalam 30 hari terakhir';
    END IF;
  END IF;
  INSERT INTO public.wa_outbox(id,phone,kind,customer_id,document_id,message,attachment_url,filename,payload,status,actor)
    VALUES(p_id,p_payload->>'phone',p_payload->>'kind',cid,p_payload->>'document_id',p_payload->>'message',
      p_payload->>'url',p_payload->>'filename',p_payload,'SENDING',p_actor) RETURNING * INTO existing;
  RETURN jsonb_build_object('claimed',true,'row',to_jsonb(existing));
END $$;

CREATE FUNCTION public.finish_wa_send(p_id uuid,p_status text,p_error text DEFAULT NULL,p_provider_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE item public.wa_outbox%ROWTYPE; saved_message_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('ACCEPTED','FAILED','UNCERTAIN') THEN RAISE EXCEPTION 'Invalid send status'; END IF;
  SELECT * INTO item FROM public.wa_outbox WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pengiriman tidak ditemukan'; END IF;
  IF item.status<>'SENDING' THEN RETURN to_jsonb(item); END IF;
  IF p_status='ACCEPTED' THEN
    INSERT INTO public.wa_messages(phone,name,content,role,created_at)
      VALUES(item.phone,item.actor,item.message||CASE WHEN item.attachment_url IS NULL THEN '' ELSE E'\n📄 '||item.attachment_url END,'admin',now()) RETURNING id INTO saved_message_id;
    UPDATE public.wa_conversations SET last_reply=left(item.message,80),updated_at=now() WHERE phone=item.phone;
    IF item.kind='INVOICE' THEN PERFORM public.record_invoice_wa_sent(ARRAY[item.document_id],'single',NULL,item.actor,'fonnte'); END IF;
    IF item.kind='REPORT' THEN PERFORM public.record_report_card_wa_sent(item.document_id,'single',item.actor,'fonnte'); END IF;
    IF item.kind='SERVICE_REMINDER' THEN UPDATE public.customers SET last_rating_request=(now() AT TIME ZONE 'Asia/Jakarta')::date WHERE id::text=item.customer_id; END IF;
  END IF;
  UPDATE public.wa_outbox SET status=p_status,error=p_error,provider_id=p_provider_id,message_id=saved_message_id,finished_at=now() WHERE id=p_id RETURNING * INTO item;
  RETURN to_jsonb(item);
END $$;
REVOKE ALL ON FUNCTION public.claim_wa_send(uuid,jsonb,text),public.finish_wa_send(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wa_send(uuid,jsonb,text),public.finish_wa_send(uuid,text,text,text) TO service_role;

-- Proof, all allocations, ledger balances, order statuses and resolution commit together.
CREATE FUNCTION public.apply_wa_payment(p_id uuid,p_suggestion_id uuid,p_allocations jsonb,p_amount numeric,p_method text,p_note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE sug public.payment_suggestions%ROWTYPE; receipt public.wa_payment_receipts%ROWTYPE; inv public.invoices%ROWTYPE;
  payload_value jsonb; part jsonb; result_value jsonb:='[]'; actor text; total_value numeric; count_value integer;
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
  SELECT * INTO sug FROM public.payment_suggestions WHERE id=p_suggestion_id FOR UPDATE;
  IF NOT FOUND OR sug.status IS DISTINCT FROM 'PENDING' THEN RAISE EXCEPTION 'Bukti sudah diproses atau tidak tersedia'; END IF;
  IF sug.amount IS DISTINCT FROM p_amount AND length(trim(coalesce(p_note,'')))<10 THEN RAISE EXCEPTION 'Jelaskan koreksi nominal bukti (minimal 10 karakter)'; END IF;
  IF nullif(sug.image_url,'') IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(sug.image_url,2));
    IF EXISTS(SELECT 1 FROM public.invoices WHERE payment_proof_url=sug.image_url)
      OR EXISTS(SELECT 1 FROM public.payment_suggestions WHERE id<>sug.id AND image_url=sug.image_url AND status='CONFIRMED') THEN
      RAISE EXCEPTION 'Bukti ini sudah digunakan. Periksa riwayat pembayaran';
    END IF;
  END IF;
  SELECT sum((value->>'amount')::numeric),count(DISTINCT value->>'invoice_id') INTO total_value,count_value FROM jsonb_array_elements(p_allocations);
  IF total_value IS DISTINCT FROM p_amount OR count_value<>jsonb_array_length(p_allocations) THEN RAISE EXCEPTION 'Alokasi harus unik dan sama dengan nominal transfer'; END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid(); actor:=coalesce(actor,'Admin');
  INSERT INTO public.wa_payment_receipts(id,suggestion_id,payload,actor) VALUES(p_id,p_suggestion_id,payload_value,actor);
  -- Deterministic lock order avoids multi-invoice deadlocks.
  FOR part IN SELECT value FROM jsonb_array_elements(p_allocations) ORDER BY value->>'invoice_id' LOOP
    SELECT * INTO inv FROM public.invoices WHERE id=part->>'invoice_id' FOR UPDATE;
    IF NOT FOUND OR coalesce(inv.status,'') NOT IN ('UNPAID','OVERDUE','PARTIAL_PAID') THEN RAISE EXCEPTION 'Invoice tidak tersedia untuk pembayaran'; END IF;
    IF regexp_replace(inv.phone,'[^0-9]','','g') IS DISTINCT FROM regexp_replace(sug.phone,'[^0-9]','','g') THEN
      -- Indonesian local prefixes are accepted; no fuzzy last-digits match.
      IF regexp_replace(regexp_replace(inv.phone,'[^0-9]','','g'),'^0','62') IS DISTINCT FROM regexp_replace(regexp_replace(sug.phone,'[^0-9]','','g'),'^0','62') THEN RAISE EXCEPTION 'Nomor invoice tidak cocok dengan bukti'; END IF;
    END IF;
    IF (part->>'amount') IS NULL OR (part->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'Alokasi harus positif'; END IF;
    PERFORM public.record_invoice_partial_payment_atomic(gen_random_uuid(),inv.id,(part->>'amount')::numeric,p_method,
      'Bukti WA '||sug.id::text||' · '||coalesce(p_note,''),(now() AT TIME ZONE 'Asia/Jakarta')::date,actor);
    UPDATE public.invoices SET payment_proof_url=coalesce(nullif(sug.image_url,''),payment_proof_url),paid_method=p_method WHERE id=inv.id RETURNING * INTO inv;
    IF inv.status='PAID' THEN UPDATE public.orders SET status='PAID' WHERE id=inv.job_id AND status NOT IN ('CANCELLED'); END IF;
    result_value:=result_value||jsonb_build_array(to_jsonb(inv));
  END LOOP;
  UPDATE public.payment_suggestions SET status='CONFIRMED',resolved_at=now(),resolved_by=actor WHERE id=sug.id;
  UPDATE public.wa_payment_receipts SET result=result_value WHERE id=p_id;
  RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.apply_wa_payment(uuid,uuid,jsonb,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_wa_payment(uuid,uuid,jsonb,numeric,text,text) TO authenticated;
COMMIT;
