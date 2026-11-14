-- Keep old, unreviewed payment evidence out of the active inbox without
-- deleting suggestions or R2 objects. Archive copies are verified by the
-- operator before this service-only RPC commits a row.
BEGIN;

ALTER TABLE public.payment_suggestions
  DROP CONSTRAINT IF EXISTS payment_suggestions_status_check;
ALTER TABLE public.payment_suggestions
  ADD CONSTRAINT payment_suggestions_status_check
  CHECK (status IN ('PENDING','CONFIRMED','DISMISSED','ARCHIVED'));
ALTER TABLE public.payment_suggestions
  ADD COLUMN restored_from_archive_at timestamptz;

CREATE FUNCTION public.guard_payment_suggestion_archive_244()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (OLD.status = 'ARCHIVED' OR NEW.status = 'ARCHIVED')
     AND current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    RAISE EXCEPTION 'Archive transitions require the controlled archive or restore function'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_payment_suggestion_archive_244()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_payment_suggestion_archive_244
  BEFORE UPDATE OF status, validation_status, image_url
  ON public.payment_suggestions FOR EACH ROW
  EXECUTE FUNCTION public.guard_payment_suggestion_archive_244();

CREATE TABLE public.payment_suggestion_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  suggestion_id uuid REFERENCES public.payment_suggestions(id) ON DELETE SET NULL,
  original_image_url text NOT NULL,
  archive_r2_key text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  archived_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  restored_by uuid
);
CREATE UNIQUE INDEX payment_suggestion_archives_active_idx
  ON public.payment_suggestion_archives(suggestion_id) WHERE restored_at IS NULL;
CREATE INDEX payment_suggestion_archives_recent_idx
  ON public.payment_suggestion_archives(archived_at DESC);

ALTER TABLE public.payment_suggestion_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_suggestion_archives FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_suggestion_archives TO authenticated;
GRANT ALL ON public.payment_suggestion_archives TO service_role;
CREATE POLICY payment_suggestion_archives_owner_read
  ON public.payment_suggestion_archives FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL
    AND (SELECT public.get_my_role()) IN ('Owner','Admin'));

CREATE FUNCTION public.archive_payment_suggestion_244(
  p_batch_id uuid, p_suggestion_id uuid, p_archive_r2_key text,
  p_sha256 text, p_size_bytes bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE proof public.payment_suggestions%ROWTYPE;
BEGIN
  IF p_batch_id IS NULL OR p_suggestion_id IS NULL OR
     p_archive_r2_key !~ '^payment-archive/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|pdf)$' OR
     p_sha256 !~ '^[0-9a-f]{64}$' OR p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'Invalid archive manifest';
  END IF;
  SELECT * INTO proof FROM public.payment_suggestions
    WHERE id = p_suggestion_id FOR UPDATE;
  IF NOT FOUND OR proof.status <> 'PENDING' OR
     proof.validation_status IS DISTINCT FROM 'PENDING' OR
     proof.image_url IS NULL THEN
    RAISE EXCEPTION 'Suggestion is no longer pending with an image';
  END IF;
  INSERT INTO public.payment_suggestion_archives
    (batch_id, suggestion_id, original_image_url, archive_r2_key, sha256, size_bytes)
  VALUES (p_batch_id, p_suggestion_id, proof.image_url,
    p_archive_r2_key, p_sha256, p_size_bytes);
  UPDATE public.payment_suggestions
    SET status = 'ARCHIVED', validation_status = 'ARCHIVED'
    WHERE id = p_suggestion_id;
  RETURN jsonb_build_object('suggestion_id', p_suggestion_id, 'archived', true);
END $$;
REVOKE ALL ON FUNCTION public.archive_payment_suggestion_244(uuid,uuid,text,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_payment_suggestion_244(uuid,uuid,text,text,bigint)
  TO service_role;

CREATE FUNCTION public.restore_payment_suggestion_244(p_archive_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE archived public.payment_suggestion_archives%ROWTYPE;
DECLARE proof public.payment_suggestions%ROWTYPE;
DECLARE restored_url text;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR
     (SELECT public.get_my_role()) NOT IN ('Owner','Admin') THEN
    RAISE EXCEPTION 'Owner or Admin required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO archived FROM public.payment_suggestion_archives
    WHERE id = p_archive_id FOR UPDATE;
  IF NOT FOUND OR archived.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'Active archive not found';
  END IF;
  SELECT * INTO proof FROM public.payment_suggestions
    WHERE id = archived.suggestion_id FOR UPDATE;
  IF NOT FOUND OR proof.status <> 'ARCHIVED' OR
     proof.validation_status IS DISTINCT FROM 'ARCHIVED' THEN
    RAISE EXCEPTION 'Archived suggestion changed; refresh before restoring';
  END IF;
  restored_url := '/api/foto?key=' || replace(archived.archive_r2_key, '/', '%2F');
  UPDATE public.payment_suggestions
    SET status = 'PENDING', validation_status = 'PENDING', image_url = restored_url,
        restored_from_archive_at = now()
    WHERE id = proof.id;
  UPDATE public.payment_suggestion_archives
    SET restored_at = now(), restored_by = auth.uid()
    WHERE id = archived.id;
  RETURN jsonb_build_object('suggestion_id', proof.id, 'restored', true);
END $$;
REVOKE ALL ON FUNCTION public.restore_payment_suggestion_244(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_payment_suggestion_244(uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
