-- One log-retention policy: business audit actions retained, operational logs 90d.
-- No cleanup is executed by this migration. Legacy pg_cron jobs are replaced.
BEGIN;
CREATE OR REPLACE FUNCTION public.is_business_audit_action(p_action text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
  SELECT coalesce(p_action = ANY(ARRAY[
    'ORDER_CREATED','ORDER_UPDATED','ORDER_DELETED',
    'INVOICE_CREATED','INVOICE_APPROVED','INVOICE_DELETED','INVOICE_EDITED',
    'PAYMENT_CONFIRMED','LAPORAN_VERIFIED','LAPORAN_REVISION',
    'CUSTOMER_ADDED','CUSTOMER_AUTO_ADDED','CUSTOMER_DELETED',
    'TEKNISI_ADDED','TEKNISI_DELETED','COMPLAIN_UPGRADED','DISPATCH_WA_SENT'
  ]), false);
$$;

CREATE OR REPLACE FUNCTION public.cleanup_operational_logs(
  p_apply boolean DEFAULT false,
  p_batch_size integer DEFAULT 2000
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  role_name text;
  safe_batch integer := least(greatest(coalesce(p_batch_size,2000),100),5000);
  preview jsonb;
  deleted jsonb := '{}'::jsonb;
  n integer;
BEGIN
  role_name := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name IS NULL OR role_name NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Akses retensi log ditolak' USING ERRCODE = '42501';
  END IF;
  IF p_apply AND role_name <> 'service_role' THEN
    RAISE EXCEPTION 'Eksekusi retensi hanya boleh dari service role/cron' USING ERRCODE = '42501';
  END IF;

  IF NOT p_apply THEN
    SELECT jsonb_build_object(
      'audit_log_90d', (SELECT count(*) FROM public.audit_log WHERE changed_at < now()-interval '90 days'),
      'agent_logs_90d', (SELECT count(*) FROM public.agent_logs WHERE created_at < now()-interval '90 days' AND NOT public.is_business_audit_action(action)),
      'cron_runs_90d', (SELECT count(*) FROM public.cron_runs WHERE started_at < now()-interval '90 days'),
      'ai_usage_180d', (SELECT count(*) FROM public.ai_usage WHERE created_at < now()-interval '180 days'),
      'wa_webhook_raw_14d', (SELECT count(*) FROM public.wa_webhook_raw WHERE created_at < now()-interval '14 days'),
      'wa_webhook_dedup_30d', (SELECT count(*) FROM public.wa_webhook_dedup WHERE created_at < now()-interval '30 days'),
      'operational_mutations_180d', (SELECT count(*) FROM public.operational_mutations WHERE created_at < now()-interval '180 days')
    ) INTO preview;
    RETURN jsonb_build_object('dry_run',true,'batch_size',safe_batch,'candidates',preview,'deleted',deleted);
  END IF;

  WITH doomed AS (SELECT ctid FROM public.audit_log WHERE changed_at < now()-interval '90 days' LIMIT safe_batch)
  DELETE FROM public.audit_log t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('audit_log',n);

  WITH doomed AS (SELECT ctid FROM public.agent_logs WHERE created_at < now()-interval '90 days' AND NOT public.is_business_audit_action(action) LIMIT safe_batch)
  DELETE FROM public.agent_logs t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('agent_logs',n);

  WITH doomed AS (SELECT ctid FROM public.cron_runs WHERE started_at < now()-interval '90 days' LIMIT safe_batch)
  DELETE FROM public.cron_runs t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('cron_runs',n);

  WITH doomed AS (SELECT ctid FROM public.ai_usage WHERE created_at < now()-interval '180 days' LIMIT safe_batch)
  DELETE FROM public.ai_usage t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('ai_usage',n);

  WITH doomed AS (SELECT ctid FROM public.wa_webhook_raw WHERE created_at < now()-interval '14 days' LIMIT safe_batch)
  DELETE FROM public.wa_webhook_raw t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('wa_webhook_raw',n);

  WITH doomed AS (SELECT ctid FROM public.wa_webhook_dedup WHERE created_at < now()-interval '30 days' LIMIT safe_batch)
  DELETE FROM public.wa_webhook_dedup t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('wa_webhook_dedup',n);

  WITH doomed AS (SELECT ctid FROM public.operational_mutations WHERE created_at < now()-interval '180 days' LIMIT safe_batch)
  DELETE FROM public.operational_mutations t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('operational_mutations',n);

  RETURN jsonb_build_object('dry_run',false,'batch_size',safe_batch,'deleted',deleted);
END $$;

REVOKE ALL ON FUNCTION public.cleanup_operational_logs(boolean,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cleanup_operational_logs(boolean,integer) TO authenticated,service_role;


-- Old entry points cannot resurrect the unfiltered 30-day deletion policy.
CREATE OR REPLACE FUNCTION public.cleanup_old_logs()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  PERFORM public.cleanup_operational_logs(true, 2000);
END $$;
CREATE OR REPLACE FUNCTION public.cleanup_agent_logs_stratified()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT public.cleanup_operational_logs(true, 2000);
$$;
CREATE OR REPLACE FUNCTION public.cleanup_observability_logs(retention_days integer DEFAULT 90)
RETURNS TABLE(table_name text, deleted_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  result := public.cleanup_operational_logs(true, 2000);
  RETURN QUERY SELECT e.key, (e.value::text)::bigint FROM jsonb_each(result->'deleted') e;
END $$;
REVOKE ALL ON FUNCTION public.cleanup_old_logs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_agent_logs_stratified() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_observability_logs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_logs(), public.cleanup_agent_logs_stratified(), public.cleanup_observability_logs(integer) TO service_role;

-- Database-only retention remains independent of GitHub/Vercel availability.
DO $migration$
DECLARE old_job record;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR old_job IN SELECT jobid FROM cron.job WHERE jobname IN ('cleanup-old-logs-daily','aclean-cleanup-agent-logs') LOOP
      PERFORM cron.unschedule(old_job.jobid);
    END LOOP;
    PERFORM cron.schedule('aclean-operational-log-retention', '0 20 * * *',
      $command$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true); SELECT public.cleanup_operational_logs(true, 2000);$command$);
  END IF;
END $migration$;
COMMIT;
