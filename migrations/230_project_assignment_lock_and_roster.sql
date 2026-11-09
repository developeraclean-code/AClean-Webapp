-- 230: persist project assignment locks and snapshot all roster members on jobs.
-- Apply only after review; this file is local and is not applied to production.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS assignment_locked boolean NOT NULL DEFAULT false;

-- Project jobs use the daily slot as their crew grouping too. Include that
-- roster in assigned_members so every member can see the same project report.
CREATE OR REPLACE FUNCTION public.resolve_order_assigned_members(p_order public.orders)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  WITH names AS (
    SELECT btrim(person) AS name, position
    FROM unnest(ARRAY[
      (p_order).teknisi,(p_order).teknisi2,(p_order).teknisi3,
      (p_order).helper,(p_order).helper2,(p_order).helper3
    ]) WITH ORDINALITY AS member(person,position)
    UNION ALL
    SELECT btrim(person), position+6
    FROM public.daily_team_slots d,
         LATERAL unnest(ARRAY[
           d.member1,d.member2,d.member3,d.member4,
           d.member5,d.member6,d.member7,d.member8
         ]) WITH ORDINALITY AS member(person,position)
    WHERE d.date=(p_order).date AND d.slot=(p_order).team_slot
      AND (p_order).date >= (now() AT TIME ZONE 'Asia/Jakarta')::date - 30
  )
  SELECT coalesce(array_agg(name ORDER BY first_position),ARRAY[]::text[])
  FROM (
    SELECT (array_agg(name ORDER BY position))[1] AS name,min(position) AS first_position
    FROM names WHERE name IS NOT NULL AND name<>'' GROUP BY lower(name)
  ) distinct_names;
$$;
REVOKE ALL ON FUNCTION public.resolve_order_assigned_members(public.orders) FROM PUBLIC, anon, authenticated;

-- Refresh recent snapshots once so existing project jobs become visible to all
-- assigned crew members. Older history remains unchanged.
UPDATE public.orders o
SET assigned_members=public.resolve_order_assigned_members(o)
WHERE o.date >= (now() AT TIME ZONE 'Asia/Jakarta')::date - 30
  AND o.assigned_members IS DISTINCT FROM public.resolve_order_assigned_members(o);

CREATE OR REPLACE FUNCTION public.guard_locked_project_assignment()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_catalog AS $$
BEGIN
  IF OLD.project_id IS NOT NULL AND OLD.assignment_locked IS TRUE AND (
       NEW.teknisi IS DISTINCT FROM OLD.teknisi
    OR NEW.teknisi2 IS DISTINCT FROM OLD.teknisi2
    OR NEW.teknisi3 IS DISTINCT FROM OLD.teknisi3
    OR NEW.helper IS DISTINCT FROM OLD.helper
    OR NEW.helper2 IS DISTINCT FROM OLD.helper2
    OR NEW.helper3 IS DISTINCT FROM OLD.helper3
    OR NEW.assigned_members IS DISTINCT FROM OLD.assigned_members
    OR NEW.team_slot IS DISTINCT FROM OLD.team_slot
    OR NEW.date IS DISTINCT FROM OLD.date
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
  ) THEN
    RAISE EXCEPTION 'Project assignment is locked; unlock it before changing the assigned crew'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_locked_project_assignment ON public.orders;
CREATE TRIGGER trg_guard_locked_project_assignment
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_locked_project_assignment();

COMMIT;
