-- 148 — Tautan balik job_materials_brought → ai_extractions, supaya link salah bisa dibatalkan.
--
-- MASALAH
-- Tombol "Link ke Job" di tab Pending AI Material menulis baris baru ke
-- job_materials_brought, lalu menandai extraction-nya 'linked'. Tidak ada jalan
-- kembali: kalau Owner/Admin salah pilih job, barisnya menempel di job yang salah
-- dan foto itu sudah hilang dari antrean sehingga tak bisa di-link ulang ke job
-- yang benar.
--
-- Kolom ini menyimpan asal barisnya, sehingga pembatalan bisa melakukan dua hal
-- sekaligus: menandai baris material CANCELLED, DAN mengembalikan extraction-nya
-- ke status 'pending' agar muncul lagi di antrean untuk di-link ke job yang tepat.
--
-- Pembatalan sengaja memakai status CANCELLED, bukan DELETE — jejaknya tetap ada
-- (siapa membatalkan & alasannya ditulis di notes), dan semua pembaca lain memang
-- sudah menyaring `status <> 'CANCELLED'`.

ALTER TABLE job_materials_brought
  ADD COLUMN IF NOT EXISTS source_extraction_id bigint;

COMMENT ON COLUMN job_materials_brought.source_extraction_id IS
  'ai_extractions.id asal baris ini (hasil tombol Link ke Job). NULL = diinput manual lewat modal Bawa Material. Lihat migrasi 148.';

CREATE INDEX IF NOT EXISTS idx_jmb_source_extraction
  ON job_materials_brought (source_extraction_id)
  WHERE source_extraction_id IS NOT NULL;

-- Backfill baris yang sudah terlanjur di-link (25 Agu 2026) supaya ikut bisa
-- dibatalkan. Mencocokkan job_id SAJA tidak cukup — satu job bisa punya beberapa
-- foto (kasus nyata: "bor markita" dan "pipa A4" sama-sama ke job yang sama, dan
-- kedua barisnya jadi menunjuk extraction yang sama). Jadi jenis material dan
-- nama barangnya ikut dicocokkan.
UPDATE job_materials_brought b
   SET source_extraction_id = e.id
  FROM ai_extractions e
 WHERE b.notes LIKE '%AI vision approved%'
   AND e.status = 'linked'
   AND e.linked_id = b.job_id
   AND lower(e.extracted->'items'->0->>'type') = lower(b.material_type)
   AND (
        lower(coalesce(e.extracted->'items'->0->>'brand', e.extracted->'items'->0->>'size', ''))
        = lower(coalesce(b.inventory_name, ''))
       );
