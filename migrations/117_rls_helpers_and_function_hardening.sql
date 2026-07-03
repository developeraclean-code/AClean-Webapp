-- Migration 117: RLS helper functions + hardening fungsi SECURITY DEFINER
-- Fondasi untuk otorisasi server-side (Fase 1 audit SFM). Selama ini pembatasan
-- role Owner/Admin/Finance hanya hidup di UI (canAccess App.jsx) — semua user login
-- punya akses penuh ke tabel finansial via anon key + JWT. Migrasi ini menambah
-- helper role-check untuk dipakai policy di 118-120, dan menutup 10 lint
-- "security_definer_function_executable" (anon/authenticated bisa eksekusi fungsi
-- SECURITY DEFINER maintenance/inventori langsung via /rest/v1/rpc).

-- ── 1. Helper: role user yang sedang login ──
-- SECURITY DEFINER agar tetap bisa baca user_profiles walau RLS-nya diperketat kelak.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated, service_role;

-- ── 2. Helper: nama user yang sedang login ──
-- Dipakai untuk match name-based (orders.teknisi*, order_bonuses.team_members,
-- kasbon_requests.teknisi_name) — skema existing pakai nama, bukan uid.
CREATE OR REPLACE FUNCTION public.get_my_name()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT name FROM public.user_profiles WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_name() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_name() TO authenticated, service_role;

-- ── 3. Helper: apakah user login adalah anggota tim job ini? ──
-- Mencakup job multi-hari: anggota order anak (parent_job_id = p_job_id) juga
-- dianggap anggota job induk — WAJIB, karena precheck invoice multi-hari di
-- submitLaporan membaca invoice induk yang timnya bisa beda per hari.
CREATE OR REPLACE FUNCTION public.is_my_job(p_job_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE (o.id = p_job_id OR o.parent_job_id = p_job_id)
      AND public.get_my_name() IN (o.teknisi, o.teknisi2, o.teknisi3,
                                   o.helper,  o.helper2,  o.helper3)
  );
$$;

REVOKE ALL ON FUNCTION public.is_my_job(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_job(text) TO authenticated, service_role;

-- ── 4. Hardening fungsi SECURITY DEFINER existing ──

-- deduct_inventory: tidak dipanggil client mana pun (0 rpc() di src/, 0 trigger) →
-- tutup penuh dari client. Backend service key tetap bisa.
REVOKE EXECUTE ON FUNCTION public.deduct_inventory(text, numeric) FROM PUBLIC, anon, authenticated;

-- sync_order_paid_on_invoice: fungsi trigger — trigger tetap jalan tanpa EXECUTE client.
REVOKE EXECUTE ON FUNCTION public.sync_order_paid_on_invoice() FROM PUBLIC, anon, authenticated;

-- set_current_user: dipanggil SEMUA user login (audit context, App.jsx:1147) →
-- cabut anon saja, authenticated tetap.
REVOKE EXECUTE ON FUNCTION public.set_current_user(text) FROM PUBLIC, anon;

-- get_dead_rows_stats & manual_vacuum_table: dipanggil dari SettingsView (menu
-- Owner-only) via role authenticated → tidak bisa dicabut dari authenticated.
-- Solusi: guard Owner DI DALAM fungsi + cabut anon.
CREATE OR REPLACE FUNCTION public.get_dead_rows_stats()
RETURNS TABLE(tablename text, live_rows bigint, dead_rows bigint, last_autovacuum timestamp with time zone, last_vacuum timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Guard: request JWT client harus Owner; service key / SQL editor lolos.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon')
     AND coalesce(public.get_my_role(), '') <> 'Owner' THEN
    RAISE EXCEPTION 'get_dead_rows_stats: Owner only';
  END IF;
  RETURN QUERY
  SELECT
    s.relname::text     AS tablename,
    s.n_live_tup::bigint AS live_rows,
    s.n_dead_tup::bigint AS dead_rows,
    s.last_autovacuum,
    s.last_vacuum
  FROM pg_stat_user_tables s
  ORDER BY s.n_dead_tup DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dead_rows_stats() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.manual_vacuum_table(table_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  safe_name TEXT;
BEGIN
  -- Guard: request JWT client harus Owner; service key / SQL editor lolos.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon')
     AND coalesce(public.get_my_role(), '') <> 'Owner' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Owner only');
  END IF;

  SELECT relname INTO safe_name
  FROM pg_stat_user_tables
  WHERE relname = table_name
  LIMIT 1;

  IF safe_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Table not found: ' || table_name);
  END IF;

  EXECUTE format('VACUUM ANALYZE %I', safe_name);

  RETURN jsonb_build_object('ok', true, 'table', safe_name);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.manual_vacuum_table(text) FROM PUBLIC, anon;
