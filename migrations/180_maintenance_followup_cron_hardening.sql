-- 180 — Follow-up maintenance reminder: default yang eksplisit, cooldown, dan
-- satu sumber kebenaran dengan cron_jobs. Tidak mengubah status/data temuan lama.

BEGIN;

INSERT INTO public.app_settings(key, value)
VALUES
  ('maintenance_followup_alert_enabled', 'true'),
  ('maintenance_followup_repeat_days', '7')
ON CONFLICT (key) DO NOTHING;

-- Query cron: open + umur temuan + cooldown pengiriman.
CREATE INDEX IF NOT EXISTS idx_mfollowup_open_reminder_due
  ON public.maintenance_followups(found_date, wa_alerted_at)
  WHERE status = 'open';

DO $$
DECLARE
  v_jobs jsonb := '[]'::jsonb;
  v_enabled boolean := true;
  v_job jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('aclean:automation_settings'));

  SELECT value = 'true' INTO v_enabled
  FROM public.app_settings
  WHERE key = 'maintenance_followup_alert_enabled';
  v_enabled := coalesce(v_enabled, true);

  BEGIN
    SELECT value::jsonb INTO v_jobs
    FROM public.app_settings
    WHERE key = 'cron_jobs'
    FOR UPDATE;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'cron_jobs tersimpan dalam format tidak valid: %', SQLERRM;
  END;

  v_jobs := coalesce(v_jobs, '[]'::jsonb);
  IF jsonb_typeof(v_jobs) <> 'array' THEN
    RAISE EXCEPTION 'cron_jobs harus berupa JSON array';
  END IF;

  v_job := jsonb_build_object(
    'id', 11,
    'name', 'Follow-up Maintenance',
    'icon', '🔧',
    'time', '10:00',
    'days', 'Setiap Hari',
    'active', v_enabled,
    'backendKey', 'maintenance_followup_alert_enabled',
    'task', 'WA Owner untuk temuan maintenance open >3 hari'
  );

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_jobs) e
    WHERE e->>'backendKey' = 'maintenance_followup_alert_enabled'
  ) THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN e->>'backendKey' = 'maintenance_followup_alert_enabled'
        THEN e || jsonb_build_object('active', v_enabled)
        ELSE e END ORDER BY ord
    ), '[]'::jsonb)
    INTO v_jobs
    FROM jsonb_array_elements(v_jobs) WITH ORDINALITY AS x(e, ord);
  ELSE
    v_jobs := v_jobs || jsonb_build_array(v_job);
  END IF;

  INSERT INTO public.app_settings(key, value)
  VALUES ('cron_jobs', v_jobs::text)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;
END $$;

COMMIT;
