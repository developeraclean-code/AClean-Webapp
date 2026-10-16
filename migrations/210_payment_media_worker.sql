-- Lease-safe 24h payment retry. No historical invoice/payment or queue updates.
BEGIN;
ALTER TABLE public.wa_payment_media_jobs
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_wa_payment_media(p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE candidate public.wa_payment_media_jobs; exhausted boolean;
BEGIN
  IF p_lease_token IS NULL THEN RAISE EXCEPTION 'Lease token required'; END IF;
  SELECT * INTO candidate FROM public.wa_payment_media_jobs j
  WHERE j.created_at < now()-interval '2 minutes' AND (
    (j.status IN ('RECEIVED','STORED','FAILED_RETRYABLE') AND j.attempts<3 AND j.next_retry_at<=now()) OR
    (j.status IN ('RECEIVED','STORED','FAILED_RETRYABLE') AND j.attempts>=3
      AND coalesce(j.lease_expires_at,j.updated_at+interval '5 minutes')<=now()) OR
    (j.status='PROCESSING' AND coalesce(j.lease_expires_at,j.updated_at+interval '5 minutes')<=now())
  ) ORDER BY (j.r2_key IS NOT NULL),j.created_at,j.id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  exhausted := candidate.attempts>=3;
  UPDATE public.wa_payment_media_jobs SET status='PROCESSING',
    attempts=least(candidate.attempts+1,3),lease_token=p_lease_token,
    lease_expires_at=now()+interval '5 minutes',updated_at=now()
    WHERE id=candidate.id RETURNING * INTO candidate;
  RETURN to_jsonb(candidate)||jsonb_build_object('retry_exhausted',exhausted);
END $$;
REVOKE ALL ON FUNCTION public.claim_wa_payment_media(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wa_payment_media(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_payment_ingestion_health()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
   'generated_at',now(),
   'enabled',coalesce((SELECT value<>'false' FROM public.app_settings WHERE key='wa_payment_detect'),true),
   'last_worker_at',(SELECT max(started_at) FROM public.cron_runs WHERE task_name='payment-media-retry' AND status IN ('SUCCESS','SKIPPED')),
   'waiting',(SELECT count(*) FROM public.wa_payment_media_jobs WHERE status IN ('RECEIVED','STORED','FAILED_RETRYABLE','PROCESSING')),
   'overdue',(SELECT count(*) FROM public.wa_payment_media_jobs WHERE status IN ('RECEIVED','STORED','FAILED_RETRYABLE','PROCESSING') AND created_at<now()-interval '30 minutes'),
   'unsecured',(SELECT count(*) FROM public.wa_payment_media_jobs WHERE status IN ('RECEIVED','STORED','FAILED_RETRYABLE','PROCESSING') AND r2_key IS NULL),
   'failed',(SELECT count(*) FROM public.wa_payment_media_jobs WHERE status='FAILED_PERMANENT'),
   'recent_failed',(SELECT count(*) FROM public.wa_payment_media_jobs WHERE status='FAILED_PERMANENT' AND updated_at>now()-interval '24 hours'),
   'review',(SELECT count(*) FROM public.payment_suggestions WHERE status='PENDING' AND validation_status='PENDING'),
   'incidents',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
     SELECT j.id,j.phone,j.sender_name,j.status,j.category,j.attempts,j.last_error,j.r2_url,j.created_at,j.next_retry_at,
       EXISTS(SELECT 1 FROM public.payment_suggestions s WHERE s.media_job_id=j.id AND s.status='PENDING') AS has_suggestion
     FROM public.wa_payment_media_jobs j
     WHERE j.status IN ('RECEIVED','STORED','FAILED_RETRYABLE','FAILED_PERMANENT','PROCESSING')
       OR (j.status='PENDING_REVIEW' AND EXISTS(SELECT 1 FROM public.payment_suggestions s WHERE s.media_job_id=j.id AND s.status='PENDING'))
     ORDER BY (j.status='FAILED_PERMANENT') DESC,j.created_at DESC,j.id LIMIT 50
   ) x),'[]'::jsonb)
 )
$$;
REVOKE ALL ON FUNCTION public.get_payment_ingestion_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_ingestion_health() TO service_role;

-- Provisioning is explicit and separate from migration/deployment. Credentials
-- live in Vault, never in cron.job.command, GitHub files or the frontend bundle.
CREATE OR REPLACE FUNCTION public.dispatch_payment_media_retry()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE secret text; request_id bigint;
BEGIN
  IF (SELECT value FROM public.app_settings WHERE key='wa_payment_detect')='false' THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='aclean_payment_worker_secret' LIMIT 1;
  IF secret IS NULL OR length(secret)<32 THEN RAISE EXCEPTION 'Payment worker secret is not configured in Vault'; END IF;
  SELECT net.http_post(
    url:='https://a-clean-webapp.vercel.app/api/cron-reminder?task=payment-media-retry',
    headers:=jsonb_build_object('Content-Type','application/json','X-Internal-Token',secret),
    body:='{}'::jsonb,timeout_milliseconds:=55000
  ) INTO request_id;
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_payment_media_retry() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_payment_media_retry() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
