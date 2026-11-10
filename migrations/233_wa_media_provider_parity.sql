-- Migration 233: align durable WhatsApp media intake and retry for both providers.
-- Migration 214 allowed Fonnte URLs only, so WhaCenter photos failed before save.
-- Keep the legacy RPC compatible, restrict extra media hosts to service_role,
-- and retain the originating provider on media jobs across gateway switches.
BEGIN;
ALTER TABLE public.wa_payment_media_jobs
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'fonnte';
ALTER TABLE public.wa_payment_media_jobs DROP CONSTRAINT IF EXISTS wa_payment_media_provider_check;
ALTER TABLE public.wa_payment_media_jobs ADD CONSTRAINT wa_payment_media_provider_check
  CHECK (provider IN ('fonnte','whacenter'));

CREATE OR REPLACE FUNCTION public.wa_media_url_allowed_233(p_url text,p_provider text,p_extra_hosts text[])
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE media_host text; extra_host text;
BEGIN
  IF p_url IS NULL OR length(p_url)>4096 OR p_url ~ '[[:cntrl:][:space:]]'
    OR position(chr(92) IN p_url)>0 THEN RETURN false; END IF;
  -- The application passes canonical HTTPS URLs. No credentials, port, wildcard,
  -- IP literal, query-only authority or lookalike suffix is accepted here.
  media_host:=substring(p_url FROM '^https://([^/:?#@]+)/');
  IF media_host IS NULL OR media_host !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$' THEN RETURN false; END IF;
  IF p_provider='fonnte' THEN RETURN media_host ~ '(^|\.)fonnte\.com$'; END IF;
  IF p_provider IS DISTINCT FROM 'whacenter' THEN RETURN false; END IF;
  IF media_host ~ '(^|\.)whacenter\.com$' THEN RETURN true; END IF;
  IF coalesce(cardinality(p_extra_hosts),0)>32 THEN RETURN false; END IF;
  FOREACH extra_host IN ARRAY coalesce(p_extra_hosts,ARRAY[]::text[]) LOOP
    extra_host:=lower(btrim(extra_host));
    IF extra_host ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'
      AND media_host=extra_host THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.wa_media_url_allowed_233(text,text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_media_url_allowed_233(text,text,text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.capture_wa_webhook_214(p_event jsonb, p_media_hosts text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE receipt public.wa_webhook_raw%ROWTYPE; media public.wa_payment_media_jobs%ROWTYPE;
  message_id_value text; phone_value text:=p_event->>'phone'; name_value text:=p_event->>'name';
  text_value text:=p_event->>'message'; media_url text:=p_event->>'media_url';
  is_group boolean:=coalesce((p_event->>'is_group')::boolean,false);
  internal_sender boolean:=false; detect_enabled boolean:=true; review_reason text:=p_event->>'review_reason';
  final_status text:='RECORDED';
  provider_value text:=coalesce(nullif(p_event->'payload'->>'provider',''),'fonnte');
BEGIN
  IF p_event IS NULL OR jsonb_typeof(p_event)<>'object' OR coalesce(p_event->>'event_key','') !~ '^wa_[0-9a-f]{64}$'
    OR octet_length(p_event::text)>65536 THEN RAISE EXCEPTION 'Data webhook tidak valid'; END IF;
  IF phone_value IS NOT NULL AND phone_value !~ '^[0-9]{8,15}$' THEN RAISE EXCEPTION 'Nomor webhook tidak valid'; END IF;
  IF provider_value NOT IN ('fonnte','whacenter') THEN RAISE EXCEPTION 'Provider webhook tidak valid'; END IF;
  IF media_url IS NOT NULL AND NOT public.wa_media_url_allowed_233(media_url,provider_value,p_media_hosts) THEN
    RAISE EXCEPTION 'URL media tidak aman';
  END IF;
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
        INSERT INTO public.wa_payment_media_jobs(source_url,phone,sender_name,status,next_retry_at,wa_message_id,provider)
          VALUES(media_url,phone_value,left(name_value,100),'RECEIVED',now()+interval '2 minutes',message_id_value,provider_value)
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
REVOKE ALL ON FUNCTION public.capture_wa_webhook_214(jsonb,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.capture_wa_webhook_214(jsonb,text[]) TO service_role;

-- Single-argument callers retain the built-in provider hosts during rolling deploys.
CREATE OR REPLACE FUNCTION public.capture_wa_webhook_214(p_event jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT public.capture_wa_webhook_214(p_event,ARRAY[]::text[]);
$$;
REVOKE ALL ON FUNCTION public.capture_wa_webhook_214(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.capture_wa_webhook_214(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
