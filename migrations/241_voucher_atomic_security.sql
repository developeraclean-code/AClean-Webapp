-- Forward-only voucher repair. 237–240 are reserved by the independent security worktree.
-- Supabase CLI is unavailable on the working Mac; use this repository's numbered migration convention.
BEGIN;

CREATE OR REPLACE FUNCTION public.voucher_phone_241(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 WITH p AS (SELECT btrim(coalesce(p_phone,'')) raw,regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') n)
 SELECT CASE WHEN raw LIKE '+%' THEN n WHEN n LIKE '08%' THEN '62'||substr(n,2)
 WHEN n LIKE '8%' THEN '62'||n ELSE n END FROM p
$$;
REVOKE ALL ON FUNCTION public.voucher_phone_241(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voucher_phone_241(text) TO service_role;

ALTER TABLE public.customer_vouchers
 ADD COLUMN IF NOT EXISTS issuance_key text,
 ADD COLUMN IF NOT EXISTS issued_message_sent boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS issued_message_status text CHECK(issued_message_status IN ('SENDING','ACCEPTED','FAILED','UNCERTAIN')),
 ADD COLUMN IF NOT EXISTS reminder_status text CHECK(reminder_status IN ('SENDING','ACCEPTED','FAILED','UNCERTAIN')),
 ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
 ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.user_profiles(id),
 ADD COLUMN IF NOT EXISTS cancel_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS customer_vouchers_issuance_241 ON public.customer_vouchers(issuance_key) WHERE issuance_key IS NOT NULL;
ALTER TABLE public.customer_vouchers ADD CONSTRAINT customer_vouchers_terms_241 CHECK (
 type IN ('discount_pct','free_unit','free_service') AND
 ((type='discount_pct' AND value IS NOT NULL AND value>0 AND value<=100) OR
  (type='free_unit' AND value IS NOT NULL AND value>=1 AND value<=100 AND value=trunc(value)) OR
  (type='free_service' AND (value IS NULL OR value>0)))
) NOT VALID;
REVOKE ALL ON public.customer_vouchers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.customer_vouchers TO authenticated;
GRANT ALL ON public.customer_vouchers TO service_role;
ALTER TABLE public.customer_vouchers ENABLE ROW LEVEL SECURITY;
DO $$DECLARE p record;BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='customer_vouchers' LOOP
 EXECUTE format('DROP POLICY %I ON public.customer_vouchers',p.policyname);END LOOP;
END$$;
CREATE POLICY voucher_admin_read_241 ON public.customer_vouchers FOR SELECT TO authenticated
 USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT public.get_my_role()) IN ('Owner','Admin'));

ALTER TABLE public.invoices
 ADD COLUMN IF NOT EXISTS voucher_id uuid REFERENCES public.customer_vouchers(id),
 ADD COLUMN IF NOT EXISTS voucher_code text,
 ADD COLUMN IF NOT EXISTS voucher_discount bigint NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS voucher_manual_discount bigint NOT NULL DEFAULT 0;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_voucher_amount_241 CHECK(voucher_discount>=0 AND voucher_manual_discount>=0) NOT VALID;

CREATE TABLE public.voucher_redemptions (
 voucher_id uuid PRIMARY KEY REFERENCES public.customer_vouchers(id),
 invoice_id text NOT NULL UNIQUE REFERENCES public.invoices(id),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 terms jsonb NOT NULL,
 manual_discount bigint NOT NULL CHECK(manual_discount>=0),
 voucher_discount bigint NOT NULL CHECK(voucher_discount>=0),
 final_discount bigint NOT NULL CHECK(final_discount>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.voucher_operations (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 invoice_id text NOT NULL REFERENCES public.invoices(id),
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.voucher_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voucher_redemptions,public.voucher_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.voucher_redemptions,public.voucher_operations TO authenticated;
GRANT ALL ON public.voucher_redemptions,public.voucher_operations TO service_role;
CREATE POLICY voucher_redemptions_read_241 ON public.voucher_redemptions FOR SELECT TO authenticated
 USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT public.get_my_role()) IN ('Owner','Admin'));
CREATE POLICY voucher_operations_read_241 ON public.voucher_operations FOR SELECT TO authenticated
 USING ((SELECT auth.uid()) IS NOT NULL AND (SELECT public.get_my_role()) IN ('Owner','Admin'));

CREATE OR REPLACE FUNCTION public.voucher_assert_actor_241(p_actor uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
DECLARE n text;
BEGIN
 SELECT name INTO n FROM public.user_profiles WHERE id=p_actor AND active IS TRUE AND role IN ('Owner','Admin');
 IF n IS NULL THEN RAISE EXCEPTION 'Hanya Owner/Admin aktif' USING ERRCODE='42501'; END IF;
 RETURN n;
END$$;

-- The payload is normalized by the server and independently checked here.
-- Only service_role can execute; no authenticated caller can submit a trusted payload directly.
CREATE OR REPLACE FUNCTION public.voucher_quote_241(p_actor uuid,p_invoice text,p_code text,p_edit jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE i public.invoices; v public.customer_vouchers; r public.voucher_redemptions;
 l jsonb; cat text; sub numeric; qty numeric; price numeric; jasa numeric:=0; material numeric:=0;
 linedisc numeric:=0; eligible numeric:=0; benefit numeric:=0; remaining numeric;
 manual numeric; trade numeric; available numeric; finaldisc numeric; terms jsonb; q jsonb; hash text;
BEGIN
 PERFORM public.voucher_assert_actor_241(p_actor);
 SELECT * INTO i FROM public.invoices WHERE id=p_invoice;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tidak ditemukan' USING ERRCODE='P0002'; END IF;
 IF i.status IN ('PAID','CANCELLED','PARTIAL_PAID') OR coalesce(i.paid_amount,0)>0 OR coalesce(i.withheld_amount,0)>0
 OR EXISTS(SELECT 1 FROM public.invoice_payments WHERE invoice_id=i.id AND (amount>0 OR withheld_amount>0)) THEN
 RAISE EXCEPTION 'Voucher tidak dapat mengubah invoice yang sudah menerima pembayaran atau dibatalkan' USING ERRCODE='23514';END IF;
 SELECT * INTO v FROM public.customer_vouchers WHERE code=upper(btrim(p_code));
 IF NOT FOUND THEN RAISE EXCEPTION 'Kode voucher tidak ditemukan' USING ERRCODE='P0002';END IF;
 SELECT * INTO r FROM public.voucher_redemptions WHERE voucher_id=v.id AND invoice_id=i.id;
 IF i.voucher_id IS NOT NULL AND i.voucher_id<>v.id THEN RAISE EXCEPTION 'Invoice sudah menggunakan voucher lain' USING ERRCODE='23514';END IF;
 IF public.voucher_phone_241(i.phone)<>public.voucher_phone_241(v.phone) OR public.voucher_phone_241(i.phone)!~'^[0-9]{8,15}$' THEN
 RAISE EXCEPTION 'Voucher bukan milik pelanggan invoice ini' USING ERRCODE='23514';END IF;
 IF r.voucher_id IS NULL THEN
  IF v.is_valid IS NOT TRUE THEN RAISE EXCEPTION 'Voucher sudah dibatalkan' USING ERRCODE='23514';END IF;
  IF v.claimed_at IS NOT NULL THEN RAISE EXCEPTION 'Voucher sudah digunakan' USING ERRCODE='23514';END IF;
  IF v.expires_at IS NOT NULL AND v.expires_at<(now() AT TIME ZONE 'Asia/Jakarta')::date THEN RAISE EXCEPTION 'Voucher sudah expired' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM public.voucher_redemptions WHERE invoice_id=i.id) THEN RAISE EXCEPTION 'Invoice sudah menggunakan voucher' USING ERRCODE='23514';END IF;
 END IF;
 terms:=coalesce(r.terms,jsonb_build_object('type',v.type,'value',v.value));
 IF jsonb_typeof(p_edit->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_edit->'lines') NOT BETWEEN 1 AND 200
 OR p_edit->>'policy_version' IS DISTINCT FROM '241-best-jasa' THEN RAISE EXCEPTION 'Payload invoice tidak valid' USING ERRCODE='22023';END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(p_edit->'lines') LOOP
  cat:=l->>'category';sub:=(l->>'subtotal')::numeric;qty:=(l->>'jumlah')::numeric;price:=(l->>'harga_satuan')::numeric;
  IF cat IS NULL OR cat NOT IN ('LABOR','FEE','PART','FREON','DISCOUNT') OR qty IS NULL OR price IS NULL OR sub IS NULL
  OR qty<=0 OR qty>1000000 OR price<>trunc(price) OR abs(price)>1000000000000 OR abs(sub)>1000000000000
  OR qty::text IN ('NaN','Infinity','-Infinity') OR price::text IN ('NaN','Infinity','-Infinity')
  OR sub IS DISTINCT FROM sign(price*qty)*round(abs(price*qty)) OR nullif(btrim(l->>'nama'),'') IS NULL
  OR sub::text IN ('NaN','Infinity','-Infinity') OR (sub<0 AND cat<>'DISCOUNT') THEN RAISE EXCEPTION 'Rincian item tidak valid' USING ERRCODE='22023';END IF;
  IF cat IN ('LABOR','FEE') THEN jasa:=jasa+sub;
  ELSIF cat='DISCOUNT' THEN linedisc:=linedisc+abs(sub);ELSE material:=material+sub;END IF;
  IF cat='LABOR' AND sub>0 THEN eligible:=eligible+sub;END IF;
 END LOOP;
 manual:=(p_edit->>'manual_discount')::numeric;trade:=(p_edit->>'trade_in_amount')::numeric;
 IF manual IS NULL OR trade IS NULL OR manual<0 OR trade<0 OR manual<>trunc(manual) OR trade<>trunc(trade)
 OR manual::text IN ('NaN','Infinity','-Infinity') OR trade::text IN ('NaN','Infinity','-Infinity')
 OR manual>1000000000000 OR trade>2147483647 OR manual+trade+linedisc>jasa+material
 OR jasa IS DISTINCT FROM (p_edit->>'labor')::numeric OR material IS DISTINCT FROM (p_edit->>'material')::numeric
 OR linedisc IS DISTINCT FROM (p_edit->>'line_discount')::numeric OR coalesce(p_edit->>'customer','')=''
 OR (p_edit->>'pph23_rate') IS NULL OR (p_edit->>'pph23_rate')::numeric NOT IN (0.02,0.025)
 OR ((p_edit->>'pph23')::boolean AND jasa<=0) THEN RAISE EXCEPTION 'Ringkasan invoice tidak valid' USING ERRCODE='22023';END IF;
 eligible:=greatest(0,eligible-linedisc-trade);
 IF terms->>'type'='discount_pct' THEN
  IF (terms->>'value') IS NULL OR (terms->>'value')::numeric<=0 OR (terms->>'value')::numeric>100 THEN RAISE EXCEPTION 'Persentase tidak valid' USING ERRCODE='23514';END IF;
  benefit:=round(eligible*(terms->>'value')::numeric/100);
 ELSIF terms->>'type'='free_unit' THEN
  remaining:=(terms->>'value')::numeric;
  IF remaining IS NULL OR remaining<1 OR remaining>100 OR remaining<>trunc(remaining) THEN RAISE EXCEPTION 'Jumlah unit tidak valid' USING ERRCODE='23514';END IF;
  FOR l IN SELECT value FROM jsonb_array_elements(p_edit->'lines') WHERE value->>'category'='LABOR'
    AND (value->>'subtotal')::numeric>0 AND lower(value->>'nama')~'(cleaning|cuci|pembersihan)'
    ORDER BY (value->>'harga_satuan')::numeric LOOP
   qty:=least(remaining,floor((l->>'jumlah')::numeric));benefit:=benefit+qty*(l->>'harga_satuan')::numeric;remaining:=remaining-qty;
   EXIT WHEN remaining<=0;
  END LOOP;
  benefit:=round(benefit);
 ELSIF terms->>'type'='free_service' THEN benefit:=eligible;
 ELSE RAISE EXCEPTION 'Jenis voucher tidak didukung' USING ERRCODE='23514';END IF;
 available:=jasa+material-linedisc-trade;benefit:=least(benefit,eligible,available);finaldisc:=greatest(manual,benefit);
 IF r.voucher_id IS NULL AND finaldisc<=manual THEN RAISE EXCEPTION 'Voucher tidak menambah potongan; simpan tanpa voucher' USING ERRCODE='23514';END IF;
 q:=jsonb_build_object('invoice_id',i.id,'expected_updated_at',i.updated_at,'voucher',jsonb_build_object('id',v.id,'code',v.code,'type',terms->>'type','value',terms->'value','description',v.description,'expires_at',v.expires_at),
 'already_redeemed',r.voucher_id IS NOT NULL,'benefit',benefit,'manual_discount',manual,'discount',finaldisc,'voucher_discount',finaldisc-manual,'total',available-finaldisc,'labor',jasa,'material',material,'line_discount',linedisc,'policy_version','241-best-jasa');
 hash:=encode(sha256(convert_to((q||jsonb_build_object('edit',p_edit))::text,'UTF8')),'hex');
 RETURN q||jsonb_build_object('quote_hash',hash);
END$$;

CREATE OR REPLACE FUNCTION public.save_invoice_voucher_241(p_actor uuid,p_request uuid,p_invoice text,p_code text,p_edit jsonb,p_expected_at timestamptz,p_quote_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' SET lock_timeout='2s' AS $$
DECLARE who text; i public.invoices; v public.customer_vouchers; q jsonb; fingerprint text; op public.voucher_operations; result jsonb;
BEGIN
 who:=public.voucher_assert_actor_241(p_actor);
 IF p_request IS NULL OR p_expected_at IS NULL THEN RAISE EXCEPTION 'ID transaksi dan versi invoice wajib tersedia' USING ERRCODE='22023';END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('actor',p_actor,'invoice',p_invoice,'code',upper(btrim(p_code)),'edit',p_edit,'expected',p_expected_at,'quote',p_quote_hash)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,241));
 SELECT * INTO op FROM public.voucher_operations WHERE id=p_request;
 IF FOUND THEN
  IF op.actor_id<>p_actor OR op.request_hash<>fingerprint THEN RAISE EXCEPTION 'ID transaksi sudah dipakai untuk permintaan berbeda' USING ERRCODE='23514';END IF;
  SELECT * INTO i FROM public.invoices WHERE id=op.invoice_id;
  RETURN op.result||jsonb_build_object('invoice',to_jsonb(i),'replayed',true);
 END IF;
 SELECT * INTO i FROM public.invoices WHERE id=p_invoice FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tidak ditemukan' USING ERRCODE='P0002';END IF;
 IF i.updated_at IS DISTINCT FROM p_expected_at THEN RAISE EXCEPTION 'Invoice berubah; muat ulang dan validasi voucher kembali' USING ERRCODE='40001';END IF;
 SELECT * INTO v FROM public.customer_vouchers WHERE code=upper(btrim(p_code)) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Voucher tidak ditemukan' USING ERRCODE='P0002';END IF;
 q:=public.voucher_quote_241(p_actor,p_invoice,p_code,p_edit);
 IF q->>'quote_hash' IS DISTINCT FROM p_quote_hash THEN RAISE EXCEPTION 'Perhitungan voucher berubah; validasi ulang' USING ERRCODE='40001';END IF;
 PERFORM set_config('aclean.voucher_write','241',true);
 UPDATE public.invoices SET
  labor=(q->>'labor')::bigint,material=(q->>'material')::bigint,
  discount=(q->>'discount')::bigint,total=(q->>'total')::bigint,remaining_amount=(q->>'total')::numeric,
  status=CASE WHEN (q->>'total')::numeric=0 AND status IN ('UNPAID','OVERDUE','SENT','APPROVED') THEN 'PAID' ELSE status END,
  paid_at=CASE WHEN (q->>'total')::numeric=0 AND status IN ('UNPAID','OVERDUE','SENT','APPROVED') THEN clock_timestamp() ELSE paid_at END,
  trade_in=coalesce((p_edit->>'trade_in')::boolean,false),trade_in_amount=(p_edit->>'trade_in_amount')::integer,
  pph23=coalesce((p_edit->>'pph23')::boolean,false),
  pph23_amount=CASE WHEN coalesce((p_edit->>'pph23')::boolean,false) THEN round((q->>'labor')::numeric/(1-(p_edit->>'pph23_rate')::numeric))-(q->>'labor')::numeric ELSE 0 END,
  materials_detail=(p_edit->'lines')::text,customer=p_edit->>'customer',address=p_edit->>'address',
  voucher_id=v.id,voucher_code=v.code,voucher_discount=(q->>'voucher_discount')::bigint,voucher_manual_discount=(q->>'manual_discount')::bigint,
  last_changed_by=who,pdf_url=NULL,pdf_generated_at=NULL,updated_at=clock_timestamp()
 WHERE id=p_invoice RETURNING * INTO i;
 -- Existing production invoice guards remain enabled. Never report a result altered by an unexpected trigger.
 IF i.total<>(q->>'total')::numeric OR i.discount<>(q->>'discount')::numeric OR i.labor<>(q->>'labor')::numeric OR i.material<>(q->>'material')::numeric THEN
 RAISE EXCEPTION 'Validasi hasil invoice gagal; seluruh transaksi dibatalkan' USING ERRCODE='23514';END IF;
 INSERT INTO public.voucher_redemptions(voucher_id,invoice_id,actor_id,terms,manual_discount,voucher_discount,final_discount)
 VALUES(v.id,i.id,p_actor,jsonb_build_object('type',v.type,'value',v.value),(q->>'manual_discount')::bigint,(q->>'voucher_discount')::bigint,(q->>'discount')::bigint)
 ON CONFLICT(voucher_id) DO UPDATE SET manual_discount=EXCLUDED.manual_discount,voucher_discount=EXCLUDED.voucher_discount,
 final_discount=EXCLUDED.final_discount,updated_at=clock_timestamp();
 UPDATE public.customer_vouchers SET claimed_at=coalesce(claimed_at,clock_timestamp()),claimed_order_id=i.id WHERE id=v.id;
 result:=jsonb_build_object('invoice',to_jsonb(i),'request_id',p_request,'replayed',false,'quote',q);
 INSERT INTO public.voucher_operations(id,actor_id,invoice_id,request_hash,result) VALUES(p_request,p_actor,i.id,fingerprint,result);
 PERFORM set_config('aclean.voucher_write','',true);
 RETURN result;
END$$;
ALTER FUNCTION public.save_invoice_voucher_241(uuid,uuid,text,text,jsonb,timestamptz,text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.guard_invoice_voucher_241()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE allowed boolean;
BEGIN
 allowed:=current_setting('aclean.voucher_write',true)='241' AND current_user=(SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.save_invoice_voucher_241(uuid,uuid,text,text,jsonb,timestamptz,text)'::regprocedure);
 IF TG_OP='INSERT' THEN
  IF (NEW.voucher_id IS NOT NULL OR NEW.voucher_code IS NOT NULL OR NEW.voucher_discount<>0 OR NEW.voucher_manual_discount<>0) AND NOT coalesce(allowed,false) THEN RAISE EXCEPTION 'Voucher hanya melalui transaksi atomik' USING ERRCODE='42501';END IF;
 ELSE
  IF (NEW.voucher_id,NEW.voucher_code,NEW.voucher_discount,NEW.voucher_manual_discount) IS DISTINCT FROM (OLD.voucher_id,OLD.voucher_code,OLD.voucher_discount,OLD.voucher_manual_discount)
   AND NOT coalesce(allowed,false) THEN RAISE EXCEPTION 'Metadata voucher dikunci' USING ERRCODE='42501';END IF;
  IF OLD.voucher_id IS NOT NULL AND (NEW.labor,NEW.material,NEW.discount,NEW.total,NEW.trade_in,NEW.trade_in_amount,NEW.materials_detail,NEW.phone,NEW.customer,NEW.address,NEW.pph23,NEW.pph23_amount)
   IS DISTINCT FROM (OLD.labor,OLD.material,OLD.discount,OLD.total,OLD.trade_in,OLD.trade_in_amount,OLD.materials_detail,OLD.phone,OLD.customer,OLD.address,OLD.pph23,OLD.pph23_amount)
   AND NOT coalesce(allowed,false) THEN RAISE EXCEPTION 'Invoice dengan voucher harus diedit melalui transaksi atomik' USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.guard_invoice_voucher_241() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_guard_invoice_voucher_241 BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_voucher_241();

CREATE OR REPLACE FUNCTION public.cancel_voucher_241(p_actor uuid,p_id uuid,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v public.customer_vouchers;
BEGIN
 PERFORM public.voucher_assert_actor_241(p_actor);
 SELECT * INTO v FROM public.customer_vouchers WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Voucher tidak ditemukan' USING ERRCODE='P0002';END IF;
 IF v.claimed_at IS NOT NULL THEN RAISE EXCEPTION 'Voucher yang sudah digunakan tidak dapat dibatalkan' USING ERRCODE='23514';END IF;
 IF v.is_valid IS FALSE THEN RETURN jsonb_build_object('ok',true,'already_cancelled',true);END IF;
 UPDATE public.customer_vouchers SET is_valid=false,cancelled_at=clock_timestamp(),cancelled_by=p_actor,cancel_reason=left(coalesce(p_reason,'Pembatalan oleh admin'),500) WHERE id=p_id;
 RETURN jsonb_build_object('ok',true,'already_cancelled',false);
END$$;

CREATE OR REPLACE FUNCTION public.voucher_admin_page_241(p_actor uuid,p_status text DEFAULT 'active',p_search text DEFAULT '',p_offset integer DEFAULT 0,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
DECLARE rows jsonb;stats jsonb;n bigint;term text;
BEGIN
 PERFORM public.voucher_assert_actor_241(p_actor);
 IF p_status NOT IN ('active','claimed','expired','cancelled','all') OR p_limit NOT BETWEEN 1 AND 100 OR p_offset<0 OR length(p_search)>100 THEN RAISE EXCEPTION 'Filter tidak valid' USING ERRCODE='22023';END IF;
 term:='%'||replace(replace(replace(btrim(p_search),'\','\\'),'%','\%'),'_','\_')||'%';
 SELECT jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE claimed_at IS NULL AND is_valid IS TRUE AND (expires_at IS NULL OR expires_at>=(now() AT TIME ZONE 'Asia/Jakarta')::date)),
 'claimed',count(*) FILTER(WHERE claimed_at IS NOT NULL),'cancelled',count(*) FILTER(WHERE claimed_at IS NULL AND is_valid IS NOT TRUE),
 'expired',count(*) FILTER(WHERE claimed_at IS NULL AND is_valid IS TRUE AND expires_at<(now() AT TIME ZONE 'Asia/Jakarta')::date)) INTO stats FROM public.customer_vouchers;
 WITH f AS (SELECT * FROM public.customer_vouchers WHERE
  (p_search='' OR code ILIKE term OR phone ILIKE term OR customer_name ILIKE term) AND
  (p_status='all' OR (p_status='claimed' AND claimed_at IS NOT NULL) OR (p_status='cancelled' AND claimed_at IS NULL AND is_valid IS NOT TRUE)
   OR (p_status='expired' AND claimed_at IS NULL AND is_valid IS TRUE AND expires_at<(now() AT TIME ZONE 'Asia/Jakarta')::date)
   OR (p_status='active' AND claimed_at IS NULL AND is_valid IS TRUE AND (expires_at IS NULL OR expires_at>=(now() AT TIME ZONE 'Asia/Jakarta')::date))))
 SELECT (SELECT count(*) FROM f),(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM (SELECT * FROM f ORDER BY created_at DESC,id LIMIT p_limit OFFSET p_offset)t) INTO n,rows;
 RETURN jsonb_build_object('vouchers',rows,'stats',stats,'total_filtered',n,'offset',p_offset,'limit',p_limit,'has_more',p_offset+p_limit<n);
END$$;

-- High-water marks prevent retroactive loyalty blasts on first activation.
CREATE TABLE public.voucher_automation_state (
 key text PRIMARY KEY, eligible_count integer NOT NULL DEFAULT 0 CHECK(eligible_count>=0), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.voucher_automation_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voucher_automation_state FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.voucher_automation_state TO service_role;

CREATE OR REPLACE FUNCTION public.issue_vouchers_241(p_kind text,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE c record;m record; previous integer; issued integer:=0;baseline boolean:=false;today date:=(now() AT TIME ZONE 'Asia/Jakarta')::date;
 v_key text; code text; changed integer;
BEGIN
 IF p_kind NOT IN ('loyalty','winback') OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Task voucher tidak valid' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('voucher-issuance-'||p_kind,241));
 IF p_kind='loyalty' THEN
  IF NOT EXISTS(SELECT 1 FROM public.voucher_automation_state WHERE key='loyalty-baseline') THEN
   INSERT INTO public.voucher_automation_state(key,eligible_count)
   SELECT 'loyalty:'||public.voucher_phone_241(phone),count(DISTINCT coalesce(job_group_id,parent_job_id,id))
   FROM public.orders WHERE status='PAID' AND public.voucher_phone_241(phone)~'^[0-9]{8,15}$'
   GROUP BY public.voucher_phone_241(phone);
   INSERT INTO public.voucher_automation_state(key) VALUES('loyalty-baseline');
   RETURN jsonb_build_object('issued',0,'baseline_initialized',true);
  END IF;
  FOR c IN SELECT public.voucher_phone_241(phone) phone,(array_agg(customer ORDER BY date DESC NULLS LAST,id DESC))[1] name,
   count(DISTINCT coalesce(job_group_id,parent_job_id,id)) n FROM public.orders
   WHERE status='PAID' AND public.voucher_phone_241(phone)~'^[0-9]{8,15}$'
   GROUP BY public.voucher_phone_241(phone) ORDER BY public.voucher_phone_241(phone) LOOP
   SELECT eligible_count INTO previous FROM public.voucher_automation_state WHERE key='loyalty:'||c.phone;
   previous:=coalesce(previous,0);
   FOR m IN SELECT * FROM (VALUES(2,'discount_pct',5,'Diskon 5% jasa — terima kasih sudah kembali!'),(5,'discount_pct',10,'Diskon 10% jasa — pelanggan setia ke-5 kali!'),(10,'free_unit',1,'1 unit Cleaning gratis — terima kasih sudah setia 10 kali!'),(15,'discount_pct',15,'Diskon 15% jasa — VIP 15x servis!')) AS t(at,kind,value,description)
    WHERE at>previous AND at<=c.n ORDER BY at LOOP
    IF issued>=p_limit THEN RETURN jsonb_build_object('issued',issued,'has_more',true);END IF;
    v_key:='loyalty:'||c.phone||':'||m.at;code:='ACL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
    INSERT INTO public.customer_vouchers(phone,customer_name,code,type,value,description,min_orders,expires_at,trigger,milestone_at,is_valid,issuance_key)
    SELECT c.phone,c.name,code,m.kind,m.value,m.description,m.at,today+90,'milestone',m.at,true,v_key
    WHERE NOT EXISTS(SELECT 1 FROM public.customer_vouchers v WHERE public.voucher_phone_241(v.phone)=c.phone AND v.milestone_at=m.at AND v.trigger='milestone')
    ON CONFLICT(issuance_key) WHERE issuance_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS changed=ROW_COUNT;issued:=issued+changed;
   END LOOP;
   INSERT INTO public.voucher_automation_state(key,eligible_count) VALUES('loyalty:'||c.phone,c.n)
   ON CONFLICT(key) DO UPDATE SET eligible_count=greatest(voucher_automation_state.eligible_count,EXCLUDED.eligible_count),updated_at=now();
  END LOOP;
 ELSE
  -- One win-back per last-service episode, with the existing 30-day cooldown preserved.
  FOR c IN SELECT public.voucher_phone_241(phone) phone,(array_agg(name ORDER BY last_service DESC NULLS LAST,id DESC))[1] name,
   max(last_service) serviced,max(last_winback_sent) last_sent FROM public.customers
   WHERE public.voucher_phone_241(phone)~'^[0-9]{8,15}$' GROUP BY public.voucher_phone_241(phone)
   HAVING max(last_service)<=today-180 AND (max(last_winback_sent) IS NULL OR max(last_winback_sent)<=today-30)
   ORDER BY max(last_service),public.voucher_phone_241(phone) LOOP
   IF EXISTS(SELECT 1 FROM public.orders o WHERE public.voucher_phone_241(o.phone)=c.phone AND
    (o.status NOT IN ('COMPLETED','INVOICE_APPROVED','PAID','CANCELLED','REJECTED') OR o.date>c.serviced)) THEN CONTINUE;END IF;
   v_key:='winback:'||c.phone||':'||c.serviced;
   IF EXISTS(SELECT 1 FROM public.customer_vouchers v WHERE v.issuance_key=v_key OR
    (public.voucher_phone_241(v.phone)=c.phone AND v.trigger='winback' AND v.created_at>now()-interval '30 days')) THEN CONTINUE;END IF;
   code:='ACL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
   INSERT INTO public.customer_vouchers(phone,customer_name,code,type,value,description,expires_at,trigger,is_valid,issuance_key)
    VALUES(c.phone,c.name,code,'discount_pct',10,'Diskon 10% jasa — kami kangen Anda!',today+60,'winback',true,v_key) ON CONFLICT(issuance_key) WHERE issuance_key IS NOT NULL DO NOTHING;
   GET DIAGNOSTICS changed=ROW_COUNT;issued:=issued+changed;
   IF issued>=p_limit THEN RETURN jsonb_build_object('issued',issued,'has_more',true);END IF;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('issued',issued,'baseline_initialized',baseline,'has_more',false);
END$$;
REVOKE ALL ON FUNCTION public.issue_vouchers_241(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_vouchers_241(text,integer) TO service_role;

-- Internal RPC entrypoints: the API validates session identity; the database repeats active-role checks.
REVOKE ALL ON FUNCTION public.voucher_assert_actor_241(uuid),public.voucher_quote_241(uuid,text,text,jsonb),
 public.save_invoice_voucher_241(uuid,uuid,text,text,jsonb,timestamptz,text),public.cancel_voucher_241(uuid,uuid,text),
 public.voucher_admin_page_241(uuid,text,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voucher_assert_actor_241(uuid),public.voucher_quote_241(uuid,text,text,jsonb),
 public.save_invoice_voucher_241(uuid,uuid,text,text,jsonb,timestamptz,text),public.cancel_voucher_241(uuid,uuid,text),
 public.voucher_admin_page_241(uuid,text,text,integer,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
