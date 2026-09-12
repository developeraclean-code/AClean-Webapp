-- 166 — Efisiensi free tier: aktifkan cleanup expense + alarm DB/R2.
-- Local-first: jalankan di Supabase hanya setelah trial disetujui.

BEGIN;

INSERT INTO public.app_settings (key, value)
VALUES
  ('expense_foto_cleanup_enabled', 'true'),
  ('infra_usage_alert_enabled', 'true'),
  ('infra_usage_warn_percent', '70'),
  ('infra_usage_critical_percent', '85')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Sinkronkan dua task baru/yang diwajibkan ke JSON pusat cron_jobs bila tersedia.
DO $$
DECLARE
  jobs jsonb;
  cfg record;
BEGIN
  SELECT value::jsonb INTO jobs FROM public.app_settings WHERE key = 'cron_jobs';
  IF jobs IS NULL THEN jobs := '[]'::jsonb; END IF;
  IF jsonb_typeof(jobs) <> 'array' THEN RETURN; END IF;
  FOR cfg IN SELECT * FROM (VALUES
    ('expense_foto_cleanup_enabled', 'Cleanup Foto Expense', '🧾', '03:00'),
    ('infra_usage_alert_enabled', 'Alarm Kuota Infrastruktur', '🚨', '07:00')
  ) AS x(backend_key, job_name, icon, job_time)
  LOOP
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(jobs) e WHERE e->>'backendKey' = cfg.backend_key) THEN
      SELECT jsonb_agg(CASE WHEN e->>'backendKey' = cfg.backend_key THEN jsonb_set(e, '{active}', 'true'::jsonb) ELSE e END)
      INTO jobs FROM jsonb_array_elements(jobs) e;
    ELSE
      jobs := jobs || jsonb_build_array(jsonb_build_object(
        -- Cast sebelum penjumlahan: hash positif dapat membuat integer overflow.
        'id', 2100000000::bigint + abs(hashtext(cfg.backend_key)::bigint),
        'name', cfg.job_name, 'icon', cfg.icon, 'time', cfg.job_time,
        'days', 'Setiap Hari', 'active', true, 'backendKey', cfg.backend_key,
        'task', cfg.job_name
      ));
    END IF;
  END LOOP;
  INSERT INTO public.app_settings (key, value) VALUES ('cron_jobs', jobs::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron_jobs tidak dapat disinkronkan: %', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.get_infra_database_size()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'bytes', pg_database_size(current_database()),
    'measured_at', now()
  );
$$;

REVOKE ALL ON FUNCTION public.get_infra_database_size() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_infra_database_size() TO service_role;

COMMIT;
