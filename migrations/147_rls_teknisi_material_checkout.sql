-- 147 — Tutup celah RLS teknisi_material_checkout (Material Harian).
--
-- MASALAH
-- Tabel ini cuma punya SATU aturan: `tmc_auth_all` = ALL untuk semua user login,
-- USING true / WITH CHECK true. Artinya di level database, teknisi & helper bisa:
--   - membaca sesi material SELURUH tim, bukan hanya miliknya
--   - mengubah confirm_status barisnya sendiri jadi CONFIRMED (seolah sudah
--     disetujui admin) atau REJECTED (pemakaian hilang tanpa potong stok)
--   - menyunting hasil koreksi admin (admin_adjustments) & jejak potong stok
-- Yang menahan selama ini cuma tampilan aplikasi, bukan database.
--
-- CARA KERJA YANG DIPERTAHANKAN (jangan sampai rusak)
-- Teknisi/helper punya app sendiri untuk input pagi & pulang, TAPI sering lupa.
-- Karena itu ada dua lapisan cadangan yang HARUS tetap bisa menulis:
--   lapis 2a  Admin/Owner input & koreksi manual mewakili teknisi yang lupa
--   lapis 2b  AI vision dari foto/teks grup WA (api/_handlers/wa.js)
-- Lapis 2b memakai SUPABASE_SERVICE_KEY → melewati RLS sepenuhnya, jadi tidak
-- terpengaruh aturan di bawah. Sama untuk cron pengingat (api/_tasks/_shared.js).
--
-- Verifikasi sebelum dikunci (25 Agu 2026): 11 nama teknisi/helper yang punya
-- baris 120 hari terakhir SEMUANYA cocok persis dengan user_profiles.name, jadi
-- pencocokan get_my_name() aman — tidak ada yang mendadak kehilangan aksesnya.

BEGIN;

DROP POLICY IF EXISTS tmc_auth_all ON teknisi_material_checkout;

-- BACA — Owner/Admin/Finance semua; teknisi/helper hanya barisnya sendiri.
-- (App teknisi memang selalu query .eq("teknisi_name", namanya sendiri).)
CREATE POLICY tmc_select ON teknisi_material_checkout
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('Owner', 'Admin', 'Finance')
    OR teknisi_name = get_my_name()
  );

-- TAMBAH — Owner/Admin bebas (lapisan cadangan saat teknisi lupa input);
-- teknisi/helper hanya atas nama sendiri dan wajib berstatus PENDING.
CREATE POLICY tmc_insert ON teknisi_material_checkout
  FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() IN ('Owner', 'Admin')
    OR (teknisi_name = get_my_name() AND confirm_status = 'PENDING')
  );

-- UBAH — Owner/Admin semua. Teknisi/helper hanya barisnya sendiri yang belum
-- dikonfirmasi; hasil akhirnya tetap wajib PENDING, sehingga tidak bisa
-- meloloskan sendiri (CONFIRMED) maupun menghilangkan pemakaian (REJECTED).
-- REJECTED tetap boleh dibuka jadi PENDING supaya teknisi bisa perbaiki & kirim ulang.
CREATE POLICY tmc_update ON teknisi_material_checkout
  FOR UPDATE TO authenticated
  USING (
    get_my_role() IN ('Owner', 'Admin')
    OR (teknisi_name = get_my_name() AND confirm_status IN ('PENDING', 'REJECTED'))
  )
  WITH CHECK (
    get_my_role() IN ('Owner', 'Admin')
    OR (teknisi_name = get_my_name() AND confirm_status IN ('PENDING', 'REJECTED'))
  );
-- Catatan: WITH CHECK sengaja TIDAK memaksa hasil akhir = PENDING. Kalau dipaksa,
-- teknisi yang menyunting baris REJECTED tanpa ikut mengubah statusnya (mis. sesi
-- 'pagi', yang payload-nya memang tak pernah menyertakan confirm_status) langsung
-- ditolak — ketahuan saat simulasi 25 Agu 2026. Yang menjaga arah perpindahan
-- status adalah trigger di bawah, dan itu lebih ketat karena membandingkan
-- OLD vs NEW: hanya REJECTED → PENDING yang lolos, CONFIRMED tetap mustahil.

-- HAPUS — Owner saja (sebelumnya siapa pun yang login bisa menghapus).
CREATE POLICY tmc_delete ON teknisi_material_checkout
  FOR DELETE TO authenticated
  USING (get_my_role() = 'Owner');

-- ── Penjaga per-kolom ───────────────────────────────────────────────────────
-- RLS hanya bisa menilai baris, bukan kolom. Trigger ini yang memastikan teknisi
-- tidak menyentuh kolom milik proses konfirmasi walau barisnya masih PENDING.
CREATE OR REPLACE FUNCTION guard_tmc_teknisi_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  peran text := get_my_role();
BEGIN
  -- auth.uid() NULL = service key (AI vision & cron) → lapis cadangan, biarkan.
  -- anon tidak pernah sampai sini karena semua policy di atas TO authenticated.
  IF auth.uid() IS NULL OR peran IN ('Owner', 'Admin') THEN
    RETURN NEW;
  END IF;

  -- Status: hanya boleh REJECTED → PENDING (kirim ulang setelah ditolak).
  IF NEW.confirm_status IS DISTINCT FROM OLD.confirm_status
     AND NOT (OLD.confirm_status = 'REJECTED' AND NEW.confirm_status = 'PENDING') THEN
    RAISE EXCEPTION 'Status konfirmasi material hanya boleh diubah Owner/Admin';
  END IF;

  -- Kolom milik proses konfirmasi & koreksi admin — tidak boleh disentuh teknisi.
  IF NEW.confirmed_by       IS DISTINCT FROM OLD.confirmed_by
     OR NEW.confirmed_at    IS DISTINCT FROM OLD.confirmed_at
     OR NEW.confirm_notes   IS DISTINCT FROM OLD.confirm_notes
     OR NEW.admin_adjustments IS DISTINCT FROM OLD.admin_adjustments
     OR NEW.deduct_tx_ids   IS DISTINCT FROM OLD.deduct_tx_ids
     OR NEW.teknisi_name    IS DISTINCT FROM OLD.teknisi_name THEN
    RAISE EXCEPTION 'Kolom konfirmasi/koreksi material hanya boleh diubah Owner/Admin';
  END IF;

  -- Sesi PAGI ikut terkunci begitu sesi PULANG hari itu sudah dikonfirmasi:
  -- angka "dibawa" adalah dasar hitungan bawa−sisa, jadi tidak boleh berubah
  -- setelah stok terlanjur dipotong.
  IF OLD.session_type = 'pagi' AND EXISTS (
      SELECT 1 FROM teknisi_material_checkout p
       WHERE p.teknisi_name = OLD.teknisi_name
         AND p.checkout_date = OLD.checkout_date
         AND p.session_type = 'pulang'
         AND p.confirm_status = 'CONFIRMED'
  ) THEN
    RAISE EXCEPTION 'Sesi pagi terkunci — pemakaian hari itu sudah dikonfirmasi';
  END IF;

  RETURN NEW;
END;
$$;

-- Pelajaran migrasi 142: REVOKE dari anon saja tidak cukup, Postgres memberi
-- EXECUTE ke PUBLIC secara bawaan.
REVOKE ALL ON FUNCTION public.guard_tmc_teknisi_update() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_guard_tmc_teknisi ON teknisi_material_checkout;
CREATE TRIGGER trg_guard_tmc_teknisi
  BEFORE UPDATE ON teknisi_material_checkout
  FOR EACH ROW EXECUTE FUNCTION guard_tmc_teknisi_update();

COMMIT;
