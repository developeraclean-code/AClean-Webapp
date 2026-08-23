-- Migration 142: Hardening keamanan hasil audit 22 Agu 2026 (temuan 1, 2, 5).
--
-- ── (1) Jejak audit tidak bisa lagi dipalsukan ──────────────────────────────
-- get_current_user_for_audit() menentukan "siapa pelaku" dgn urutan prioritas:
--   1 last_changed_by → 2 updated_by → 3 created_by_name → 4 created_by → 5 app.current_user
-- SEMUA sumber itu dikirim dari browser. Prioritas 1-4 dari payload baris, dan
-- prioritas 5 dari set_current_user() yang EXECUTE-nya dipegang `authenticated`
-- (dipanggil App.jsx:1127 dgn nilai currentUser.name). Akibatnya siapa pun yang login
-- — termasuk Teknisi — bisa menulis nama orang lain lalu bertindak, dan audit mencatat
-- nama palsu itu. Ini melemahkan pertanggungjawaban stok & arsip (migrasi 140/141).
--
-- Perbaikan: tambah PRIORITAS 0 — kalau ada JWT (auth.uid() tidak NULL), pakai
-- get_my_name() yaitu nama dari user_profiles berdasarkan auth.uid(). Tidak bisa
-- dipalsukan karena tidak berasal dari input. Rantai lama TETAP dipertahankan sebagai
-- fallback untuk tulisan tanpa JWT (cron / service key) supaya atribusi mereka tidak hilang.
-- set_current_user() sengaja TIDAK dicabut: App.jsx masih memanggilnya (fail-silent) dan
-- kini nilainya diabaikan untuk user ber-JWT, jadi tidak berbahaya lagi.
--
-- ── (2) Perkecil permukaan anon pada RPC khusus admin ───────────────────────
-- 7 RPC di bawah sudah menolak anon saat runtime (check_admin_pass → is_admin), tapi
-- masih terdaftar bisa dipanggil anon. Dicabut agar tidak jadi permukaan serang &
-- membersihkan lint. TIDAK menyentuh admin_login/is_admin (UI bisa memanggil saat belum
-- login, harus tetap mengembalikan false, bukan error) dan TIDAK menyentuh
-- get_website_settings*/ (memang bacaan publik untuk website).
--
-- ── (5) Kerapian: search_path & fungsi trigger ──────────────────────────────
-- audit_maintenance_integrity: search_path dibuat eksplisit (fungsi ini BUKAN SECURITY
-- DEFINER sehingga risikonya rendah, tapi lint-nya nyata).
-- fn_guard_inventory_unit_archive & fn_log_inventory_unit_stock: fungsi trigger, tidak
-- pernah dipanggil sebagai RPC → EXECUTE dicabut dari anon & authenticated.
--
-- Idempotent: CREATE OR REPLACE + REVOKE (aman diulang).

BEGIN;

-- (1) Pelaku audit diambil dari JWT lebih dulu
CREATE OR REPLACE FUNCTION public.get_current_user_for_audit(row_data jsonb)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user TEXT;
BEGIN
  -- Prioritas 0: identitas dari JWT — TIDAK BISA DIPALSUKAN (migrasi 142).
  -- Semua prioritas di bawah berasal dari input klien, jadi hanya dipakai kalau
  -- penulisnya bukan user login (cron / service key, auth.uid() NULL).
  IF auth.uid() IS NOT NULL THEN
    v_user := public.get_my_name();
    IF v_user IS NOT NULL AND v_user <> '' THEN RETURN v_user; END IF;
    RETURN 'user:' || auth.uid()::text;   -- login tapi profil tak ditemukan
  END IF;

  IF row_data IS NOT NULL THEN
    v_user := row_data ->> 'last_changed_by';
    IF v_user IS NOT NULL AND v_user <> '' THEN RETURN v_user; END IF;

    v_user := row_data ->> 'updated_by';
    IF v_user IS NOT NULL AND v_user <> '' THEN RETURN v_user; END IF;

    v_user := row_data ->> 'created_by_name';
    IF v_user IS NOT NULL AND v_user <> '' THEN RETURN v_user; END IF;

    v_user := row_data ->> 'created_by';
    IF v_user IS NOT NULL AND v_user <> ''
       AND v_user !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN RETURN v_user; END IF;
  END IF;

  v_user := current_setting('app.current_user', true);
  IF v_user IS NOT NULL AND v_user <> '' THEN RETURN v_user; END IF;

  RETURN 'system';
END $function$;

-- (2) Cabut EXECUTE anon pada RPC khusus admin
REVOKE EXECUTE ON FUNCTION public.admin_list_ac_units(text)                     FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_ac_unit(integer, text)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_website_orders(text)                      FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_website_order_stats(text)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_website_setting(text, text, text)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_website_order_status(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_ac_unit(integer, text, text, text, text, text, integer, integer, text, boolean, text) FROM anon;

-- (5) Fungsi trigger tidak perlu bisa dipanggil sebagai RPC
REVOKE EXECUTE ON FUNCTION public.fn_guard_inventory_unit_archive() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_log_inventory_unit_stock()     FROM anon, authenticated;
-- WAJIB: Postgres memberi EXECUTE ke PUBLIC secara default pada fungsi baru, dan
-- REVOKE ... FROM anon TIDAK mencabutnya. Tanpa dua baris ini, anon/authenticated
-- tetap punya hak lewat PUBLIC (terverifikasi via has_function_privilege 22 Agu 2026).
-- Aman: trigger tetap jalan — pemanggil DML tidak perlu EXECUTE atas fungsi trigger
-- (diuji: Admin ubah stok BERHASIL, log tetap tercatat).
REVOKE EXECUTE ON FUNCTION public.fn_guard_inventory_unit_archive() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_log_inventory_unit_stock()     FROM PUBLIC;

COMMIT;

-- (5) search_path eksplisit — di luar transaksi agar kegagalan tidak membatalkan sisanya
ALTER FUNCTION public.audit_maintenance_integrity() SET search_path = public, pg_catalog;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- Pelaku audit kini dari JWT:
--   SELECT public.get_current_user_for_audit('{"last_changed_by":"NAMA PALSU"}'::jsonb);
--   → sebagai user login harus mengembalikan nama asli, bukan "NAMA PALSU".
-- Anon tidak lagi terdaftar di RPC admin:
--   SELECT routine_name, grantee FROM information_schema.role_routine_grants
--    WHERE routine_name IN ('save_website_setting','delete_ac_unit') ORDER BY 1,2;

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- GRANT EXECUTE ON FUNCTION public.save_website_setting(text,text,text) TO anon;  -- dst
-- (get_current_user_for_audit: pulihkan definisi lama tanpa blok "Prioritas 0")
