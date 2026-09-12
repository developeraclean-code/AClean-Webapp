-- 165 — Tutup seluruh review bonus April 2026 yang belum diinput.
--
-- Keputusan Owner 11 Sep 2026:
-- semua bonus April sudah diselesaikan manual. Kandidat bonus yang belum punya
-- order_bonuses dicatat sebagai Bonus Manual Rp 0 berstatus PAID agar tidak terus
-- muncul sebagai "Belum Di-review Bonus".
--
-- Daftar 31 Job ID di bawah adalah hasil aturan kandidat yang sama dengan UI
-- (bonusCandidateInfo) terhadap snapshot produksi 11 Sep 2026. Daftar eksplisit
-- mencegah order April biasa/non-kandidat ikut dibuatkan bonus nol.
-- Idempotent: NOT EXISTS + ON CONFLICT DO NOTHING, aman dijalankan ulang.

BEGIN;

WITH kandidat(order_id) AS (
  VALUES
    ('JOB720340551'),
    ('JOB723876283'),
    ('JOB786783830'),
    ('JOB953699936'),
    ('JOB445398435'),
    ('JOB-QWC51Z-C6V'),
    ('JOB-SADIG8-9G1'),
    ('JOB-SAF24D-VA1'),
    ('JOB-TPEH8U-MAA'),
    ('JOB-WMZ8TU-QX4'),
    ('JOB-ZHOWVX-E4L'),
    ('JOB-ZHYBBL-C60'),
    ('JOB-0UQ52T-0VO'),
    ('JOB-0UW5JX-5ZP'),
    ('JOB-0UXFI7-2AZ'),
    ('JOB-0UYAG1-TSP'),
    ('JOB-0V0OPD-PXG'),
    ('JOB-2E1SY9-C6A'),
    ('JOB-3T7UST-MJT'),
    ('JOB-802XHZ-CB7'),
    ('JOB-807NSP-UY3'),
    ('JOB-9GM1QH-MST'),
    ('JOB-AX9R20-LLJ'),
    ('JOB-CDMTTK-8CW'),
    ('JOB-GKSZYA-1GK'),
    ('JOB-GKYCIE-1WR'),
    ('WA-1777275779855'),
    ('WA-1777351573264'),
    ('JOB-KUEI74-0WA'),
    ('JOB-KUIU5C-B87'),
    ('WA-1777275666436')
)
INSERT INTO order_bonuses (
  order_id,
  order_date,
  bonus_type,
  team_members,
  total_amount,
  note,
  status,
  paid_at,
  paid_by,
  created_by
)
SELECT
  o.id,
  o.date,
  'manual',
  ARRAY(
    SELECT member
    FROM unnest(ARRAY[o.teknisi, o.teknisi2, o.teknisi3, o.helper, o.helper2, o.helper3])
         WITH ORDINALITY AS anggota(member, urutan)
    WHERE NULLIF(BTRIM(member), '') IS NOT NULL
    GROUP BY member
    ORDER BY MIN(urutan)
  ),
  0,
  'Baseline April 2026: pembayaran manual, nominal tidak tercatat',
  'PAID',
  TIMESTAMPTZ '2026-04-30 23:59:59+07',
  'Manual — pelunasan s/d April 2026',
  'Baseline manual April 2026'
FROM kandidat k
JOIN orders o ON o.id = k.order_id
WHERE o.date >= DATE '2026-04-01'
  AND o.date <= DATE '2026-04-30'
  AND NOT EXISTS (
    SELECT 1 FROM order_bonuses b WHERE b.order_id = o.id
  )
ON CONFLICT DO NOTHING;

COMMIT;

-- Verifikasi (target: 31 baris manual nol + 10 bonus aktual = 41 PAID April):
-- SELECT status, count(*), sum(total_amount) AS total
-- FROM order_bonuses
-- WHERE order_date BETWEEN DATE '2026-04-01' AND DATE '2026-04-30'
-- GROUP BY status;
--
-- SELECT count(*) AS baseline_nol
-- FROM order_bonuses
-- WHERE order_date BETWEEN DATE '2026-04-01' AND DATE '2026-04-30'
--   AND bonus_type = 'manual'
--   AND total_amount = 0
--   AND created_by = 'Baseline manual April 2026';

-- Rollback terarah (hanya 31 placeholder dari migrasi ini; migrasi 164 tidak berubah):
-- DELETE FROM order_bonuses
-- WHERE order_date BETWEEN DATE '2026-04-01' AND DATE '2026-04-30'
--   AND bonus_type = 'manual'
--   AND total_amount = 0
--   AND created_by = 'Baseline manual April 2026'
--   AND paid_by = 'Manual — pelunasan s/d April 2026';
