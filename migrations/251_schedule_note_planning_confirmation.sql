-- Confirm one Catatan Jadwal team into real Planning Orders atomically.
-- A confirmed team is immutable in the notes; subsequent schedule changes belong
-- in Planning Order so a second admin cannot create duplicate jobs.
BEGIN;

ALTER TABLE public.schedule_note_blocks
  ADD COLUMN planning_order_ids text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN planning_synced_at timestamptz,
  ADD COLUMN planning_synced_by_id uuid;

CREATE OR REPLACE FUNCTION public.confirm_schedule_note_team(
  p_note_id text,
  p_expected_version integer,
  p_orders jsonb,
  p_actor_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  note_row public.schedule_note_blocks%ROWTYPE;
  actor_name text;
  actor_role text;
  actor_active boolean;
  item jsonb;
  order_payload jsonb;
  order_result jsonb;
  created_orders jsonb := '[]'::jsonb;
  created_customers jsonb := '[]'::jsonb;
  created_ids text[] := '{}'::text[];
  normalized_phone text;
  item_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Sesi login diperlukan' USING ERRCODE = '42501';
  END IF;

  SELECT p.name, p.role, p.active
    INTO actor_name, actor_role, actor_active
    FROM public.user_profiles p WHERE p.id = (SELECT auth.uid());
  IF NOT FOUND OR actor_active IS DISTINCT FROM TRUE OR actor_role IS NULL OR actor_role NOT IN ('Owner', 'Admin') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin aktif yang dapat membuat Planning Order dari catatan jadwal' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO note_row
    FROM public.schedule_note_blocks n
    WHERE n.id = p_note_id
    FOR UPDATE;
  IF NOT FOUND OR note_row.is_deleted THEN
    RAISE EXCEPTION 'Grup catatan jadwal tidak ditemukan atau sudah dihapus';
  END IF;

  IF cardinality(note_row.planning_order_ids) > 0 THEN
    SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY array_position(note_row.planning_order_ids, o.id)), '[]'::jsonb)
      INTO created_orders
      FROM public.orders o WHERE o.id = ANY(note_row.planning_order_ids);
    RETURN jsonb_build_object(
      'note', to_jsonb(note_row), 'orders', created_orders,
      'customers', created_customers,
      'order_ids', to_jsonb(note_row.planning_order_ids), 'already_confirmed', true
    );
  END IF;

  IF p_expected_version IS NULL OR note_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Catatan berubah sejak pratinjau dibuka; muat ulang lalu periksa lagi' USING ERRCODE = '40001';
  END IF;
  IF jsonb_typeof(p_orders) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Daftar job tidak valid';
  END IF;
  item_count := jsonb_array_length(p_orders);
  IF item_count < 1 OR item_count > 30 THEN
    RAISE EXCEPTION 'Konfirmasi tim harus berisi 1 sampai 30 job';
  END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_orders)) <> item_count THEN
    RAISE EXCEPTION 'ID job dalam satu konfirmasi harus unik';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_orders)
  LOOP
    normalized_phone := regexp_replace(coalesce(item->>'phone', ''), '[^0-9]', '', 'g');
    IF normalized_phone LIKE '0%' THEN
      normalized_phone := '62' || substr(normalized_phone, 2);
    END IF;

    IF nullif(item->>'id', '') IS NULL
       OR length(coalesce(item->>'customer', '')) NOT BETWEEN 2 AND 100
       OR normalized_phone !~ '^[0-9]{8,15}$'
       OR length(coalesce(item->>'address', '')) NOT BETWEEN 5 AND 255
       OR item->>'date' IS DISTINCT FROM note_row.day_date::text
       OR coalesce(item->>'service', '') NOT IN ('Cleaning', 'Repair', 'Install', 'Complain', 'Maintenance')
       OR coalesce(item->>'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR coalesce(item->>'time_end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR coalesce((item->>'units')::integer, 0) NOT BETWEEN 1 AND 100
       OR nullif(trim(item->>'team_slot'), '') IS NULL
       OR nullif(trim(item->>'teknisi'), '') IS NULL THEN
      RAISE EXCEPTION 'Job belum lengkap atau tidak valid; periksa nama, WhatsApp, alamat, waktu, layanan, unit, teknisi, dan tim';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.name = item->>'teknisi' AND p.role = 'Teknisi' AND p.active IS TRUE
    ) THEN
      RAISE EXCEPTION 'Teknisi % tidak aktif atau tidak ditemukan', item->>'teknisi';
    END IF;

    order_payload := jsonb_build_object(
      'id', item->>'id', 'customer', trim(item->>'customer'), 'phone', normalized_phone,
      'address', trim(item->>'address'), 'area', coalesce(item->>'area', ''),
      'service', item->>'service', 'type', coalesce(nullif(item->>'type', ''), 'AC Split 0.5-1PK'),
      'units', (item->>'units')::integer, 'teknisi', trim(item->>'teknisi'),
      'helper', nullif(trim(item->>'helper'), ''), 'date', item->>'date',
      'time', item->>'time', 'time_end', item->>'time_end',
      'team_slot', trim(item->>'team_slot'), 'notes', coalesce(item->>'notes', ''),
      'source', 'schedule_note'
    );

    order_result := public.create_order_workflow_atomic(
      order_payload, false, coalesce(nullif(trim(actor_name), ''), nullif(trim(p_actor_name), ''), actor_role),
      'schedule-note:' || p_note_id || ':' || (item->>'id')
    );
    created_orders := created_orders || jsonb_build_array(order_result->'order');
    IF order_result->'customer' IS NOT NULL AND order_result->'customer' <> 'null'::jsonb THEN
      created_customers := created_customers || jsonb_build_array(order_result->'customer');
    END IF;
    created_ids := array_append(created_ids, order_result->'order'->>'id');
  END LOOP;

  UPDATE public.schedule_note_blocks SET
    planning_order_ids = created_ids,
    planning_synced_at = now(), planning_synced_by_id = (SELECT auth.uid()),
    version = note_row.version + 1, updated_at = now(),
    updated_by = coalesce(nullif(trim(actor_name), ''), nullif(trim(p_actor_name), ''), actor_role),
    updated_by_id = (SELECT auth.uid()), last_mutation_id = NULL, last_mutation_hash = NULL
  WHERE id = p_note_id
  RETURNING * INTO note_row;

  RETURN jsonb_build_object(
    'note', to_jsonb(note_row), 'orders', created_orders,
    'customers', created_customers,
    'order_ids', to_jsonb(created_ids), 'already_confirmed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_schedule_note_team(text,integer,jsonb,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_schedule_note_team(text,integer,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.block_confirmed_schedule_note_edits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF cardinality(OLD.planning_order_ids) > 0 AND (
    NEW.week_start IS DISTINCT FROM OLD.week_start
    OR NEW.day_date IS DISTINCT FROM OLD.day_date
    OR NEW.group_name IS DISTINCT FROM OLD.group_name
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.sort_order IS DISTINCT FROM OLD.sort_order
    OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted
  ) THEN
    RAISE EXCEPTION 'Tim ini sudah menjadi Planning Order; ubah jadwal melalui menu Planning Order' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.block_confirmed_schedule_note_edits() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS schedule_note_confirmed_immutable ON public.schedule_note_blocks;
CREATE TRIGGER schedule_note_confirmed_immutable
  BEFORE UPDATE ON public.schedule_note_blocks
  FOR EACH ROW EXECUTE FUNCTION public.block_confirmed_schedule_note_edits();

COMMIT;
