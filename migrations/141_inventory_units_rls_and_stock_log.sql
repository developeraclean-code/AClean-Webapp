-- Migration 141: Kunci tulis inventory_units ke Owner/Admin + log setiap perubahan stok.
--
-- Keputusan Owner 22 Agu 2026, menutup celah yang tersisa dari migrasi 140: arsip sudah
-- Owner-only, TAPI kolom `stock` masih bisa diubah siapa pun yang login karena tabel ini
-- cuma punya satu policy — auth_full_inventory_units (ALL, authenticated, USING true).
--
-- Penelusuran jalur tulis (22 Agu 2026, tidak ada penulis dari backend/service key):
--   1. src/lib/trackedStock.js:88        sync stok per-unit dari laporan  → teknisi / Owner-Admin
--   2. src/views/MaterialConfirmTab:82   potong stok konfirmasi MatTrack  → Owner/Admin
--   3. src/views/MatTrackView:544        koreksi timbang aktual freon     → Owner/Admin
--   4. src/views/MatTrackView:625        tambah unit baru (INSERT)        → Owner/Admin
--   5. src/views/MatTrackView:641        UBAH STOK MANUAL                 → Owner/Admin
--   6. src/views/MatTrackView:654        aktif/nonaktif                   → Owner/Admin
--   7. src/views/MatTrackView:665,691    arsip/pulihkan                   → Owner (migrasi 140)
-- Hanya jalur 1 yang mungkin berjalan sebagai Teknisi. Dengan toggle Material Harian ON
-- (kondisi sekarang), pipa/kabel/freon sudah disaring keluar sebelum sampai ke sana,
-- jadi jalur itu praktis tidak menulis apa-apa untuk teknisi.
-- CATATAN PENTING: kalau app_settings.material_confirm_deduct_enabled dimatikan, submit
-- laporan teknisi kembali perlu memotong stok per-unit → policy UPDATE di bawah harus
-- ditinjau ulang (atau pemotongan dipindah ke endpoint backend ber-service-key).
-- Supaya kegagalan tidak senyap, trackedStock.js kini mencatat error update ke console.
--
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE.

-- ── 1) Tabel jejak perubahan stok per unit ───────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_unit_stock_log (
  id              bigserial PRIMARY KEY,
  unit_id         uuid,
  unit_label      text,
  inventory_code  text,
  old_stock       numeric,
  new_stock       numeric,
  delta           numeric,
  actor_uid       uuid,
  actor_name      text,
  actor_role      text,
  op              text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iusl_created ON inventory_unit_stock_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iusl_unit    ON inventory_unit_stock_log(unit_id);

COMMENT ON TABLE inventory_unit_stock_log IS
  'Jejak setiap perubahan inventory_units.stock (siapa, dari berapa ke berapa). Diisi trigger, bukan aplikasi — jadi jalur mana pun tetap tercatat.';

ALTER TABLE inventory_unit_stock_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iusl_select_owner_admin ON inventory_unit_stock_log;
CREATE POLICY iusl_select_owner_admin ON inventory_unit_stock_log
  FOR SELECT TO authenticated
  USING ((select get_my_role()) = ANY (ARRAY['Owner'::text, 'Admin'::text]));
-- Sengaja TIDAK ada policy INSERT/UPDATE/DELETE: hanya trigger (SECURITY DEFINER)
-- yang boleh menulis, dan tidak ada seorang pun boleh mengubah/menghapus jejak.

-- ── 2) Trigger pencatat ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_log_inventory_unit_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stock IS NOT DISTINCT FROM OLD.stock THEN
    RETURN NEW;                                  -- bukan perubahan stok, abaikan
  END IF;

  INSERT INTO inventory_unit_stock_log
    (unit_id, unit_label, inventory_code, old_stock, new_stock, delta,
     actor_uid, actor_name, actor_role, op)
  VALUES
    (NEW.id, NEW.unit_label, NEW.inventory_code,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.stock ELSE NULL END,
     NEW.stock,
     NEW.stock - COALESCE(CASE WHEN TG_OP = 'UPDATE' THEN OLD.stock ELSE 0 END, 0),
     auth.uid(),
     COALESCE(get_my_name(), 'sistem/server'),
     COALESCE(get_my_role(), 'service'),
     TG_OP);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_inventory_unit_stock ON inventory_units;
CREATE TRIGGER trg_log_inventory_unit_stock
  AFTER INSERT OR UPDATE ON inventory_units
  FOR EACH ROW EXECUTE FUNCTION fn_log_inventory_unit_stock();

-- ── 3) RLS berjenjang menggantikan policy "semua boleh apa saja" ─────────────
-- get_my_role() dibungkus (select ...) supaya tidak memicu lint auth_rls_initplan
-- (pola migrasi 095).
DROP POLICY IF EXISTS auth_full_inventory_units ON inventory_units;

DROP POLICY IF EXISTS inv_units_select_all ON inventory_units;
CREATE POLICY inv_units_select_all ON inventory_units
  FOR SELECT TO authenticated USING (true);      -- teknisi perlu baca daftar roll/tabung

DROP POLICY IF EXISTS inv_units_insert_owner_admin ON inventory_units;
CREATE POLICY inv_units_insert_owner_admin ON inventory_units
  FOR INSERT TO authenticated
  WITH CHECK ((select get_my_role()) = ANY (ARRAY['Owner'::text, 'Admin'::text]));

DROP POLICY IF EXISTS inv_units_update_owner_admin ON inventory_units;
CREATE POLICY inv_units_update_owner_admin ON inventory_units
  FOR UPDATE TO authenticated
  USING ((select get_my_role()) = ANY (ARRAY['Owner'::text, 'Admin'::text]))
  WITH CHECK ((select get_my_role()) = ANY (ARRAY['Owner'::text, 'Admin'::text]));

DROP POLICY IF EXISTS inv_units_delete_owner ON inventory_units;
CREATE POLICY inv_units_delete_owner ON inventory_units
  FOR DELETE TO authenticated
  USING ((select get_my_role()) = 'Owner');

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- SELECT polname, polcmd FROM pg_policy WHERE polrelid='inventory_units'::regclass;
-- Ubah stok sebagai Owner/Admin → tercatat di inventory_unit_stock_log.
-- SELECT * FROM inventory_unit_stock_log ORDER BY created_at DESC LIMIT 10;

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS inv_units_select_all ON inventory_units;
-- DROP POLICY IF EXISTS inv_units_insert_owner_admin ON inventory_units;
-- DROP POLICY IF EXISTS inv_units_update_owner_admin ON inventory_units;
-- DROP POLICY IF EXISTS inv_units_delete_owner ON inventory_units;
-- CREATE POLICY auth_full_inventory_units ON inventory_units FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- DROP TRIGGER IF EXISTS trg_log_inventory_unit_stock ON inventory_units;
