-- Allow bounded Owner/Admin recovery of transient media downloads. Manual
-- recovery gets its own 24-hour retry window even when the original webhook
-- is older than 24 hours. Apply after 242.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.requeue_failed_payment_media_237(uuid)') IS NULL
     OR to_regprocedure('public.claim_wa_payment_media(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Migration 243 requires payment media migrations 237 and 242';
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
      AND (j.created_at>now()-interval '24 hours' OR
        (j.manual_retry_count>0 AND j.manual_retry_requested_at>now()-interval '24 hours'))
      AND j.next_retry_at<=now()) OR
    (j.status IN ('RECEIVED','STORED','FAILED_RETRYABLE') AND j.attempts>=3
      AND NOT (j.status='FAILED_RETRYABLE' AND j.provider='whacenter' AND j.attempts BETWEEN 3 AND 6
        AND j.last_error ~ '\[WA_MEDIA_(HTTP_429|HTTP_5[0-9][0-9]|TIMEOUT|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNREFUSED|ENETUNREACH|FETCH_FAILED)\]'
        AND (j.created_at>now()-interval '24 hours' OR
          (j.manual_retry_count>0 AND j.manual_retry_requested_at>now()-interval '24 hours')))
      AND coalesce(j.lease_expires_at,j.updated_at+interval '5 minutes')<=now()) OR
    (j.status='PROCESSING' AND coalesce(j.lease_expires_at,j.updated_at+interval '5 minutes')<=now())
  ) ORDER BY (j.provider='manual') DESC,(j.r2_key IS NOT NULL),j.created_at,j.id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  transient_failure := candidate.provider='whacenter' AND candidate.last_error ~
    '\[WA_MEDIA_(HTTP_429|HTTP_5[0-9][0-9]|TIMEOUT|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNREFUSED|ENETUNREACH|FETCH_FAILED)\]';
  exhausted := candidate.attempts>=3 AND NOT
    (transient_failure AND candidate.attempts<7 AND
      (candidate.created_at>now()-interval '24 hours' OR
       (candidate.manual_retry_count>0 AND candidate.manual_retry_requested_at>now()-interval '24 hours')));
  UPDATE public.wa_payment_media_jobs SET status='PROCESSING',
    attempts=least(candidate.attempts+1,7),lease_token=p_lease_token,
    lease_expires_at=now()+interval '5 minutes',updated_at=now()
    WHERE id=candidate.id RETURNING * INTO candidate;
  RETURN to_jsonb(candidate)||jsonb_build_object('retry_exhausted',exhausted);
END $$;
REVOKE ALL ON FUNCTION public.claim_wa_payment_media(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wa_payment_media(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.requeue_failed_payment_media_batch_243()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  item public.wa_payment_media_jobs;
  eligible_count integer;
  remaining_count integer;
  queued_count integer := 0;
  last_requested_at timestamptz;
BEGIN
  -- Serialize batch actions across app instances. A second click cannot
  -- enqueue another burst while the first three jobs are still being served.
  PERFORM pg_advisory_xact_lock(243, 237);
  SELECT count(*) INTO eligible_count FROM public.wa_payment_media_jobs j
  WHERE j.status='FAILED_PERMANENT' AND j.r2_key IS NULL
    AND j.provider IN ('fonnte','whacenter','wablas')
    AND j.created_at>now()-interval '7 days' AND j.manual_retry_count<3
    AND j.last_error ~ '\[WA_MEDIA_(HTTP_429|HTTP_5[0-9][0-9]|TIMEOUT|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNREFUSED|ENETUNREACH|FETCH_FAILED)\]'
    AND NOT EXISTS (SELECT 1 FROM public.payment_suggestions s WHERE s.media_job_id=j.id);

  SELECT max(j.manual_retry_requested_at) INTO last_requested_at
  FROM public.wa_payment_media_jobs j
  WHERE j.manual_retry_requested_at>now()-interval '15 minutes';
  IF last_requested_at IS NOT NULL THEN
    RETURN jsonb_build_object('queued',0,'eligible',eligible_count,
      'remaining',eligible_count,'cooldown_until',last_requested_at+interval '15 minutes');
  END IF;

  FOR item IN SELECT j.* FROM public.wa_payment_media_jobs j
    WHERE j.status='FAILED_PERMANENT' AND j.r2_key IS NULL
      AND j.provider IN ('fonnte','whacenter','wablas')
      AND j.created_at>now()-interval '7 days' AND j.manual_retry_count<3
      AND j.last_error ~ '\[WA_MEDIA_(HTTP_429|HTTP_5[0-9][0-9]|TIMEOUT|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNREFUSED|ENETUNREACH|FETCH_FAILED)\]'
      AND NOT EXISTS (SELECT 1 FROM public.payment_suggestions s WHERE s.media_job_id=j.id)
    ORDER BY j.manual_retry_count,j.created_at DESC,j.id
    FOR UPDATE OF j SKIP LOCKED LIMIT 3
  LOOP
    PERFORM public.requeue_failed_payment_media_237(item.id);
    -- Scheduler runs every five minutes. Serve one provider request per tick.
    UPDATE public.wa_payment_media_jobs
      SET next_retry_at=now()+queued_count*interval '5 minutes'
      WHERE id=item.id;
    queued_count := queued_count+1;
  END LOOP;
  remaining_count := greatest(eligible_count-queued_count,0);
  RETURN jsonb_build_object('queued',queued_count,'eligible',eligible_count,
    'remaining',remaining_count,'cooldown_until',
    CASE WHEN queued_count>0 THEN now()+interval '15 minutes' ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.requeue_failed_payment_media_batch_243() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_failed_payment_media_batch_243() TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
