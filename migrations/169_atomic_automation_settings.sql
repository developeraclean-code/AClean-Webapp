-- Simpan feature toggle dan cron_jobs sebagai satu transaksi.
-- Mencegah UI tampil ON sementara backend cron membaca OFF (atau sebaliknya).

CREATE OR REPLACE FUNCTION public.set_automation_setting(
  p_key text,
  p_enabled boolean,
  p_job jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_jobs jsonb := '[]'::jsonb;
  v_job jsonb;
BEGIN
  SELECT role INTO v_role
  FROM public.user_profiles
  WHERE id = auth.uid();

  IF auth.role() <> 'service_role' AND lower(COALESCE(v_role, '')) <> 'owner' THEN
    RAISE EXCEPTION 'Hanya Owner yang dapat mengubah pengaturan otomasi'
      USING ERRCODE = '42501';
  END IF;

  IF p_key IS NULL OR p_key !~ '^[a-z0-9_]+_enabled$' THEN
    RAISE EXCEPTION 'Key otomasi tidak valid'
      USING ERRCODE = '22023';
  END IF;

  IF p_job IS NOT NULL AND jsonb_typeof(p_job) <> 'object' THEN
    RAISE EXCEPTION 'Metadata job harus berupa JSON object'
      USING ERRCODE = '22023';
  END IF;

  -- Serialkan semua perubahan otomasi, termasuk ketika row cron_jobs belum ada.
  PERFORM pg_advisory_xact_lock(hashtext('aclean:automation_settings'));

  BEGIN
    SELECT value::jsonb INTO v_jobs
    FROM public.app_settings
    WHERE key = 'cron_jobs'
    FOR UPDATE;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'cron_jobs tersimpan dalam format tidak valid: %', SQLERRM
      USING ERRCODE = '22023';
  END;

  v_jobs := COALESCE(v_jobs, '[]'::jsonb);
  IF jsonb_typeof(v_jobs) <> 'array' THEN
    RAISE EXCEPTION 'cron_jobs harus berupa JSON array'
      USING ERRCODE = '22023';
  END IF;

  v_job := COALESCE(p_job, '{}'::jsonb)
    || jsonb_build_object('backendKey', p_key, 'active', p_enabled);

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_jobs) elem
    WHERE elem->>'backendKey' = p_key
  ) THEN
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN elem->>'backendKey' = p_key
          THEN elem || jsonb_build_object('active', p_enabled)
        ELSE elem
      END
      ORDER BY ord
    ), '[]'::jsonb)
    INTO v_jobs
    FROM jsonb_array_elements(v_jobs) WITH ORDINALITY AS items(elem, ord);
  ELSE
    v_jobs := v_jobs || jsonb_build_array(v_job);
  END IF;

  INSERT INTO public.app_settings (key, value)
  VALUES (p_key, CASE WHEN p_enabled THEN 'true' ELSE 'false' END)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO public.app_settings (key, value)
  VALUES ('cron_jobs', v_jobs::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  RETURN v_jobs;
END;
$$;

REVOKE ALL ON FUNCTION public.set_automation_setting(text, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_automation_setting(text, boolean, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_automation_setting(text, boolean, jsonb) IS
  'Atomically updates an automation feature key and its canonical cron_jobs entry; Owner/service_role only.';
