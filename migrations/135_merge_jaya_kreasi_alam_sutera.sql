-- Migration 135: Gabungkan customer duplikat Jaya Kreasi Alam Sutera (CUST784 → CUST678).
--
-- Dikonfirmasi Owner 21 Agu 2026: "komplek multiguna T8 No 51-52" (CUST678) dan
-- "Komplek Pergudangan T8 Kavling 50-56, Alam Sutera" (CUST784) adalah LOKASI YANG SAMA,
-- terduplikasi tidak sengaja saat onboarding maintenance.
--
-- Yang bertahan: CUST678 — memegang seluruh jejak nyata (6 order + 1 ac_unit).
-- CUST784 hanya menyimpan tautan kontrak dan 0 order, jadi memindahkan 1 tautan
-- jauh lebih kecil risikonya daripada memindahkan 6 order + unit.
--
-- Kolom customer_id di DB ini cuma ada di 4 tabel (ac_units, maintenance_clients,
-- orders, payment_logs) — dicek via information_schema, semuanya ditangani di bawah
-- supaya tidak ada baris yatim setelah CUST784 dihapus.
--
-- Sekalian: order JOB-4I2ZP5-LMC (4 Jul, "PT. Jaya Kreasi Indonesia - Alam Sutera")
-- punya maintenance_client_id kontrak Alam Sutera tapi customer_id NULL → di-backfill.
--
-- CATATAN nama: nama CUST678 ("PT JAYA KREASI MULTIGUNA") sengaja TIDAK diubah —
-- nama itu sudah tercetak di 6 order/invoice historis. Kalau Owner ingin seragam
-- dengan penamaan site lain (JALAN PANJANG / SPECTRA), ganti manual jadi
-- 'PT JAYA KREASI ALAM SUTERA' — aman, tidak ada logika yang bergantung pada nama ini.
--
-- Idempotent: semua statement bersyarat, aman dijalankan ulang.

BEGIN;

-- 1) Pindahkan tautan kontrak Alam Sutera ke customer yang bertahan.
UPDATE maintenance_clients
SET customer_id = 'CUST678'
WHERE customer_id = 'CUST784';

-- 2) Pindahkan sisa referensi (saat ini 0 baris, tapi tetap ditulis supaya migrasi
--    ini benar walau ada data baru masuk sebelum dijalankan).
UPDATE orders       SET customer_id = 'CUST678' WHERE customer_id = 'CUST784';
UPDATE ac_units     SET customer_id = 'CUST678' WHERE customer_id = 'CUST784';
UPDATE payment_logs SET customer_id = 'CUST678' WHERE customer_id = 'CUST784';

-- 3) Backfill order kontrak Alam Sutera yang customer_id-nya NULL.
UPDATE orders
SET customer_id = 'CUST678'
WHERE maintenance_client_id = 'efbcfa34-2ea7-4a87-ab2f-3534e24b81c3'
  AND customer_id IS NULL;

-- 4) Simpan jejak penggabungan + alamat versi lengkap dari baris yang dihapus,
--    supaya informasinya tidak hilang dan pencocokan alamat tetap punya bahan.
UPDATE customers
SET area = COALESCE(NULLIF(area, ''), 'Alam Sutera'),
    notes = trim(both ' ' from COALESCE(NULLIF(notes, ''), '') ||
      ' Digabung dari CUST784 (PT. JAYA KREASI INDONESIA) 21 Agu 2026 — lokasi sama.' ||
      ' Alamat versi lengkap: Komplek Pergudangan T8 Kavling 50-56, Alam Sutera.'),
    updated_at = now()
WHERE id = 'CUST678'
  AND COALESCE(notes, '') NOT LIKE '%Digabung dari CUST784%';

-- 5) Hapus baris duplikat. Dijalankan TERAKHIR, setelah semua referensi dipindah.
DELETE FROM customers WHERE id = 'CUST784';

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- Harus 0 baris:
-- SELECT 'orders' t, count(*) FROM orders WHERE customer_id = 'CUST784'
--  UNION ALL SELECT 'ac_units', count(*) FROM ac_units WHERE customer_id = 'CUST784'
--  UNION ALL SELECT 'payment_logs', count(*) FROM payment_logs WHERE customer_id = 'CUST784'
--  UNION ALL SELECT 'maint_clients', count(*) FROM maintenance_clients WHERE customer_id = 'CUST784'
--  UNION ALL SELECT 'customers', count(*) FROM customers WHERE id = 'CUST784';
-- Harus: kontrak Alam Sutera menunjuk CUST678, dan order Jaya Kreasi tak ada yang yatim:
-- SELECT mc.name, mc.customer_id FROM maintenance_clients mc WHERE mc.pic_phone = '6287775196231';
-- SELECT id, date, customer, customer_id FROM orders WHERE phone = '6287775196231' OR customer ILIKE '%jaya kreasi%' ORDER BY date;
