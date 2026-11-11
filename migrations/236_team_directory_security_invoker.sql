-- Migration 236: make the team-directory view honor caller permissions/RLS.
-- Keep the existing safe roster contract without widening user_profiles RLS:
-- a trigger-maintained table stores only fields intended for team scheduling.
BEGIN;

-- The existing view is owned by supabase_admin on the self-hosted instance.
-- Fail before creating anything unless this session owns the view or is a
-- superuser; CREATE OR REPLACE VIEW cannot be delegated through table grants.
DO $$
DECLARE
  view_owner text;
  caller_is_superuser boolean;
BEGIN
  SELECT pg_get_userbyid(c.relowner)
  INTO view_owner
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'lab_team_directory' AND c.relkind = 'v';

  SELECT rolsuper INTO caller_is_superuser
  FROM pg_roles WHERE rolname = current_user;

  IF NOT coalesce(caller_is_superuser, false)
     AND view_owner IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION 'Migration 236 must run as view owner (%) or a superuser; current role is %',
      coalesce(view_owner, '<view not found>'), current_user
      USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE TABLE public.team_directory_safe (
  id uuid PRIMARY KEY,
  name text,
  role text,
  status text,
  active boolean NOT NULL DEFAULT false,
  color text,
  avatar text,
  skills text[]
);

COMMENT ON TABLE public.team_directory_safe IS
  'Safe active-staff projection for team roster reads; never store profile contact, payroll, bank, or credential fields here.';

ALTER TABLE public.team_directory_safe ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_directory_safe FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.team_directory_safe TO authenticated;

CREATE POLICY team_directory_safe_read ON public.team_directory_safe
  FOR SELECT TO authenticated
  USING (
    active IS TRUE
    AND (SELECT auth.uid()) IS NOT NULL
    AND (SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance', 'Teknisi', 'Helper')
  );

CREATE OR REPLACE FUNCTION public.sync_team_directory_safe_236()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.team_directory_safe WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.id IS DISTINCT FROM NEW.id THEN
      DELETE FROM public.team_directory_safe WHERE id = OLD.id;
    END IF;
  END IF;

  IF NEW.active IS TRUE THEN
    INSERT INTO public.team_directory_safe(id, name, role, status, active, color, avatar, skills)
    VALUES (NEW.id, NEW.name, NEW.role, NEW.status, NEW.active, NEW.color, NEW.avatar, NEW.skills)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      status = EXCLUDED.status,
      active = EXCLUDED.active,
      color = EXCLUDED.color,
      avatar = EXCLUDED.avatar,
      skills = EXCLUDED.skills;
  ELSE
    DELETE FROM public.team_directory_safe WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_team_directory_safe_236() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_sync_team_directory_safe_236 ON public.user_profiles;
CREATE TRIGGER trg_sync_team_directory_safe_236
  AFTER INSERT OR UPDATE OF id, name, role, status, active, color, avatar, skills OR DELETE
  ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_directory_safe_236();

-- Populate the projection after installing its trigger so later profile
-- changes stay in sync. Remove any stale projection rows from an earlier run.
INSERT INTO public.team_directory_safe(id, name, role, status, active, color, avatar, skills)
SELECT id, name, role, status, active, color, avatar, skills
FROM public.user_profiles
WHERE active IS TRUE
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  status = EXCLUDED.status,
  active = EXCLUDED.active,
  color = EXCLUDED.color,
  avatar = EXCLUDED.avatar,
  skills = EXCLUDED.skills;

DELETE FROM public.team_directory_safe AS directory
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_profiles AS profile
  WHERE profile.id = directory.id AND profile.active IS TRUE
);

-- Keep the trigger-maintained projection and its SECURITY DEFINER function
-- under the ordinary database owner even when this migration runs as the
-- superuser that owns the existing view.
ALTER TABLE public.team_directory_safe OWNER TO postgres;
ALTER FUNCTION public.sync_team_directory_safe_236() OWNER TO postgres;

CREATE OR REPLACE VIEW public.lab_team_directory
WITH (security_barrier = true, security_invoker = true)
AS
SELECT id, name, role, status, active, color, avatar, skills
FROM public.team_directory_safe
WHERE active IS TRUE
  AND (SELECT auth.uid()) IS NOT NULL
  AND (SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance', 'Teknisi', 'Helper');

REVOKE ALL ON public.lab_team_directory FROM PUBLIC, anon;
GRANT SELECT ON public.lab_team_directory TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
