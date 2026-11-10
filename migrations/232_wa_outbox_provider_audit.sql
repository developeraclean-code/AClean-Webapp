-- Persist the gateway used by durable workspace sends. The original RPC
-- hard-coded Fonnte even after provider selection was introduced.
BEGIN;

ALTER TABLE public.wa_outbox
  ADD COLUMN IF NOT EXISTS provider text;

UPDATE public.wa_outbox
SET provider = 'fonnte'
WHERE provider IS NULL AND status IN ('ACCEPTED', 'FAILED', 'UNCERTAIN');

ALTER TABLE public.wa_outbox
  DROP CONSTRAINT IF EXISTS wa_outbox_provider_check;
ALTER TABLE public.wa_outbox
  ADD CONSTRAINT wa_outbox_provider_check
  CHECK (provider IS NULL OR provider IN ('fonnte', 'whacenter'));

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
  IF p_provider IS NOT NULL AND p_provider NOT IN ('fonnte', 'whacenter') THEN
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

-- Keep older Fonnte server instances compatible during a rolling deploy.
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

COMMIT;
