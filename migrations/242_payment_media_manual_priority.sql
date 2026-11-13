-- Give verified manual R2 proof uploads a chance to reach AI while
-- WhaCenter download jobs are delayed by provider HTTP 429. Apply after 237.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.requeue_failed_payment_media_237(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Migration 242 requires payment media recovery migration 237';
  END IF;
END $$;

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
  ) ORDER BY (j.provider='manual') DESC,(j.r2_key IS NOT NULL),j.created_at,j.id FOR UPDATE SKIP LOCKED LIMIT 1;
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

NOTIFY pgrst,'reload schema';
COMMIT;
