-- Migration 138: Deteksi bonus Freon cukup dengan kata "freon" (buang syarat "kuras vacum").
--
-- Keputusan Owner 22 Agu 2026: SEMUA pekerjaan yang namanya memuat "freon" masuk kategori
-- Freon — baik "Tambah Freon", "Kuras Vacum + Isi Freon", maupun sekadar "Freon R-32".
--
-- Masalah sebelumnya: detection_keywords = ["freon","kuras vacum"] dan pencocokannya
-- ber-logika DAN (semua keyword harus ada di nama item — lihat detectBonusFromInvoice()
-- di src/lib/bonus.js). Akibatnya "Tambah Freon R-22" TIDAK terdeteksi. Contoh nyata:
--   JOB-802XHZ-CB7  21 Apr  IBU AIDIA KIRANA        "Tambah Freon R-22"     Rp 450.000
--   JOB-GKYCIE-1WR  27 Apr  BAPAK DAVID YOUTHOLOGY  "Repair / Tambah Freon R-32" Rp 900.000
-- Di April 2026 saja: 22 job memuat "freon", hanya 13 terdeteksi → 9 luput.
--
-- Kenapa keyword tunggal "freon" (bukan menambah "vacum"/"r-32"):
--   - Cek data sejak Jan 2026: TIDAK ada item freon yang tanpa kata "freon" (semua varian
--     R-22/R-32/R-410 selalu menyertakan kata "freon"), jadi satu kata sudah menangkap semua.
--   - Sebaliknya ada 122 item "Jasa Vacum AC 0,5PK - 2,5PK" = vacuum saat instalasi, BUKAN
--     isi freon. Menambah keyword "vacum" akan salah memberi bonus ke 122 job itu.
--   - Keyword bersifat DAN, bukan ATAU — menambah keyword justru MEMPERSEMPIT, bukan memperluas.
--
-- Hanya mengubah detection_keywords kategori freon; label, amount (Rp 20.000 hasil setelan
-- Owner), dan seluruh kategori lain dipertahankan apa adanya. Urutan array dijaga.
--
-- Efeknya HANYA ke deteksi kandidat ("Layak bonus — BELUM di-input") di Rekap & Cetak /
-- Komisi Order. Baris order_bonuses yang sudah terlanjur dibuat TIDAK berubah.
--
-- Idempotent: hanya menyentuh baris yang keyword-nya belum ["freon"].

BEGIN;

UPDATE app_settings
SET value = (
  SELECT jsonb_agg(
           CASE WHEN elem->>'id' = 'freon'
                THEN jsonb_set(elem, '{detection_keywords}', '["freon"]'::jsonb)
                ELSE elem END
           ORDER BY ord
         )::text
  FROM jsonb_array_elements(app_settings.value::jsonb) WITH ORDINALITY AS t(elem, ord)
)
WHERE key = 'bonus_categories'
  AND value::jsonb @> '[{"id":"freon","detection_keywords":["freon","kuras vacum"]}]'::jsonb;

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- SELECT jsonb_pretty(value::jsonb) FROM app_settings WHERE key = 'bonus_categories';
-- Harus: kategori freon detection_keywords = ["freon"], amount tetap 20000,
--        9 kategori lain tidak berubah.

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- UPDATE app_settings SET value = (
--   SELECT jsonb_agg(CASE WHEN elem->>'id'='freon'
--            THEN jsonb_set(elem,'{detection_keywords}','["freon","kuras vacum"]'::jsonb)
--            ELSE elem END ORDER BY ord)::text
--     FROM jsonb_array_elements(app_settings.value::jsonb) WITH ORDINALITY AS t(elem, ord))
--  WHERE key='bonus_categories';
