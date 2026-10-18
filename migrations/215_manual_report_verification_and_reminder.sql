-- Migration 215: retire unsafe age-based verification/material return; prepare staff reminders.
-- Historical reports, invoices, payments and stock are untouched. Verification remains
-- a manual Owner/Admin action. The new 20:00 WIB reminder is OFF until release activation.
BEGIN;

DO $$ DECLARE item record; BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR item IN SELECT jobid FROM cron.job WHERE jobname='aclean-auto-verify-laporan-48jam' LOOP
      PERFORM cron.alter_job(item.jobid,active:=false);
    END LOOP;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_manual_report_verification_215()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.status='VERIFIED' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'VERIFIED') THEN
    IF auth.role() IS NOT DISTINCT FROM 'service_role'
       OR coalesce(public.get_my_role(),'') NOT IN ('Owner','Admin')
       OR lower(coalesce(NEW.last_changed_by,'')) IN ('system_auto_verify','auto-verify','auto_verify','system_auto_verify_48h') THEN
      RAISE EXCEPTION 'Verifikasi otomatis dihentikan; gunakan verifikasi manual di Laporan Tim' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_manual_report_verification_215() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_manual_report_verification_215 ON public.service_reports;
CREATE TRIGGER trg_manual_report_verification_215 BEFORE INSERT OR UPDATE ON public.service_reports
FOR EACH ROW EXECUTE FUNCTION public.guard_manual_report_verification_215();

CREATE OR REPLACE FUNCTION public.guard_retired_material_return_215()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.status='RETURNED' AND OLD.status IS DISTINCT FROM 'RETURNED'
     AND NEW.notes='auto-returned (>24h tidak ke-laporan)' THEN
    RAISE EXCEPTION 'Auto-return dihentikan; material dikelola Admin melalui modul' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_retired_material_return_215() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_retired_material_return_215 ON public.job_materials_brought;
CREATE TRIGGER trg_retired_material_return_215 BEFORE UPDATE ON public.job_materials_brought
FOR EACH ROW EXECUTE FUNCTION public.guard_retired_material_return_215();

-- Restore the atomic Owner-only toggle RPC if migration 169 was recorded without it.
CREATE OR REPLACE FUNCTION public.set_automation_setting(p_key text,p_enabled boolean,p_job jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE jobs jsonb; item jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND coalesce(public.get_my_role(),'')<>'Owner' THEN
    RAISE EXCEPTION 'Hanya Owner yang dapat mengubah pengaturan otomasi' USING ERRCODE='42501';
  END IF;
  IF p_key IS NULL OR p_key !~ '^[a-z0-9_]+_enabled$' OR p_enabled IS NULL
    OR jsonb_typeof(coalesce(p_job,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Pengaturan otomasi tidak valid'; END IF;
  IF p_enabled AND p_key IN ('auto_return_brought_enabled','auto_verify_reports_enabled') THEN
    RAISE EXCEPTION 'Otomasi lama sudah dihentikan; gunakan modul manual';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('aclean:automation_settings'));
  SELECT value::jsonb INTO jobs FROM public.app_settings WHERE key='cron_jobs' FOR UPDATE;
  jobs:=coalesce(jobs,'[]'::jsonb);
  IF jsonb_typeof(jobs)<>'array' THEN RAISE EXCEPTION 'cron_jobs harus berupa JSON array'; END IF;
  item:=coalesce(p_job,'{}'::jsonb)||jsonb_build_object('backendKey',p_key,'active',p_enabled);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(jobs) x WHERE x->>'backendKey'=p_key) THEN
    SELECT jsonb_agg(CASE WHEN x->>'backendKey'=p_key THEN x||item ELSE x END ORDER BY n) INTO jobs
      FROM jsonb_array_elements(jobs) WITH ORDINALITY a(x,n);
  ELSE jobs:=jobs||jsonb_build_array(item); END IF;
  INSERT INTO public.app_settings(key,value) VALUES(p_key,CASE WHEN p_enabled THEN 'true' ELSE 'false' END)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value;
  INSERT INTO public.app_settings(key,value) VALUES('cron_jobs',jobs::text)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value;
  RETURN jobs;
END $$;
REVOKE ALL ON FUNCTION public.set_automation_setting(text,boolean,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_automation_setting(text,boolean,jsonb) TO authenticated,service_role;

INSERT INTO public.app_settings(key,value) VALUES('auto_return_brought_enabled','false'),('auto_verify_reports_enabled','false')
  ON CONFLICT(key) DO UPDATE SET value=excluded.value;
INSERT INTO public.app_settings(key,value) VALUES('field_report_reminder_enabled','false') ON CONFLICT(key) DO NOTHING;
DO $$ DECLARE jobs jsonb; enabled boolean; BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('aclean:automation_settings'));
  SELECT value::jsonb INTO jobs FROM public.app_settings WHERE key='cron_jobs' FOR UPDATE;
  jobs:=coalesce(jobs,'[]'::jsonb);
  IF jsonb_typeof(jobs)<>'array' THEN RAISE EXCEPTION 'cron_jobs harus berupa JSON array'; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY n),'[]'::jsonb) INTO jobs FROM jsonb_array_elements(jobs) WITH ORDINALITY a(x,n)
    WHERE coalesce(x->>'backendKey','') NOT IN ('auto_return_brought_enabled','auto_verify_reports_enabled')
      AND coalesce(x->>'task','') NOT IN ('auto-return-brought','auto-verify-laporan','auto-verify-laporan-48jam');
  enabled:=coalesce((SELECT value='true' FROM public.app_settings WHERE key='field_report_reminder_enabled'),false);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(jobs) x WHERE x->>'backendKey'='field_report_reminder_enabled') THEN
    jobs:=jobs||jsonb_build_array(jsonb_build_object('id',215001,'name','Pengingat Laporan Tim','icon','📝',
      'time','20:00–23:59','days','Setiap Hari','backendKey','field_report_reminder_enabled','active',enabled,
      'task','Satu WA per nomor teknisi/helper per hari untuk laporan hari ini yang belum diterima'));
  END IF;
  INSERT INTO public.app_settings(key,value) VALUES('cron_jobs',jobs::text) ON CONFLICT(key) DO UPDATE SET value=excluded.value;
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
  SELECT net.http_post(url:='https://a-clean-webapp.vercel.app/api/cron-reminder?task=field-report-reminder',
    headers:=jsonb_build_object('Content-Type','application/json','X-Internal-Token',secret),body:='{}'::jsonb,timeout_milliseconds:=40000) INTO request_id;
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_field_report_reminders_215() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_field_report_reminders_215() TO service_role;

-- After code deployment: provision the dedicated secret in Vault and schedule
-- SELECT cron.schedule('aclean-field-report-reminder-5m','*/5 13-16 * * *',
--   'SELECT public.dispatch_field_report_reminders_215();');
-- Then Owner explicitly enables BOTH gates via set_automation_setting.
NOTIFY pgrst,'reload schema';
COMMIT;
