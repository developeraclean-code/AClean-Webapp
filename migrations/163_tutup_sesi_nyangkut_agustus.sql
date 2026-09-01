-- Migration 163: tutup 4 sesi pagi yang menggantung (22/25/27 Agu 2026).
--
-- Keputusan Owner 1 Sep 2026: qty tabung Boim & Samsul per hari ini sudah cocok dengan
-- kondisi fisik, jadi sesi lama ini murni sisa pencatatan — bukan barang yang benar-benar
-- masih di luar. Ditutup supaya penanda "🚚 keluar" di layar Stok bersih dan uji coba
-- admin-only berangkat dari nol.
--
-- Yang ditutup (semuanya sesi PAGI, confirm_status PENDING, sesi pulang-nya REJECTED):
--   Boim    22 Agu  Tabung R32 - K   4,8 kg
--   Ezra    25 Agu  Roll 1PK-A1        4 m
--   Boim    27 Agu  Tabung R32 - G   3,1 kg
--   Samsul  27 Agu  Tabung R32 - F     4 kg
--
-- NOL DAMPAK STOK — diverifikasi sebelum dijalankan: keempatnya punya
-- deduct_tx_ids kosong, jadi tidak ada satu pun potongan stok yang menempel.
-- Stok, qty, dan inventory_transactions tidak disentuh sama sekali.
--
-- DIARSIPKAN, BUKAN DIHAPUS — mengikuti pilihan Owner pada migrasi 162. Barisnya tetap
-- ada sebagai jejak bahwa material pernah tercatat keluar dan tidak pernah dilaporkan
-- pulang; menghapusnya akan menghilangkan bukti bahwa kejadian ini pernah ada.
-- Terlihat lewat tombol "📦 Arsip" di Konfirmasi Material.
--
-- Idempotent: menyasar id tertentu yang archived_at-nya masih NULL.

BEGIN;

UPDATE teknisi_material_checkout
SET archived_at = now(),
    archived_by = 'Ditutup Owner 1 Sep 2026 — qty fisik sudah cocok, sisa pencatatan'
WHERE archived_at IS NULL
  AND id IN (
    '0fbd7daa-c7d6-4347-a09e-633f1d28fccd',  -- Boim   22 Agu · Tabung R32 - K
    '6585c930-5b3c-4837-8bdc-f7de9386d594',  -- Ezra   25 Agu · Roll 1PK-A1
    'f45fdf71-a795-4440-92a4-2436c9ae20bd',  -- Boim   27 Agu · Tabung R32 - G
    '4fd2a40b-3d25-44c8-a971-e0fa98051dc8'   -- Samsul 27 Agu · Tabung R32 - F
  );

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- Harus 0 — tidak ada lagi sesi pagi menggantung dalam 14 hari terakhir:
-- WITH tuntas AS (SELECT DISTINCT teknisi_name||'|'||checkout_date k
--   FROM teknisi_material_checkout WHERE session_type='pulang' AND confirm_status='CONFIRMED')
-- SELECT count(*) FROM teknisi_material_checkout s
--  WHERE s.session_type='pagi' AND s.confirm_status<>'REJECTED' AND s.archived_at IS NULL
--    AND s.checkout_date >= CURRENT_DATE - 14
--    AND (s.teknisi_name||'|'||s.checkout_date) NOT IN (SELECT k FROM tuntas);

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- UPDATE teknisi_material_checkout SET archived_at=NULL, archived_by=NULL
--  WHERE archived_by='Ditutup Owner 1 Sep 2026 — qty fisik sudah cocok, sisa pencatatan';
