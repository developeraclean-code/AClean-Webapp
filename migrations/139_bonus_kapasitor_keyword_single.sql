-- Migration 139: Deteksi bonus Kapasitor cukup dengan kata "kapasitor".
--
-- Keputusan Owner 22 Agu 2026, lanjutan migrasi 138 (freon). Keyword lama
-- ["kapasitor ac"] ber-logika DAN sehingga nama yang tidak persis memuat frasa
-- "kapasitor ac" luput, padahal jelas pekerjaan kapasitor:
--   "Sparepart Kapasitor Fan Outdoor" (4x)      "Sparepart Kapasitor Outdoor"
--   "Jasa Pergantian Kapasitor Fan Indoor"      "Sparepart Kapasitor Fan"
--   "Kapasitor fan AC 2-2.5PK + Pasang"         "Repair / Jasa Pergantian Kapasitor Fan Indoor"
--
-- Sama seperti freon: memperluas cakupan = MENGURANGI keyword, karena pencocokan
-- ber-logika DAN (lihat detectBonusFromInvoice() di src/lib/bonus.js).
--
-- CATATAN untuk Owner: dengan ["kapasitor"], item "Jasa pasang Sparepart kapasitor
-- (Kapasitor dari customer)" IKUT terdeteksi — padahal barangnya milik customer,
-- teknisi hanya memasang. Kalau job seperti itu tidak layak bonus, tandai per-job
-- lewat tombol "🚫 Tidak Ada Bonus" di tab Komisi Order; tidak perlu ubah keyword
-- (menambah keyword hanya akan mempersempit dan memutus deteksi yang lain).
--
-- Idempotent: hanya menyentuh baris yang keyword-nya masih ["kapasitor ac"].

BEGIN;

UPDATE app_settings
SET value = (
  SELECT jsonb_agg(
           CASE WHEN elem->>'id' = 'kapasitor'
                THEN jsonb_set(elem, '{detection_keywords}', '["kapasitor"]'::jsonb)
                ELSE elem END
           ORDER BY ord
         )::text
  FROM jsonb_array_elements(app_settings.value::jsonb) WITH ORDINALITY AS t(elem, ord)
)
WHERE key = 'bonus_categories'
  AND value::jsonb @> '[{"id":"kapasitor","detection_keywords":["kapasitor ac"]}]'::jsonb;

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- SELECT elem->>'id', elem->>'detection_keywords' FROM app_settings,
--        jsonb_array_elements(value::jsonb) elem WHERE key='bonus_categories';

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- UPDATE app_settings SET value = (
--   SELECT jsonb_agg(CASE WHEN elem->>'id'='kapasitor'
--            THEN jsonb_set(elem,'{detection_keywords}','["kapasitor ac"]'::jsonb)
--            ELSE elem END ORDER BY ord)::text
--     FROM jsonb_array_elements(app_settings.value::jsonb) WITH ORDINALITY AS t(elem, ord))
--  WHERE key='bonus_categories';
