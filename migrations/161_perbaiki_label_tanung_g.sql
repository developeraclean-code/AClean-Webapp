-- Migration 161: perbaiki salah ketik label unit "Tanung R32 - G" → "Tabung R32 - G".
--
-- Keputusan Owner 1 Sep 2026. Label unit ikut DISALIN (denormalisasi) ke beberapa
-- tabel saat transaksi dibuat, jadi mengubah inventory_units saja akan memutus
-- kesinambungan riwayat: unitnya "Tabung", jejak lamanya tetap "Tanung".
-- Karena itu keempat tempat diubah sekaligus, dalam satu transaksi.
--
-- Cakupan terverifikasi sebelum dijalankan (17 baris):
--   inventory_units.unit_label            1
--   inventory_transactions.unit_label     4
--   teknisi_material_checkout.items       10  (teks di dalam JSONB)
--   inventory_unit_stock_log.unit_label   2
--   inventory_transactions.notes          0  (tidak ada, tak perlu disentuh)
--   job_materials_brought.unit_label      0
--
-- Pencocokan sebenarnya di seluruh aplikasi memakai unit_id (UUID), BUKAN teks
-- label — jadi perubahan ini murni kosmetik dan tidak memindahkan stok apa pun.
-- Stok, qty, dan tautan job tidak disentuh sama sekali.
--
-- KONSEKUENSI yang disengaja: sesudah ini "Tabung" tidak lagi jadi kata pembeda
-- antara tabung K dan G (dulu hanya K yang mengandung "Tabung"). tebakUnit() akan
-- lebih sering MENYERAH dan menyerahkan pilihan ke admin — lebih aman, karena
-- menebak dari salah ketik bukan dasar yang benar. Lihat tebakUnit.test.js.
--
-- Idempotent: hanya menyentuh baris yang masih memuat "Tanung".

BEGIN;

UPDATE inventory_units
SET unit_label = replace(unit_label, 'Tanung', 'Tabung'), updated_at = now()
WHERE unit_label LIKE '%Tanung%';

UPDATE inventory_transactions
SET unit_label = replace(unit_label, 'Tanung', 'Tabung')
WHERE unit_label LIKE '%Tanung%';

UPDATE inventory_unit_stock_log
SET unit_label = replace(unit_label, 'Tanung', 'Tabung')
WHERE unit_label LIKE '%Tanung%';

-- items JSONB: label tersimpan di dalam elemen array, jadi diganti lewat teks
-- lalu dikembalikan ke jsonb. Aman karena "Tanung" hanya muncul sebagai label unit.
UPDATE teknisi_material_checkout
SET items = replace(items::text, 'Tanung', 'Tabung')::jsonb, updated_at = now()
WHERE items::text LIKE '%Tanung%';

COMMIT;

-- ── Verifikasi (semua harus 0) ────────────────────────────────────────────────
-- SELECT
--   (SELECT count(*) FROM inventory_units            WHERE unit_label ILIKE '%Tanung%') AS unit,
--   (SELECT count(*) FROM inventory_transactions     WHERE unit_label ILIKE '%Tanung%') AS trx,
--   (SELECT count(*) FROM inventory_unit_stock_log   WHERE unit_label ILIKE '%Tanung%') AS log,
--   (SELECT count(*) FROM teknisi_material_checkout  WHERE items::text ILIKE '%Tanung%') AS sesi;

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- Balikkan hanya unit G (jangan sentuh tabung lain yang memang bernama "Tabung"):
-- UPDATE inventory_units SET unit_label='Tanung R32 - G' WHERE id='a61027a8-a3f5-40a0-9bd2-ec4910319ba0';
-- UPDATE inventory_transactions SET unit_label='Tanung R32 - G' WHERE unit_id='a61027a8-a3f5-40a0-9bd2-ec4910319ba0';
-- UPDATE inventory_unit_stock_log SET unit_label='Tanung R32 - G' WHERE unit_id='a61027a8-a3f5-40a0-9bd2-ec4910319ba0';
