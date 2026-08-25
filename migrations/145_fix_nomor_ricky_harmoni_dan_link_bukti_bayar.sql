-- 145 — Betulkan nomor HP BAPAK RICKY HARMONI (CUST420) + sambungkan bukti bayar
--       yang menggantung ke INV-20260822-NW17V.
--
-- MASALAH
-- Bukti transfer Rp190.000 (22 Agu 2026, BCA) terbaca sempurna oleh AI dan
-- tersimpan di payment_suggestions, tapi invoice_id-nya NULL selamanya:
--
--   nomor WA pengirim  : 628121047006   (0812-1047-006)  ← nomor asli
--   nomor di database  : 62812047006    (0812-047-006)   ← digit "1" hilang
--
-- Pencocokan bukti bayar memakai kesamaan nomor PERSIS (buildPhoneVariants hanya
-- menangani beda format 08/62/+62, bukan beda digit), jadi pencarian tidak pernah
-- punya peluang menemukan invoicenya. Akibatnya invoice tetap UNPAID + "Tanpa Bukti"
-- padahal customer sudah bayar.
--
-- Nomor salah ini ada sejak CUST420 dibuat (3 Mei 2026) dan menurun ke order &
-- invoice. Nomor benar dikonfirmasi Owner 25 Agu 2026: 08121047006.
-- Catatan: 0812 (Telkomsel) selalu 11-12 digit — "0812-047-006" hanya 10 digit,
-- jadi nomor lama memang tidak mungkin sah.
--
-- PENCEGAHAN (di kode, bukan di SQL): jaring pengaman toleransi 1 digit
--   - src/lib/phoneFuzzy.js          (helper + test)
--   - api/_handlers/wa.js            (saat bukti bayar masuk)
--   - src/lib/retroMatch.js          (saat invoice di-approve)
-- Toleransi hanya dipakai bila nominal SAMA PERSIS dan kandidatnya TEPAT SATU,
-- lalu hasilnya ditandai "fuzzy_1digit" + WA peringatan ke Owner untuk verifikasi.

BEGIN;

-- 1. Customer
UPDATE customers
   SET phone = '628121047006'
 WHERE id = 'CUST420' AND phone = '62812047006';

-- 2. Order (WA-1787364303599 = job invoice ini, JOB934870268 = job lama April)
UPDATE orders
   SET phone = '628121047006'
 WHERE customer_id = 'CUST420' AND phone = '62812047006';

-- 3. Invoice (NW17V yang bermasalah + ZDXDS lama)
UPDATE invoices
   SET phone = '628121047006'
 WHERE phone = '62812047006' AND customer = 'BAPAK RICKY HARMONI';

-- 4. Sambungkan bukti bayar yang menggantung ke invoicenya
UPDATE payment_suggestions
   SET invoice_id   = 'INV-20260822-NW17V',
       order_id     = 'WA-1787364303599',
       matched_at   = now(),
       match_source = 'manual_fix_145'
 WHERE id = '6540fbe6-70bc-428c-a023-78ddb8073802'
   AND invoice_id IS NULL;

-- 5. Tempelkan foto buktinya ke invoice supaya badge "Tanpa Bukti" hilang.
--    Status PAID TIDAK diubah di sini — Owner tetap klik "Tandai Lunas" manual
--    setelah melihat buktinya (konsisten dgn alur normal, tidak ada auto-PAID).
UPDATE invoices
   SET payment_proof_url = '/api/foto?key=wa-images%2Fbukti_transfer%2F1787374109517_628121047006.jpg',
       updated_at = now()
 WHERE id = 'INV-20260822-NW17V' AND payment_proof_url IS NULL;

COMMIT;
