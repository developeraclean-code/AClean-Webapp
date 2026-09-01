-- Migration 159: GARIS MULAI konfirmasi timbang freon — tutup antrean s/d 25 Agu 2026.
--
-- Keputusan Owner 1 Sep 2026. Banner "34 transaksi freon belum dikonfirmasi timbang"
-- menumpuk sejak 23 Apr 2026 dan tidak mungkin ditimbang ulang sekarang: tabungnya
-- sudah dipakai berkali-kali sesudahnya. Antrean lama ditutup supaya audit ke depan
-- berangkat dari nol dan setiap baris yang muncul memang benar-benar perlu ditimbang.
--
-- YANG DILAKUKAN: qty_actual := qty (aktual = angka laporan teknisi).
--
-- TIDAK ADA STOK YANG BERUBAH. Stok sudah dipotong memakai `qty` sejak awal, dan
-- pembacaan di seluruh aplikasi memang `COALESCE(qty_actual, qty)`
-- (MatTrackView.jsx: `tx.qty_actual != null ? |qty_actual| : |qty|`). Menyamakan
-- keduanya hanya menutup penanda, bukan menulis ulang angka.
--
-- JEJAK: notes ditambahi penanda agar baris ini SELALU bisa dibedakan dari yang
-- benar-benar ditimbang admin. Tanpa ini, audit berikutnya akan mengira 34 baris
-- ini sudah diverifikasi timbangan — padahal tidak.
--
-- Cakupan terverifikasi sebelum dijalankan:
--   34 baris, 23 Apr 2026 – 19 Agu 2026, total 29,0 kg. Semuanya <= 25 Agu 2026,
--   jadi batas tanggal di bawah tidak memotong apa pun di tengah.
--
-- Idempotent: hanya menyentuh baris yang qty_actual-nya masih NULL.

BEGIN;

UPDATE inventory_transactions
SET qty_actual = qty,
    notes = COALESCE(notes, '') || ' · TIMBANG BASELINE 25 Agu 2026 (bukan hasil timbang aktual)'
WHERE qty < 0
  AND qty_actual IS NULL
  AND COALESCE(job_date, created_at::date) <= '2026-08-25'
  AND (lower(inventory_name) LIKE '%freon%' OR lower(inventory_name) LIKE '%r22%'
       OR lower(inventory_name) LIKE '%r32%' OR lower(inventory_name) LIKE '%r410%');

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- Harus 0 setelah dijalankan:
-- SELECT count(*) FROM inventory_transactions
--  WHERE qty < 0 AND qty_actual IS NULL
--    AND (lower(inventory_name) LIKE '%freon%' OR lower(inventory_name) LIKE '%r22%'
--         OR lower(inventory_name) LIKE '%r32%' OR lower(inventory_name) LIKE '%r410%');
--
-- Daftar baris baseline (untuk audit kemudian):
-- SELECT id, job_date, inventory_name, unit_label, qty, teknisi_name FROM inventory_transactions
--  WHERE notes LIKE '%TIMBANG BASELINE 25 Agu 2026%' ORDER BY job_date;

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- UPDATE inventory_transactions
--    SET qty_actual = NULL,
--        notes = replace(notes, ' · TIMBANG BASELINE 25 Agu 2026 (bukan hasil timbang aktual)', '')
--  WHERE notes LIKE '%TIMBANG BASELINE 25 Agu 2026%';
