-- Shared manual weekly schedule notes with optimistic concurrency.
-- This migration is local code only until applied through the authorized release path.
BEGIN;

CREATE TABLE public.schedule_note_blocks (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  day_date date NOT NULL,
  group_name text NOT NULL DEFAULT '' CHECK (length(group_name) <= 120),
  content text NOT NULL DEFAULT '' CHECK (length(content) <= 30000),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000),
  is_deleted boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT '',
  updated_by_id uuid,
  last_mutation_id uuid,
  last_mutation_hash text,
  CONSTRAINT schedule_note_blocks_day_in_week
    CHECK (day_date >= week_start AND day_date <= week_start + 5)
);

CREATE INDEX schedule_note_blocks_week_order
  ON public.schedule_note_blocks (week_start, day_date, sort_order, id);

ALTER TABLE public.schedule_note_blocks ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.can_access_schedule_note_blocks()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.active IS TRUE
      AND p.role IN ('Owner', 'Admin')
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_schedule_note_blocks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_schedule_note_blocks() TO authenticated;

CREATE POLICY schedule_note_blocks_read
  ON public.schedule_note_blocks FOR SELECT TO authenticated
  USING (public.can_access_schedule_note_blocks());

REVOKE ALL ON public.schedule_note_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.schedule_note_blocks TO authenticated;
GRANT ALL ON public.schedule_note_blocks TO service_role;

CREATE FUNCTION public.save_schedule_note_block(
  p_id text,
  p_week_start date,
  p_day_date date,
  p_group_name text,
  p_content text,
  p_sort_order integer,
  p_expected_version integer,
  p_mutation_id uuid,
  p_is_deleted boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  saved public.schedule_note_blocks%ROWTYPE;
  actor_name text;
  actor_role text;
  actor_active boolean;
  payload_hash text;
  mutation_payload jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Sesi login diperlukan' USING ERRCODE = '42501';
  END IF;

  SELECT p.name, p.role, p.active
    INTO actor_name, actor_role, actor_active
    FROM public.user_profiles p WHERE p.id = (SELECT auth.uid());
  IF NOT FOUND OR actor_active IS DISTINCT FROM TRUE OR actor_role IS NULL OR actor_role NOT IN ('Owner', 'Admin') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin aktif yang dapat mengubah catatan jadwal' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL OR length(p_id) NOT BETWEEN 1 AND 120
     OR p_week_start IS NULL OR extract(isodow FROM p_week_start) <> 1
     OR p_day_date IS NULL OR p_day_date < p_week_start OR p_day_date > p_week_start + 5
     OR p_group_name IS NULL OR length(p_group_name) > 120
     OR p_content IS NULL OR length(p_content) > 30000
     OR p_sort_order IS NULL OR p_sort_order NOT BETWEEN 0 AND 1000
     OR p_expected_version IS NULL OR p_expected_version < 0
     OR p_mutation_id IS NULL THEN
    RAISE EXCEPTION 'Data catatan jadwal tidak valid';
  END IF;

  mutation_payload := jsonb_build_object(
    'week_start', p_week_start, 'day_date', p_day_date,
    'group_name', p_group_name, 'content', p_content,
    'sort_order', p_sort_order, 'is_deleted', coalesce(p_is_deleted, false)
  );
  payload_hash := md5(mutation_payload::text);

  SELECT * INTO saved
    FROM public.schedule_note_blocks WHERE id = p_id FOR UPDATE;

  IF FOUND THEN
    IF saved.last_mutation_id = p_mutation_id THEN
      IF saved.last_mutation_hash IS DISTINCT FROM payload_hash THEN
        RAISE EXCEPTION 'ID simpan sudah digunakan untuk perubahan yang berbeda' USING ERRCODE = '22023';
      END IF;
      RETURN jsonb_build_object('row', to_jsonb(saved), 'replayed', true);
    END IF;
    IF saved.version <> p_expected_version THEN
      RAISE EXCEPTION 'Catatan diubah oleh %; muat perubahan terbaru sebelum menyimpan', coalesce(saved.updated_by, 'admin lain') USING ERRCODE = '40001';
    END IF;

    UPDATE public.schedule_note_blocks SET
      week_start = p_week_start, day_date = p_day_date,
      group_name = p_group_name, content = p_content,
      sort_order = p_sort_order, is_deleted = coalesce(p_is_deleted, false),
      version = saved.version + 1, updated_at = now(),
      updated_by = coalesce(nullif(actor_name, ''), actor_role), updated_by_id = (SELECT auth.uid()),
      last_mutation_id = p_mutation_id, last_mutation_hash = payload_hash
      WHERE id = p_id RETURNING * INTO saved;
  ELSE
    IF p_expected_version <> 0 THEN
      RAISE EXCEPTION 'Catatan belum tersimpan pada perangkat ini; muat ulang minggu tersebut' USING ERRCODE = '40001';
    END IF;
    BEGIN
      INSERT INTO public.schedule_note_blocks (
        id, week_start, day_date, group_name, content, sort_order,
        is_deleted, version, updated_at, updated_by, updated_by_id,
        last_mutation_id, last_mutation_hash
      ) VALUES (
        p_id, p_week_start, p_day_date, p_group_name, p_content, p_sort_order,
        coalesce(p_is_deleted, false), 1, now(), coalesce(nullif(actor_name, ''), actor_role), (SELECT auth.uid()),
        p_mutation_id, payload_hash
      ) RETURNING * INTO saved;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Grup jadwal dibuat oleh admin lain; muat ulang sebelum mengedit' USING ERRCODE = '40001';
    END;
  END IF;

  RETURN jsonb_build_object('row', to_jsonb(saved), 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.save_schedule_note_block(text,date,date,text,text,integer,integer,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_schedule_note_block(text,date,date,text,text,integer,integer,uuid,boolean) TO authenticated;

COMMIT;
