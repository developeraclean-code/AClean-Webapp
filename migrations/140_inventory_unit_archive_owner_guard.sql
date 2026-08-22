-- Migration 140: Arsip unit stok = HAK OWNER. Dikunci di DB, bukan cuma di UI.
--
-- Keputusan Owner 22 Agu 2026: Admin tidak boleh arsip/pulihkan unit; Admin harus
-- lapor ke Owner. Tujuannya mencegah stok "hilang" lewat pengarsipan diam-diam.
--
-- Kenapa harus di DB, bukan cukup menyembunyikan tombol:
-- tabel ini cuma punya SATU policy — auth_full_inventory_units (ALL, authenticated,
-- USING true, WITH CHECK true). Artinya SIAPA PUN yang bisa login (Admin, Teknisi,
-- Helper) bisa mengarsipkan lewat API tanpa perlu tombolnya muncul. Menyembunyikan
-- tombol hanya menghalangi yang tidak tahu caranya, bukan yang berniat.
--
-- Cakupan trigger SENGAJA sempit — hanya kolom archived*. Kolom `stock` TIDAK ikut
-- dikunci karena jalur sah menulisnya banyak dan sebagian dijalankan sebagai teknisi
-- (syncTrackedStock di lib/trackedStock.js:88 saat submit laporan, konfirmasi MatTrack,
-- koreksi stok). Mengunci stock di sini berisiko memutus submit laporan teknisi.
-- Celah "semua authenticated boleh ubah stock" dicatat sebagai temuan terpisah.
--
-- auth.uid() IS NULL = pemanggilan server-to-server (service key: cron, /api/*) → diizinkan.
-- Selain itu wajib role Owner.
--
-- Idempotent: IF NOT EXISTS + CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

-- 1) Jejak siapa yang mengarsipkan (sebelumnya hanya ada archived_at & alasan).
ALTER TABLE inventory_units ADD COLUMN IF NOT EXISTS archived_by text;

COMMENT ON COLUMN inventory_units.archived_by IS
  'Nama user yang mengarsipkan/memulihkan. Diisi UI MatTrack; dijaga trigger trg_guard_inventory_unit_archive (Owner only).';

-- 2) Guard: hanya Owner yang boleh mengubah status arsip.
CREATE OR REPLACE FUNCTION fn_guard_inventory_unit_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changed := COALESCE(NEW.archived, false);
  ELSE
    v_changed := (NEW.archived        IS DISTINCT FROM OLD.archived)
              OR (NEW.archived_at     IS DISTINCT FROM OLD.archived_at)
              OR (NEW.archived_reason IS DISTINCT FROM OLD.archived_reason)
              OR (NEW.archived_by     IS DISTINCT FROM OLD.archived_by);
  END IF;

  IF v_changed AND auth.uid() IS NOT NULL THEN
    v_role := get_my_role();
    IF COALESCE(v_role, '') <> 'Owner' THEN
      RAISE EXCEPTION 'Arsip/pulihkan unit stok hanya boleh oleh Owner (role Anda: %). Silakan lapor ke Owner.',
        COALESCE(v_role, 'tidak dikenal');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_inventory_unit_archive ON inventory_units;
CREATE TRIGGER trg_guard_inventory_unit_archive
  BEFORE INSERT OR UPDATE ON inventory_units
  FOR EACH ROW EXECUTE FUNCTION fn_guard_inventory_unit_archive();

COMMENT ON FUNCTION fn_guard_inventory_unit_archive() IS
  'Kunci server-side: hanya Owner boleh ubah kolom archived* di inventory_units (migrasi 140).';

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- Sebagai Admin di aplikasi, klik Arsip → harus gagal dgn pesan di atas.
-- SELECT tgname FROM pg_trigger WHERE tgrelid='inventory_units'::regclass AND NOT tgisinternal;
-- Update stok biasa harus TETAP jalan (tidak menyentuh kolom archived):
-- UPDATE inventory_units SET stock = stock WHERE id = '<uuid>';

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_guard_inventory_unit_archive ON inventory_units;
-- DROP FUNCTION IF EXISTS fn_guard_inventory_unit_archive();
