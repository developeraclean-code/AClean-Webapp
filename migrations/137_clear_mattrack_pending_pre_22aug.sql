-- Migration 137: Bersihkan antrean PENDING Material Harian (MatTrack) s/d 21 Agu 2026.
--
-- Keputusan Owner 22 Agu 2026: stok fisik sudah dicek dan "sudah normal dan benar",
-- jadi tunggakan konfirmasi lama TIDAK boleh dipotong lagi — cukup ditutup supaya
-- pemotongan bisa dimulai bersih dari 22 Agu 2026 (bersamaan dengan migrasi e98bb63
-- yang menjadikan Material Harian satu-satunya pintu potong pipa/kabel/freon).
--
-- Dipakai status 'REJECTED', BUKAN 'CONFIRMED'. Ini penting:
--   REJECTED = "ditolak, stok TIDAK dipotong" (lihat reject() di MaterialConfirmTab.jsx:98)
--   CONFIRMED = memicu pemotongan stok → justru akan mengurangi stok yang sudah benar.
-- Migrasi ini murni mengubah status; TIDAK ada baris inventory_transactions dibuat dan
-- TIDAK ada inventory_units.stock disentuh.
--
-- Cakupan (dihitung 22 Agu 2026): 48 baris PENDING dgn checkout_date <= 2026-08-21
--   - 4 baris session 'pulang'  (14-21 Agu) → ini yang tampil di antrean MatTrack
--   - 44 baris session 'pagi'   (14 Jun-21 Agu) → tidak tampil di antrean (MatTrack
--     hanya melist 'pulang'), tapi ikut ditutup agar tidak menggantung selamanya.
-- Baris PENDING dgn checkout_date >= 2026-08-22 SENGAJA dibiarkan — itu titik mulai bersih.
--
-- Pemasangan pagi<->pulang tidak terpengaruh: MaterialConfirmTab mengambil baris 'pagi'
-- by (teknisi_name, checkout_date) TANPA filter confirm_status (MaterialConfirmTab.jsx:33).
--
-- Idempotent: hanya menyentuh baris yang masih PENDING.

BEGIN;

UPDATE teknisi_material_checkout
SET confirm_status = 'REJECTED',
    confirmed_by   = 'Owner (bulk clear)',
    confirmed_at   = now(),
    confirm_notes  = trim(both ' ' from COALESCE(NULLIF(confirm_notes, ''), '') ||
      ' [bulk-clear-2026-08-22] Ditutup tanpa potong stok — stok fisik sudah dicek benar;' ||
      ' mulai bersih dari 22 Agu 2026.'),
    updated_at     = now()
WHERE confirm_status = 'PENDING'
  AND checkout_date <= '2026-08-21';

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- Harus: tidak ada lagi PENDING <= 21 Agu; PENDING tersisa hanya >= 22 Agu.
-- SELECT confirm_status, session_type, count(*), min(checkout_date)::text, max(checkout_date)::text
--   FROM teknisi_material_checkout GROUP BY 1,2 ORDER BY 1,2;
-- Pastikan tidak ada stok yang berubah karena migrasi ini:
-- SELECT count(*) FROM inventory_transactions WHERE created_at > now() - interval '5 minutes';

-- ── ROLLBACK (kalau ternyata sebagian memang perlu dipotong) ──────────────────
-- UPDATE teknisi_material_checkout
--    SET confirm_status = 'PENDING', confirmed_by = NULL, confirmed_at = NULL
--  WHERE confirm_notes LIKE '%[bulk-clear-2026-08-22]%';
