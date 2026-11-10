-- Migration 234: link temporary WhatsApp media to its chat before AI review.
-- A successful R2 staging upload previously remained invisible until the file
-- was promoted to payment evidence. Keep existing staging retention and access;
-- only repair attachment references, without creating payment suggestions.
BEGIN;
CREATE OR REPLACE FUNCTION public.link_wa_media_message_214() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous_url text;
BEGIN
  IF TG_OP='UPDATE' THEN previous_url:=OLD.r2_url; END IF;
  IF NEW.wa_message_id IS NOT NULL AND NEW.r2_url ~ '^/api/foto\?key=wa-(staging|inbox)(%2[Ff]|/)' THEN
    UPDATE public.wa_messages SET image_url=NEW.r2_url
    WHERE phone=NEW.phone AND id::text=NEW.wa_message_id AND role='customer'
      AND (image_url IS NULL OR image_url=NEW.source_url OR image_url=NEW.r2_url OR image_url=previous_url);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.link_wa_media_message_214() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS wa_media_message_link_214 ON public.wa_payment_media_jobs;
CREATE TRIGGER wa_media_message_link_214 AFTER INSERT OR UPDATE OF r2_url,wa_message_id ON public.wa_payment_media_jobs
  FOR EACH ROW EXECUTE FUNCTION public.link_wa_media_message_214();

-- Repair only exact phone/message links already recorded by durable intake.
-- Existing independent/manual attachments are kept.
UPDATE public.wa_messages AS message
SET image_url=job.r2_url
FROM public.wa_payment_media_jobs AS job
WHERE job.wa_message_id IS NOT NULL AND message.id::text=job.wa_message_id
  AND message.phone=job.phone AND message.role='customer'
  AND job.r2_url ~ '^/api/foto\?key=wa-(staging|inbox)(%2[Ff]|/)'
  AND (message.image_url IS NULL OR message.image_url=job.source_url);
COMMIT;
