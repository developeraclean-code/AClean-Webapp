-- Migration 133: Tautkan customer "PT CATUR" (CUST1310) ke klien maintenance
--                "PT Sarana Catur Tirtakelola" + rapikan nama & backfill order.
--
-- Temuan 21 Agu 2026 (dari Planning Order: ketik 6285714121850 → sugesti cuma "PT CATUR"):
-- perusahaan yang sama tersimpan dua kali lewat dua pintu berbeda —
--   customers.CUST1310            = "PT CATUR",  phone 6285714121850 (nomor perusahaan)
--   maintenance_clients.d6bc1613… = "PT Sarana Catur Tirtakelola", pic_phone 6287820958051
-- dan maintenance_clients.customer_id = NULL, sehingga tidak ada yang menghubungkan.
-- Akibatnya 2 order Cleaning dari modul Maintenance (13 Agu) punya customer_id NULL →
-- tidak masuk riwayat/total belanja customer, dan auto-link kontrak (withMaintenanceLink,
-- kuncinya customer_id) tidak pernah kena untuk order berikutnya.
-- Alamat kedua record praktis identik (Jl. Irigasi Pamarayan, Cijeruk, Kibin, Serang) →
-- bukti kuat entitas yang sama; nomor berbeda karena satu nomor perusahaan, satu nomor PIC.
--
-- Idempotent: semua statement bersyarat, aman dijalankan ulang.

BEGIN;

-- 1) Nama lengkap sesuai kontrak + area terisi (dropdown Planning Order menampilkan
--    nama · HP · area; area kosong bikin baris sugesti melompong).
UPDATE customers
SET name = 'PT Sarana Catur Tirtakelola',
    area = COALESCE(NULLIF(area, ''), 'Serang'),
    updated_at = now()
WHERE id = 'CUST1310'
  AND name <> 'PT Sarana Catur Tirtakelola';

-- 2) Simpan nomor PIC di notes — customers hanya punya 1 kolom phone, dan nomor
--    utama harus tetap nomor perusahaan (dipakai order WA 21 Agu).
UPDATE customers
SET notes = trim(both ' ' from COALESCE(NULLIF(notes, ''), '') ||
      ' PIC kontrak: Bapak Alief Aji (6287820958051). Nomor utama 6285714121850 = nomor perusahaan.'),
    updated_at = now()
WHERE id = 'CUST1310'
  AND COALESCE(notes, '') NOT LIKE '%6287820958051%';

-- 3) Kunci penautan yang sebenarnya: maintenance_clients.customer_id.
UPDATE maintenance_clients
SET customer_id = 'CUST1310'
WHERE id = 'd6bc1613-918a-4700-8651-b80f456ca17d'
  AND customer_id IS NULL;

-- 4) Backfill 2 order maintenance yang yatim (sudah punya maintenance_client_id,
--    tapi customer_id NULL) → riwayat customer jadi utuh 3 order.
UPDATE orders
SET customer_id = 'CUST1310'
WHERE maintenance_client_id = 'd6bc1613-918a-4700-8651-b80f456ca17d'
  AND customer_id IS NULL;

-- 5) Samakan nama tampilan di order lama ("PT CATUR" → nama lengkap).
UPDATE orders
SET customer = 'PT Sarana Catur Tirtakelola'
WHERE customer_id = 'CUST1310'
  AND customer <> 'PT Sarana Catur Tirtakelola';

COMMIT;

-- ── Verifikasi (harus: 1 customer nama lengkap, 1 klien tertaut, 3 order customer_id terisi) ──
-- SELECT id, name, phone, area, notes FROM customers WHERE id = 'CUST1310';
-- SELECT id, name, customer_id FROM maintenance_clients WHERE id = 'd6bc1613-918a-4700-8651-b80f456ca17d';
-- SELECT id, customer, customer_id, maintenance_client_id, date, service FROM orders WHERE customer_id = 'CUST1310' ORDER BY date;
