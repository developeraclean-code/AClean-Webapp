-- 214: atomically acknowledge inbound WA + conversation + recoverable media URL.
-- Additive only. Never changes invoices, payments, suggestions or old messages.
BEGIN;
ALTER TABLE public.wa_webhook_raw
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS intake_status text,
  ADD COLUMN IF NOT EXISTS intake_error text,
  ADD COLUMN IF NOT EXISTS message_id text;
CREATE UNIQUE INDEX IF NOT EXISTS wa_webhook_event_214 ON public.wa_webhook_raw(event_key);
CREATE INDEX IF NOT EXISTS wa_webhook_review_214 ON public.wa_webhook_raw(created_at DESC) WHERE intake_status='REVIEW';
ALTER TABLE public.wa_messages ADD COLUMN IF NOT EXISTS webhook_event_key text;
CREATE UNIQUE INDEX IF NOT EXISTS wa_message_event_214 ON public.wa_messages(webhook_event_key);
ALTER TABLE public.wa_payment_media_jobs ADD COLUMN IF NOT EXISTS wa_message_id text;

CREATE OR REPLACE FUNCTION public.link_wa_media_message_214() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.wa_message_id IS NOT NULL AND NEW.r2_url ~ '^/api/foto\?key=wa-inbox(%2[Ff]|/)' THEN
    UPDATE public.wa_messages SET image_url=NEW.r2_url
      WHERE phone=NEW.phone AND id::text=NEW.wa_message_id AND role='customer'
        AND (image_url IS NULL OR image_url=NEW.source_url OR image_url=NEW.r2_url);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.link_wa_media_message_214() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS wa_media_message_link_214 ON public.wa_payment_media_jobs;
CREATE TRIGGER wa_media_message_link_214 AFTER INSERT OR UPDATE OF r2_url ON public.wa_payment_media_jobs
  FOR EACH ROW EXECUTE FUNCTION public.link_wa_media_message_214();

CREATE OR REPLACE FUNCTION public.capture_wa_webhook_214(p_event jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE receipt public.wa_webhook_raw%ROWTYPE; media public.wa_payment_media_jobs%ROWTYPE;
  message_id_value text; phone_value text:=p_event->>'phone'; name_value text:=p_event->>'name';
  text_value text:=p_event->>'message'; media_url text:=p_event->>'media_url';
  is_group boolean:=coalesce((p_event->>'is_group')::boolean,false);
  internal_sender boolean:=false; detect_enabled boolean:=true; review_reason text:=p_event->>'review_reason';
  final_status text:='RECORDED';
BEGIN
  IF p_event IS NULL OR jsonb_typeof(p_event)<>'object' OR coalesce(p_event->>'event_key','') !~ '^wa_[0-9a-f]{64}$'
    OR octet_length(p_event::text)>65536 THEN RAISE EXCEPTION 'Data webhook tidak valid'; END IF;
  IF phone_value IS NOT NULL AND phone_value !~ '^[0-9]{8,15}$' THEN RAISE EXCEPTION 'Nomor webhook tidak valid'; END IF;
  IF media_url IS NOT NULL AND (length(media_url)>4096 OR media_url !~ '^https://([a-z0-9-]+\.)*fonnte\.com/') THEN RAISE EXCEPTION 'URL media tidak aman'; END IF;
  IF NOT is_group AND phone_value IS NULL THEN review_reason:=coalesce(review_reason,'Identitas pengirim belum dapat dipastikan'); END IF;
  IF NOT is_group AND nullif(text_value,'') IS NULL THEN review_reason:=coalesce(review_reason,'Pesan kosong; periksa manual'); END IF;
  IF length(coalesce(text_value,''))>4096 THEN RAISE EXCEPTION 'Pesan webhook terlalu panjang'; END IF;
  INSERT INTO public.wa_webhook_raw(event_key,payload,sender,member,msg_type,has_member,has_message,intake_status,intake_error)
    VALUES(p_event->>'event_key',coalesce(p_event->'payload','{}'::jsonb),left(p_event->>'sender',100),left(p_event->>'member',100),
      left(p_event->>'type',40),is_group,nullif(text_value,'') IS NOT NULL,'RECEIVED',review_reason)
    ON CONFLICT(event_key) DO NOTHING RETURNING * INTO receipt;
  IF NOT FOUND THEN
    SELECT * INTO receipt FROM public.wa_webhook_raw WHERE event_key=p_event->>'event_key';
    RETURN jsonb_build_object('duplicate',true,'receipt_id',receipt.id::text,'received_at',receipt.created_at,
      'message_id',receipt.message_id,'intake_status',receipt.intake_status);
  END IF;
  IF is_group THEN final_status:='GROUP_RECEIVED';
  ELSE
    IF phone_value IS NOT NULL AND nullif(text_value,'') IS NOT NULL THEN
      INSERT INTO public.wa_messages(phone,name,content,role,created_at,webhook_event_key)
        VALUES(phone_value,left(name_value,100),text_value,'customer',receipt.created_at,p_event->>'event_key')
        RETURNING id::text INTO message_id_value;
      INSERT INTO public.wa_conversations AS existing(phone,name,last_message,unread,updated_at)
        VALUES(phone_value,left(name_value,100),left(text_value,80),1,receipt.created_at)
        ON CONFLICT(phone) DO UPDATE SET unread=coalesce(existing.unread,0)+1,
          name=CASE WHEN excluded.updated_at>=coalesce(existing.updated_at,'-infinity'::timestamptz) THEN excluded.name ELSE existing.name END,
          last_message=CASE WHEN excluded.updated_at>=coalesce(existing.updated_at,'-infinity'::timestamptz) THEN excluded.last_message ELSE existing.last_message END,
          updated_at=greatest(existing.updated_at,excluded.updated_at);
      SELECT EXISTS(SELECT 1 FROM public.user_profiles WHERE regexp_replace(phone,'[^0-9]','','g') IN
        (phone_value,CASE WHEN phone_value LIKE '62%' THEN '0'||substr(phone_value,3) END,CASE WHEN phone_value LIKE '62%' THEN substr(phone_value,3) END)) INTO internal_sender;
      SELECT coalesce((SELECT value<>'false' FROM public.app_settings WHERE key='wa_payment_detect'),true) INTO detect_enabled;
      IF review_reason IS NULL AND detect_enabled AND NOT internal_sender AND coalesce((p_event->>'capture_media')::boolean,false)
        AND p_event->>'type' IN ('image','document') AND media_url IS NOT NULL THEN
        INSERT INTO public.wa_payment_media_jobs(source_url,phone,sender_name,status,next_retry_at,wa_message_id)
          VALUES(media_url,phone_value,left(name_value,100),'RECEIVED',now()+interval '2 minutes',message_id_value)
          ON CONFLICT(source_url) DO NOTHING RETURNING * INTO media;
        IF NOT FOUND THEN SELECT * INTO media FROM public.wa_payment_media_jobs WHERE source_url=media_url; END IF;
        final_status:='MEDIA_QUEUED';
      END IF;
    END IF;
    IF review_reason IS NOT NULL THEN final_status:='REVIEW'; END IF;
  END IF;
  UPDATE public.wa_webhook_raw SET intake_status=final_status,intake_error=review_reason,message_id=message_id_value WHERE id=receipt.id;
  RETURN jsonb_build_object('duplicate',false,'receipt_id',receipt.id::text,'received_at',receipt.created_at,'message_id',message_id_value,
    'intake_status',final_status,'sender_is_internal',internal_sender,'payment_detect_enabled',detect_enabled,
    'media_job',CASE WHEN media.id IS NOT NULL THEN to_jsonb(media) ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.capture_wa_webhook_214(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.capture_wa_webhook_214(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_wa_ingress_health_214() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object('last_received_at',(SELECT max(created_at) FROM public.wa_webhook_raw),
    'review_count',(SELECT count(*) FROM public.wa_webhook_raw WHERE intake_status='REVIEW'),
    'recent_received',(SELECT count(*) FROM public.wa_webhook_raw WHERE created_at>now()-interval '24 hours'),
    'incidents',coalesce((SELECT jsonb_agg(x) FROM (SELECT id::text,sender,msg_type,intake_error,created_at FROM public.wa_webhook_raw
      WHERE intake_status='REVIEW' ORDER BY created_at DESC LIMIT 20) x),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.get_wa_ingress_health_214() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_wa_ingress_health_214() TO service_role;
COMMIT;
