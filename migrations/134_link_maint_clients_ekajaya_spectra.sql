-- Migration 134: Tautkan 2 klien maintenance yatim ke customers + rapikan nama/alamat.
--   (a) PT. Eka Jaya Internasional  → CUST959  (HP sama + alamat identik, Kav J No.1)
--   (b) PT. Jaya Kreasi Ind. Spectra → CUST1022 (site ke-3 dari nomor HRGA yang sama)
--
-- Lanjutan audit 21 Agu 2026 (lihat migrasi 133). Dari 6 klien maintenance dengan
-- customer_id NULL, dua ini punya pasangan yang jelas di tabel customers.
-- Tanpa customer_id, withMaintenanceLink() tidak pernah menautkan order baru ke
-- kontraknya (kuncinya HANYA customer_id — lihat src/lib/maintenanceLink.js).
--
-- (a) Nama customer salah ketik: "NASIONAL" → "INTERNASIONAL" (dikonfirmasi Owner
--     21 Agu 2026). Sufiks lokasi "BITUNG" dipertahankan karena pola multi-lokasi
--     repo ini = 1 baris customers per site (UNIQUE(phone,name)).
--
-- (b) 1 nomor HRGA (6287775196231) dipakai 4 lokasi Jaya Kreasi — ini kasus yang
--     sudah didokumentasikan di maintenanceLink.js. Dua site lain sudah tertaut
--     (Jalan Panjang→CUST176, Alam Sutera→CUST784), jadi Spectra→CUST1022 adalah
--     sisa yang cocok, diperkuat 2 order CUST1022 yang memang sudah ber-kontrak Spectra.
--     Alamat CUST1022 NULL → diisi dari alamat kontrak. Ini penting, bukan kosmetik:
--     findMaintClientByPhoneAddr() memakai ALAMAT untuk memilih site yang benar saat
--     satu nomor menunjuk banyak site. Tanpa alamat, popup pilih-unit tak bisa yakin.
--
-- TIDAK termasuk di sini (sengaja):
--   • PT. Transmarco Bojong Larang & PT. TRANSMARCO GUDANG → dikosongkan atas
--     keputusan Owner 21 Agu 2026.
--   • PT. Berkat Asia Kemasindo (19 unit, kontrak aktif) → belum ada baris customers
--     sama sekali; menunggu keputusan Owner apakah dibuatkan.
--   • 2 order PT JAYA KREASI MULTIGUNA (CUST678) yang saat ini salah tertaut ke
--     kontrak Spectra → menunggu keputusan Owner (lihat catatan di bawah).
--
-- Idempotent: semua statement bersyarat, aman dijalankan ulang.

BEGIN;

-- ── (a) PT Eka Jaya Internasional ──────────────────────────────────────────────
UPDATE customers
SET name = 'PT EKA JAYA INTERNASIONAL BITUNG',
    area = COALESCE(NULLIF(area, ''), 'Cikupa'),
    updated_at = now()
WHERE id = 'CUST959'
  AND name = 'PT EKA JAYA NASIONAL BITUNG';

UPDATE orders
SET customer = 'PT EKA JAYA INTERNASIONAL BITUNG'
WHERE customer_id = 'CUST959'
  AND customer <> 'PT EKA JAYA INTERNASIONAL BITUNG';

UPDATE maintenance_clients
SET customer_id = 'CUST959'
WHERE id = '3c093b6a-a56a-4d1f-b324-ddfafab038fb'
  AND customer_id IS NULL;

-- ── (b) PT Jaya Kreasi Indonesia Spectra ───────────────────────────────────────
UPDATE customers
SET address = 'JL. Jalur Sutera 23B No.17-18, RT.002/RW.006, Panunggangan Timur, Kec. Pinang, Kota Tangerang, Banten 15143',
    area = COALESCE(NULLIF(area, ''), 'Tangerang'),
    updated_at = now()
WHERE id = 'CUST1022'
  AND COALESCE(address, '') = '';

UPDATE maintenance_clients
SET customer_id = 'CUST1022'
WHERE id = '787e4170-9802-49d3-a7d1-12984c3c98e6'
  AND customer_id IS NULL;

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- SELECT mc.name, mc.customer_id, c.name, c.area, c.address
--   FROM maintenance_clients mc LEFT JOIN customers c ON c.id = mc.customer_id
--  WHERE mc.id IN ('3c093b6a-a56a-4d1f-b324-ddfafab038fb','787e4170-9802-49d3-a7d1-12984c3c98e6');
-- Sisa klien tanpa tautan (harusnya 3: 2 Transmarco + Berkat Asia):
-- SELECT name FROM maintenance_clients WHERE customer_id IS NULL ORDER BY name;

-- ── CATATAN untuk keputusan berikutnya (JANGAN jalankan tanpa konfirmasi) ──────
-- 2 order milik CUST678 (PT JAYA KREASI MULTIGUNA, komplek multiguna T8 No 51-52)
-- saat ini ber-maintenance_client_id kontrak SPECTRA, padahal Multiguna site berbeda
-- dan tidak punya kontrak. Akibatnya invoice/tunggakan Multiguna terhitung ke kontrak
-- Spectra. Kalau Owner setuju melepasnya:
--   UPDATE orders SET maintenance_client_id = NULL
--    WHERE id IN ('WA-1785498798278','WA-1783920005759') AND customer_id = 'CUST678';
