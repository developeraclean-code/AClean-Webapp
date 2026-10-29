BEGIN;

-- Keep dormant database dispatchers safe if pg_cron is ever re-enabled.
-- The production scheduler remains the single VPS timer; this migration only
-- removes the retired Vercel host from worker destinations.
CREATE OR REPLACE FUNCTION public.dispatch_payment_media_retry()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE secret text; request_id bigint;
BEGIN
  IF (SELECT value FROM public.app_settings WHERE key='wa_payment_detect')='false' THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='aclean_payment_worker_secret' LIMIT 1;
  IF secret IS NULL OR length(secret)<32 THEN RAISE EXCEPTION 'Payment worker secret is not configured in Vault'; END IF;
  SELECT net.http_post(
    url:='https://app.aclean.id/api/cron-reminder?task=payment-media-retry',
    headers:=jsonb_build_object('Content-Type','application/json','X-Internal-Token',secret),
    body:='{}'::jsonb,timeout_milliseconds:=55000
  ) INTO request_id;
  RETURN request_id;
END $$;

CREATE OR REPLACE FUNCTION public.dispatch_field_report_reminders_215()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE secret text; request_id bigint; jobs jsonb;
BEGIN
  IF extract(hour FROM now() AT TIME ZONE 'Asia/Jakarta')<20 THEN RETURN NULL; END IF;
  IF coalesce((SELECT value FROM public.app_settings WHERE key='field_report_reminder_enabled'),'false')<>'true' THEN RETURN NULL; END IF;
  SELECT value::jsonb INTO jobs FROM public.app_settings WHERE key='cron_jobs';
  IF jsonb_typeof(jobs) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Konfigurasi cron tidak valid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(jobs) x WHERE x->>'backendKey'='field_report_reminder_enabled' AND x->>'active'='true') THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='aclean_field_report_worker_secret' LIMIT 1;
  IF secret IS NULL OR length(secret)<32 THEN RAISE EXCEPTION 'Kunci worker reminder belum disiapkan'; END IF;
  SELECT net.http_post(url:='https://app.aclean.id/api/cron-reminder?task=field-report-reminder',
    headers:=jsonb_build_object('Content-Type','application/json','X-Internal-Token',secret),body:='{}'::jsonb,timeout_milliseconds:=40000) INTO request_id;
  RETURN request_id;
END $$;

CREATE OR REPLACE FUNCTION public.dispatch_cron_tick_216()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE secret text; request_id bigint;
BEGIN
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='aclean_cron_dispatcher_secret' LIMIT 1;
  IF secret IS NULL OR length(secret)<32 THEN RAISE EXCEPTION 'Dispatcher credential not provisioned'; END IF;
  SELECT net.http_post(url:='https://app.aclean.id/api/cron-reminder?task=tick',
    headers:=jsonb_build_object('Content-Type','application/json','X-Internal-Token',secret),body:='{}'::jsonb,timeout_milliseconds:=55000) INTO request_id;
  RETURN request_id;
END $$;

REVOKE ALL ON FUNCTION public.dispatch_payment_media_retry(),
  public.dispatch_field_report_reminders_215(),public.dispatch_cron_tick_216()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_payment_media_retry(),
  public.dispatch_field_report_reminders_215(),public.dispatch_cron_tick_216()
  TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
