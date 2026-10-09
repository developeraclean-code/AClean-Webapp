-- Katalog gambar permanen untuk balasan cepat WA. Terapkan setelah 197.
BEGIN;

CREATE TABLE IF NOT EXISTS public.wa_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1200),
  image_key text NOT NULL CHECK (image_key ~ '^catalog/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$'),
  price_source text NOT NULL DEFAULT 'none' CHECK (price_source IN ('none','fixed','price_list','ac_unit','ac_installed')),
  source_id text,
  fixed_price numeric(14,2) CHECK (fixed_price IS NULL OR fixed_price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((price_source IN ('price_list','ac_unit','ac_installed')) = (source_id IS NOT NULL)),
  CHECK (price_source <> 'fixed' OR fixed_price IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS wa_catalog_active_order ON public.wa_catalog_items(is_active,sort_order,title);
ALTER TABLE public.wa_catalog_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_catalog_read ON public.wa_catalog_items;
CREATE POLICY wa_catalog_read ON public.wa_catalog_items FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('Owner','Admin'));
DROP POLICY IF EXISTS wa_catalog_owner_insert ON public.wa_catalog_items;
CREATE POLICY wa_catalog_owner_insert ON public.wa_catalog_items FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'Owner');
DROP POLICY IF EXISTS wa_catalog_owner_update ON public.wa_catalog_items;
CREATE POLICY wa_catalog_owner_update ON public.wa_catalog_items FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'Owner') WITH CHECK (public.get_my_role() = 'Owner');
REVOKE ALL ON public.wa_catalog_items FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.wa_catalog_items TO authenticated;
GRANT ALL ON public.wa_catalog_items TO service_role;

ALTER TABLE public.wa_outbox DROP CONSTRAINT IF EXISTS wa_outbox_kind_check;
ALTER TABLE public.wa_outbox ADD CONSTRAINT wa_outbox_kind_check
  CHECK (kind IN ('TEXT','INVOICE','REPORT','SERVICE_REMINDER','CATALOG'));

CREATE OR REPLACE FUNCTION public.finish_wa_send(p_id uuid,p_status text,p_error text DEFAULT NULL,p_provider_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE item public.wa_outbox%ROWTYPE; saved_message_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('ACCEPTED','FAILED','UNCERTAIN') THEN RAISE EXCEPTION 'Invalid send status'; END IF;
  SELECT * INTO item FROM public.wa_outbox WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pengiriman tidak ditemukan'; END IF;
  IF item.status<>'SENDING' THEN RETURN to_jsonb(item); END IF;
  IF p_status='ACCEPTED' THEN
    INSERT INTO public.wa_messages(phone,name,content,role,image_url,created_at)
      VALUES(item.phone,item.actor,
        item.message||CASE WHEN item.attachment_url IS NULL THEN '' WHEN item.kind='CATALOG' THEN '' ELSE E'\n📄 '||item.attachment_url END,
        'admin',CASE WHEN item.kind='CATALOG' THEN item.attachment_url ELSE NULL END,now()) RETURNING id INTO saved_message_id;
    UPDATE public.wa_conversations SET last_reply=left(item.message,80),updated_at=now() WHERE phone=item.phone;
    IF item.kind='INVOICE' THEN PERFORM public.record_invoice_wa_sent(ARRAY[item.document_id],'single',NULL,item.actor,'fonnte'); END IF;
    IF item.kind='REPORT' THEN PERFORM public.record_report_card_wa_sent(item.document_id,'single',item.actor,'fonnte'); END IF;
    IF item.kind='SERVICE_REMINDER' THEN UPDATE public.customers SET last_rating_request=(now() AT TIME ZONE 'Asia/Jakarta')::date WHERE id::text=item.customer_id; END IF;
  END IF;
  UPDATE public.wa_outbox SET status=p_status,error=p_error,provider_id=p_provider_id,message_id=saved_message_id,finished_at=now() WHERE id=p_id RETURNING * INTO item;
  RETURN to_jsonb(item);
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
