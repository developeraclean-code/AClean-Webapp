-- Keep transient WhaCenter download failures retryable and provide a bounded,
-- service-only way to requeue an existing failed job. Apply after 235.
BEGIN;

ALTER TABLE public.wa_payment_media_jobs
  ADD COLUMN IF NOT EXISTS manual_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_retry_requested_at timestamptz;

ALTER TABLE public.wa_payment_media_jobs
  DROP CONSTRAINT IF EXISTS wa_payment_media_provider_check;
ALTER TABLE public.wa_payment_media_jobs
  ADD CONSTRAINT wa_payment_media_provider_check
  CHECK (provider IN ('fonnte', 'whacenter', 'wablas', 'manual'));

CREATE OR REPLACE FUNCTION public.claim_wa_payment_media(p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidate public.wa_payment_media_jobs; exhausted boolean; transient_failure boolean;
BEGIN
  IF p_lease_token IS NULL THEN RAISE EXCEPTION 'Lease token required'; END IF;
  SELECT * INTO candidate FROM public.wa_payment_media_jobs j
  WHERE j.created_at < now()-interval '2 minutes' AND (
    (j.status IN ('RECEIVED','STORED','FAILED_RETRYABLE') AND j.attempts<3 AND j.next_retry_at<=now()) OR
    (j.status='FAILED_RETRYABLE' AND j.provider='whacenter' AND j.attempts BETWEEN 3 AND 6
      AND j.last_error ~ '\[WA_MEDIA_(HTTP_429|HTTP_5[0-9][0-9]|TIMEOUT|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNREFUSED|ENETUNREACH|FETCH_FAILED)\]'
      AND j.next_retry_at<=now()) OR
    (j.status IN ('RECEIVED','STORED','FAILED_RETRYABLE') AND j.attempts>=3
      AND NOT (j.status='FAILED_RETRYABLE' AND j.provider='whacenter' AND j.attempts BETWEEN 3 AND 6
        AND j.last_error ~ '\[WA_MEDIA_(HTTP_429|HTTP_5[0-9][0-9]|TIMEOUT|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNREFUSED|ENETUNREACH|FETCH_FAILED)\]')
      AND coalesce(j.lease_expires_at,j.updated_at+interval '5 minutes')<=now()) OR
    (j.status='PROCESSING' AND coalesce(j.lease_expires_at,j.updated_at+interval '5 minutes')<=now())
  ) ORDER BY (j.r2_key IS NOT NULL),j.created_at,j.id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  transient_failure := candidate.provider='whacenter' AND candidate.last_error ~
    '\[WA_MEDIA_(HTTP_429|HTTP_5[0-9][0-9]|TIMEOUT|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNREFUSED|ENETUNREACH|FETCH_FAILED)\]';
  exhausted := candidate.attempts>=3 AND NOT
    (transient_failure AND candidate.attempts<7 AND candidate.created_at>now()-interval '24 hours');
  UPDATE public.wa_payment_media_jobs SET status='PROCESSING',
    attempts=least(candidate.attempts+1,7),lease_token=p_lease_token,
    lease_expires_at=now()+interval '5 minutes',updated_at=now()
    WHERE id=candidate.id RETURNING * INTO candidate;
  RETURN to_jsonb(candidate)||jsonb_build_object('retry_exhausted',exhausted);
END $$;
REVOKE ALL ON FUNCTION public.claim_wa_payment_media(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wa_payment_media(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.requeue_failed_payment_media_237(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item public.wa_payment_media_jobs;
BEGIN
  IF p_job_id IS NULL THEN RAISE EXCEPTION 'Job ID required'; END IF;
  SELECT * INTO item FROM public.wa_payment_media_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Media job not found' USING ERRCODE='P0002'; END IF;
  IF item.status <> 'FAILED_PERMANENT' THEN
    RETURN jsonb_build_object('queued',false,'status',item.status);
  END IF;
  IF item.manual_retry_count >= 3 OR (item.r2_key IS NULL AND item.created_at<now()-interval '7 days') THEN
    RAISE EXCEPTION 'Manual retry limit or source age reached' USING ERRCODE='22023';
  END IF;
  IF item.r2_key IS NULL AND (item.provider NOT IN ('fonnte','whacenter','wablas') OR
    coalesce(item.last_error,'') !~ '\[WA_MEDIA_(HTTP_429|HTTP_5[0-9][0-9]|TIMEOUT|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNREFUSED|ENETUNREACH|FETCH_FAILED)\]') THEN
    RAISE EXCEPTION 'Use the original file for manual attachment' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_suggestions WHERE media_job_id=item.id) THEN
    RAISE EXCEPTION 'Suggestion already exists; review it instead' USING ERRCODE='22023';
  END IF;
  UPDATE public.wa_payment_media_jobs SET status='FAILED_RETRYABLE',attempts=0,
    next_retry_at=now(),last_error=NULL,lease_token=NULL,lease_expires_at=NULL,
    manual_retry_count=coalesce(manual_retry_count,0)+1,manual_retry_requested_at=now(),updated_at=now()
    WHERE id=item.id;
  RETURN jsonb_build_object('queued',true,'status','FAILED_RETRYABLE');
END $$;
REVOKE ALL ON FUNCTION public.requeue_failed_payment_media_237(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_failed_payment_media_237(uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
