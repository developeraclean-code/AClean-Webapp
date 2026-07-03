-- Migration 118: Tutup privilege escalation user_profiles + kunci weekly_payroll
-- TEMUAN KRITIS audit SFM 2026-07-03: policy UPDATE user_profiles mengizinkan SEMUA
-- user login mengubah baris SIAPA PUN — termasuk kolom role. Artinya Teknisi bisa
-- mempromosikan dirinya jadi Owner lewat satu request PostgREST. weekly_payroll
-- juga full CRUD untuk semua authenticated (teknisi bisa edit gajinya sendiri).
--
-- Desain UPDATE user_profiles: tetap luas per-baris (submitLaporan sesi teknisi
-- meng-update status rekan setim — line 352), tapi kolom privilege (role, gaji,
-- PIN, bank, password) dijaga trigger. INSERT dibatasi Owner/Admin.
-- Bergantung pada: migrasi 117 (get_my_role).

-- ── 1. user_profiles: INSERT hanya Owner/Admin ──
-- (Teknisi baru dibuat dari TeknisiFormModal oleh Owner/Admin; user login dibuat
--  via /api/manage-user pakai service key — dua-duanya tetap jalan.)
DROP POLICY IF EXISTS "Authenticated insert user_profiles" ON public.user_profiles;
CREATE POLICY user_profiles_insert ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin'));

-- ── 2. user_profiles: UPDATE tetap luas, kolom privilege dijaga trigger ──
DROP POLICY IF EXISTS "Authenticated update user_profiles" ON public.user_profiles;
CREATE POLICY user_profiles_update ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.guard_user_profiles_privileged()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req_role text := coalesce(auth.role(), '');
  my_role  text;
BEGIN
  -- Hanya batasi request JWT client (authenticated/anon).
  -- Service key (/api/manage-user) & SQL editor lolos tanpa guard.
  IF req_role NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  my_role := coalesce(public.get_my_role(), '');

  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'Owner' AND my_role <> 'Owner' THEN
      RAISE EXCEPTION 'Hanya Owner yang boleh membuat akun ber-role Owner';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: perubahan role hanya oleh Owner (tutup jalur self-promotion).
  IF NEW.role IS DISTINCT FROM OLD.role AND my_role <> 'Owner' THEN
    RAISE EXCEPTION 'Perubahan role hanya boleh dilakukan Owner';
  END IF;

  -- Kolom gaji/PIN/bank/password: hanya Owner/Admin.
  -- (Edit resmi lewat TeknisiFormModal/GajiTab = Owner/Admin; ganti password
  --  lewat /api/manage-user = service key, tidak kena guard ini.)
  IF (NEW.daily_rate      IS DISTINCT FROM OLD.daily_rate
      OR NEW.commission_pin IS DISTINCT FROM OLD.commission_pin
      OR NEW.password       IS DISTINCT FROM OLD.password
      OR NEW.bank_name      IS DISTINCT FROM OLD.bank_name
      OR NEW.bank_account_no IS DISTINCT FROM OLD.bank_account_no
      OR NEW.bank_holder    IS DISTINCT FROM OLD.bank_holder)
     AND my_role NOT IN ('Owner', 'Admin') THEN
    RAISE EXCEPTION 'Perubahan data gaji/PIN/bank hanya boleh Owner/Admin';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger tetap jalan tanpa EXECUTE client — cabut agar tak bisa dipanggil via rpc.
REVOKE EXECUTE ON FUNCTION public.guard_user_profiles_privileged() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_user_profiles ON public.user_profiles;
CREATE TRIGGER trg_guard_user_profiles
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_profiles_privileged();

-- ── 3. weekly_payroll: baca = baris sendiri atau Owner/Admin/Finance; tulis = O/A/F ──
-- (KomisiView teknisi query by user_id = uid sendiri → tetap jalan.)
DROP POLICY IF EXISTS auth_read_weekly_payroll   ON public.weekly_payroll;
DROP POLICY IF EXISTS auth_write_weekly_payroll  ON public.weekly_payroll;
DROP POLICY IF EXISTS auth_update_weekly_payroll ON public.weekly_payroll;
DROP POLICY IF EXISTS auth_delete_weekly_payroll ON public.weekly_payroll;

CREATE POLICY weekly_payroll_select ON public.weekly_payroll
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
         OR (SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY weekly_payroll_insert ON public.weekly_payroll
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY weekly_payroll_update ON public.weekly_payroll
  FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'))
  WITH CHECK ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));

CREATE POLICY weekly_payroll_delete ON public.weekly_payroll
  FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) IN ('Owner', 'Admin', 'Finance'));
