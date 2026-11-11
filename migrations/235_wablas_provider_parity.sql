-- Migration 235: extend the selected WhatsApp provider contract to WABLAS.
-- Keep the existing outbox, ingress, and media RPCs; only widen their provider
-- allowlists and retain WABLAS as the source for media retries.
BEGIN;

ALTER TABLE public.wa_outbox
  DROP CONSTRAINT IF EXISTS wa_outbox_provider_check;
ALTER TABLE public.wa_outbox
  ADD CONSTRAINT wa_outbox_provider_check
  CHECK (provider IS NULL OR provider IN ('fonnte', 'whacenter', 'wablas'));

CREATE OR REPLACE FUNCTION public.finish_wa_send(
  p_id uuid,
  p_status text,
  p_error text,
  p_provider_id text,
  p_provider text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  item public.wa_outbox%ROWTYPE;
  saved_message_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server only' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('ACCEPTED', 'FAILED', 'UNCERTAIN') THEN
    RAISE EXCEPTION 'Invalid send status';
  END IF;
  IF p_provider IS NOT NULL AND p_provider NOT IN ('fonnte', 'whacenter', 'wablas') THEN
    RAISE EXCEPTION 'Invalid WhatsApp provider';
  END IF;
  IF p_status = 'ACCEPTED' AND p_provider IS NULL THEN
    RAISE EXCEPTION 'Provider wajib untuk pengiriman yang diterima';
  END IF;

  SELECT * INTO item FROM public.wa_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pengiriman tidak ditemukan'; END IF;
  IF item.status <> 'SENDING' THEN RETURN to_jsonb(item); END IF;

  IF p_status = 'ACCEPTED' THEN
    INSERT INTO public.wa_messages(phone, name, content, role, image_url, created_at)
    VALUES (
      item.phone,
      item.actor,
      item.message || CASE
        WHEN item.attachment_url IS NULL OR item.kind = 'CATALOG' THEN ''
        ELSE E'\n📄 ' || item.attachment_url
      END,
      'admin',
      CASE WHEN item.kind = 'CATALOG' THEN item.attachment_url ELSE NULL END,
      now()
    )
    RETURNING id INTO saved_message_id;

    UPDATE public.wa_conversations
    SET last_reply = left(item.message, 80), updated_at = now()
    WHERE phone = item.phone;

    IF item.kind = 'INVOICE' THEN
      PERFORM public.record_invoice_wa_sent(ARRAY[item.document_id], 'single', NULL, item.actor, p_provider);
    END IF;
    IF item.kind = 'REPORT' THEN
      PERFORM public.record_report_card_wa_sent(item.document_id, 'single', item.actor, p_provider);
    END IF;
    IF item.kind = 'SERVICE_REMINDER' THEN
      UPDATE public.customers
      SET last_rating_request = (now() AT TIME ZONE 'Asia/Jakarta')::date
      WHERE id::text = item.customer_id;
    END IF;
  END IF;

  UPDATE public.wa_outbox
  SET status = p_status,
      error = p_error,
      provider = p_provider,
      provider_id = p_provider_id,
      message_id = saved_message_id,
      finished_at = now()
  WHERE id = p_id
  RETURNING * INTO item;
  RETURN to_jsonb(item);
END
$$;

REVOKE ALL ON FUNCTION public.finish_wa_send(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_wa_send(uuid, text, text, text, text) TO service_role;

-- Preserve the legacy four-argument Fonnte caller during rolling deployments.
CREATE OR REPLACE FUNCTION public.finish_wa_send(
  p_id uuid,
  p_status text,
  p_error text DEFAULT NULL,
  p_provider_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT public.finish_wa_send(p_id, p_status, p_error, p_provider_id, 'fonnte');
$$;

REVOKE ALL ON FUNCTION public.finish_wa_send(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_wa_send(uuid, text, text, text) TO service_role;

ALTER TABLE public.wa_payment_media_jobs
  DROP CONSTRAINT IF EXISTS wa_payment_media_provider_check;
ALTER TABLE public.wa_payment_media_jobs
  ADD CONSTRAINT wa_payment_media_provider_check
  CHECK (provider IN ('fonnte', 'whacenter', 'wablas'));

CREATE OR REPLACE FUNCTION public.wa_media_url_allowed_233(p_url text, p_provider text, p_extra_hosts text[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE media_host text; extra_host text;
BEGIN
  IF p_url IS NULL OR length(p_url) > 4096 OR p_url ~ '[[:cntrl:][:space:]]'
    OR position(chr(92) IN p_url) > 0 THEN RETURN false; END IF;
  media_host := substring(p_url FROM '^https://([^/:?#@]+)/');
  IF media_host IS NULL OR media_host !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$' THEN RETURN false; END IF;
  IF p_provider = 'fonnte' THEN RETURN media_host ~ '(^|\.)fonnte\.com$'; END IF;
  IF p_provider = 'whacenter' THEN
    IF media_host ~ '(^|\.)whacenter\.com$' THEN RETURN true; END IF;
  ELSIF p_provider = 'wablas' THEN
    IF media_host ~ '(^|\.)wablas\.com$' THEN RETURN true; END IF;
  ELSE
    RETURN false;
  END IF;
  IF coalesce(cardinality(p_extra_hosts), 0) > 32 THEN RETURN false; END IF;
  FOREACH extra_host IN ARRAY coalesce(p_extra_hosts, ARRAY[]::text[]) LOOP
    extra_host := lower(btrim(extra_host));
    IF extra_host ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'
      AND media_host = extra_host THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.wa_media_url_allowed_233(text, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_media_url_allowed_233(text, text, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.capture_wa_webhook_214(p_event jsonb, p_media_hosts text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE receipt public.wa_webhook_raw%ROWTYPE; media public.wa_payment_media_jobs%ROWTYPE;
  message_id_value text; phone_value text := p_event->>'phone'; name_value text := p_event->>'name';
  text_value text := p_event->>'message'; media_url text := p_event->>'media_url';
  is_group boolean := coalesce((p_event->>'is_group')::boolean, false);
  internal_sender boolean := false; detect_enabled boolean := true; review_reason text := p_event->>'review_reason';
  final_status text := 'RECORDED';
  provider_value text := coalesce(nullif(p_event->'payload'->>'provider', ''), 'fonnte');
BEGIN
  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object' OR coalesce(p_event->>'event_key', '') !~ '^wa_[0-9a-f]{64}$'
    OR octet_length(p_event::text) > 65536 THEN RAISE EXCEPTION 'Data webhook tidak valid'; END IF;
  IF phone_value IS NOT NULL AND phone_value !~ '^[0-9]{8,15}$' THEN RAISE EXCEPTION 'Nomor webhook tidak valid'; END IF;
  IF provider_value NOT IN ('fonnte', 'whacenter', 'wablas') THEN RAISE EXCEPTION 'Provider webhook tidak valid'; END IF;
  IF media_url IS NOT NULL AND NOT public.wa_media_url_allowed_233(media_url, provider_value, p_media_hosts) THEN
    RAISE EXCEPTION 'URL media tidak aman';
  END IF;
  IF NOT is_group AND phone_value IS NULL THEN review_reason := coalesce(review_reason, 'Identitas pengirim belum dapat dipastikan'); END IF;
  IF NOT is_group AND nullif(text_value, '') IS NULL THEN review_reason := coalesce(review_reason, 'Pesan kosong; periksa manual'); END IF;
  IF length(coalesce(text_value, '')) > 4096 THEN RAISE EXCEPTION 'Pesan webhook terlalu panjang'; END IF;
  INSERT INTO public.wa_webhook_raw(event_key, payload, sender, member, msg_type, has_member, has_message, intake_status, intake_error)
    VALUES(p_event->>'event_key', coalesce(p_event->'payload', '{}'::jsonb), left(p_event->>'sender', 100), left(p_event->>'member', 100),
      left(p_event->>'type', 40), is_group, nullif(text_value, '') IS NOT NULL, 'RECEIVED', review_reason)
    ON CONFLICT(event_key) DO NOTHING RETURNING * INTO receipt;
  IF NOT FOUND THEN
    SELECT * INTO receipt FROM public.wa_webhook_raw WHERE event_key = p_event->>'event_key';
    RETURN jsonb_build_object('duplicate', true, 'receipt_id', receipt.id::text, 'received_at', receipt.created_at,
      'message_id', receipt.message_id, 'intake_status', receipt.intake_status);
  END IF;
  IF is_group THEN final_status := 'GROUP_RECEIVED';
  ELSE
    IF phone_value IS NOT NULL AND nullif(text_value, '') IS NOT NULL THEN
      INSERT INTO public.wa_messages(phone, name, content, role, created_at, webhook_event_key)
        VALUES(phone_value, left(name_value, 100), text_value, 'customer', receipt.created_at, p_event->>'event_key')
        RETURNING id::text INTO message_id_value;
      INSERT INTO public.wa_conversations AS existing(phone, name, last_message, unread, updated_at)
        VALUES(phone_value, left(name_value, 100), left(text_value, 80), 1, receipt.created_at)
        ON CONFLICT(phone) DO UPDATE SET unread = coalesce(existing.unread, 0) + 1,
          name = CASE WHEN excluded.updated_at >= coalesce(existing.updated_at, '-infinity'::timestamptz) THEN excluded.name ELSE existing.name END,
          last_message = CASE WHEN excluded.updated_at >= coalesce(existing.updated_at, '-infinity'::timestamptz) THEN excluded.last_message ELSE existing.last_message END,
          updated_at = greatest(existing.updated_at, excluded.updated_at);
      SELECT EXISTS(SELECT 1 FROM public.user_profiles WHERE regexp_replace(phone, '[^0-9]', '', 'g') IN
        (phone_value, CASE WHEN phone_value LIKE '62%' THEN '0'||substr(phone_value, 3) END, CASE WHEN phone_value LIKE '62%' THEN substr(phone_value, 3) END)) INTO internal_sender;
      SELECT coalesce((SELECT value <> 'false' FROM public.app_settings WHERE key = 'wa_payment_detect'), true) INTO detect_enabled;
      IF review_reason IS NULL AND detect_enabled AND NOT internal_sender AND coalesce((p_event->>'capture_media')::boolean, false)
        AND p_event->>'type' IN ('image', 'document') AND media_url IS NOT NULL THEN
        INSERT INTO public.wa_payment_media_jobs(source_url, phone, sender_name, status, next_retry_at, wa_message_id, provider)
          VALUES(media_url, phone_value, left(name_value, 100), 'RECEIVED', now() + interval '2 minutes', message_id_value, provider_value)
          ON CONFLICT(source_url) DO NOTHING RETURNING * INTO media;
        IF NOT FOUND THEN SELECT * INTO media FROM public.wa_payment_media_jobs WHERE source_url = media_url; END IF;
        final_status := 'MEDIA_QUEUED';
      END IF;
    END IF;
    IF review_reason IS NOT NULL THEN final_status := 'REVIEW'; END IF;
  END IF;
  UPDATE public.wa_webhook_raw SET intake_status = final_status, intake_error = review_reason, message_id = message_id_value WHERE id = receipt.id;
  RETURN jsonb_build_object('duplicate', false, 'receipt_id', receipt.id::text, 'received_at', receipt.created_at, 'message_id', message_id_value,
    'intake_status', final_status, 'sender_is_internal', internal_sender, 'payment_detect_enabled', detect_enabled,
    'media_job', CASE WHEN media.id IS NOT NULL THEN to_jsonb(media) ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.capture_wa_webhook_214(jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_wa_webhook_214(jsonb, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.capture_wa_webhook_214(p_event jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.capture_wa_webhook_214(p_event, ARRAY[]::text[]);
$$;
REVOKE ALL ON FUNCTION public.capture_wa_webhook_214(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_wa_webhook_214(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
