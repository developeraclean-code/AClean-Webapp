-- Migration 136: Kembalikan cap kontrak 2 job Multiguna dari Spectra → Alam Sutera.
--
-- Keputusan Owner 21 Agu 2026: KONTRAK Jaya Kreasi memang satu, TAPI INVOICE dibuat
-- per lokasi supaya tidak membingungkan. Artinya struktur sekarang (1 baris
-- maintenance_clients per lokasi, invoice menempel ke lokasinya) sudah benar —
-- yang salah hanya 2 job yang capnya nyasar ke lokasi lain.
--
-- Dua job ini dikerjakan di "komplek multiguna T8 No 51-52" (= site Alam Sutera,
-- dikonfirmasi Owner saat penggabungan CUST784→CUST678 di migrasi 135), tapi
-- ber-maintenance_client_id kontrak SPECTRA (site Jalur Sutera, tempat berbeda):
--   WA-1785498798278  31 Jul  Survey    (tanpa invoice)
--   WA-1783920005759  13 Jul  Cleaning  → INV-20260713-G4LPK (Rp 270.000, PAID)
-- Akibatnya riwayat & rekap tagihan Spectra kelebihan 1 invoice, Alam Sutera kurang.
--
-- Job Spectra yang ASLI (WA-1784689608639 Repair, WA-1784015915739 Complain, milik
-- CUST1022) sengaja TIDAK disentuh — itu memang pekerjaan di site Spectra.
--
-- Tidak ada dampak uang: seluruh invoice Jaya Kreasi sudah PAID. Ini murni koreksi
-- atribusi lokasi untuk riwayat & laporan per lokasi.
--
-- Akar masalahnya sendiri sudah tertutup oleh migrasi 133-135: penautan kontrak
-- memakai customer_id (withMaintenanceLink), dan sekarang setiap site sudah punya
-- customer_id + alamat yang benar — jadi order WA berikutnya tidak akan salah site lagi.
--
-- Idempotent: bersyarat pada nilai lama, aman dijalankan ulang.

BEGIN;

-- 1) Order: Spectra → Alam Sutera, hanya untuk job milik CUST678 (site Multiguna).
UPDATE orders
SET maintenance_client_id = 'efbcfa34-2ea7-4a87-ab2f-3534e24b81c3'
WHERE id IN ('WA-1785498798278', 'WA-1783920005759')
  AND customer_id = 'CUST678'
  AND maintenance_client_id = '787e4170-9802-49d3-a7d1-12984c3c98e6';

-- 2) Invoice yang menempel pada job tersebut ikut pindah, kalau tidak rekap tagihan
--    per lokasi tetap salah walau ordernya sudah benar.
UPDATE invoices
SET maintenance_client_id = 'efbcfa34-2ea7-4a87-ab2f-3534e24b81c3'
WHERE job_id IN ('WA-1785498798278', 'WA-1783920005759')
  AND maintenance_client_id = '787e4170-9802-49d3-a7d1-12984c3c98e6';

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- Harapan: Alam Sutera 3 order / 2 invoice, Spectra 2 order / 2 invoice.
-- SELECT mc.name,
--        (SELECT count(*) FROM orders o   WHERE o.maintenance_client_id = mc.id) AS order_bercap,
--        (SELECT count(*) FROM invoices i WHERE i.maintenance_client_id = mc.id) AS invoice_bercap
--   FROM maintenance_clients mc WHERE mc.pic_phone = '6287775196231' ORDER BY mc.name;
-- Tidak boleh ada job CUST678 yang bercap Spectra:
-- SELECT id, customer_id, maintenance_client_id FROM orders
--  WHERE customer_id = 'CUST678' AND maintenance_client_id = '787e4170-9802-49d3-a7d1-12984c3c98e6';
