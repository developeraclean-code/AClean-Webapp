-- Migration 155: selaraskan kategori bonus dengan poster "SKEMA INSENTIF TERBARU 2025".
--
-- Keputusan Owner 26 Agu 2026 (poster fisik dilampirkan ke sesi). Dua perubahan:
--
-- A. NOMINAL menyesuaikan poster
--      thermis    35.000 → 25.000
--      install_2 100.000 →  50.000   (poster: PASANG 2 UNIT/HARI = 50.000)
--      install_3 200.000 → 150.000   (poster: PASANG 3 UNIT/HARI = 150.000)
--      install_4 300.000 → 300.000   (sudah sama)
--      freon      20.000 →  20.000   (sudah sama)
--      kapasitor  35.000 →  40.000   (lihat catatan di bawah)
--
--    Poster memisah KAPASITOR OUT 40.000 dan KAPASITOR IND 25.000, TAPI nama item di
--    invoice tidak bisa membedakannya: dari 62 job kapasitor, 53 (85%) tidak menyebut
--    Outdoor/Indoor sama sekali ("Kapasitor AC 0.5-1.5PK + Pasang", dst) — hanya 7 yang
--    jelas Outdoor dan 2 Indoor. Owner memutuskan TETAP SATU kategori. Nominal diambil
--    40.000 mengikuti mayoritas yang teridentifikasi (Outdoor); admin bisa menurunkan
--    manual di form input kalau ternyata Indoor.
--
--    Ambang OMSET (poster: >1jt / >1,5jt / >2,5jt per HARI) SENGAJA TIDAK diubah di sini —
--    perbaikan margin dikerjakan di repo terpisah (instruksi Owner). Jangan ubah margin_*
--    di migrasi ini tanpa instruksi baru.
--
-- B. KOLOM BARU exclude_keywords (logika ATAU: satu kata cocok → item dibuang)
--    detection_keywords ber-logika DAN, jadi tidak ada cara mempersempit lewat include —
--    menambah kata di sana malah memutus deteksi yang sah. exclude_keywords menutup itu.
--      freon     exclude ["pengisian"]     → buang "Jasa Pengisian Freon" (2 item):
--                                            freon milik customer, teknisi hanya jasa isi.
--      kapasitor exclude ["dari customer"] → buang "Jasa pasang Sparepart kapasitor
--                                            ( Kapasitor dari customer )" (1 item).
--    Sudah diverifikasi ke data: kedua keyword itu HANYA kena 3 item tsb, tidak ada
--    item sah yang ikut terbuang.
--
--    install_* sebelumnya menyimpan detection_keywords ["pemasangan unit"] — konfigurasi
--    MATI (kategori install ditentukan getInstallCumulative, bukan keyword). Dikosongkan
--    supaya tidak menyesatkan pembaca berikutnya.
--
-- Idempotent: menulis ulang seluruh array ke nilai final, aman dijalankan berulang.

BEGIN;

INSERT INTO app_settings (key, value)
VALUES ('bonus_categories', '[
  {"id":"margin_1jt","label":"Margin >1jt","amount":50000,"detection_keywords":[],"exclude_keywords":[]},
  {"id":"margin_2jt","label":"Margin >2jt","amount":100000,"detection_keywords":[],"exclude_keywords":[]},
  {"id":"margin_3jt","label":"Margin >3jt","amount":200000,"detection_keywords":[],"exclude_keywords":[]},
  {"id":"freon","label":"Isi Freon","amount":20000,"detection_keywords":["freon"],"exclude_keywords":["pengisian"]},
  {"id":"kapasitor","label":"Kapasitor","amount":40000,"detection_keywords":["kapasitor"],"exclude_keywords":["dari customer"]},
  {"id":"thermis","label":"Sparepart Thermis","amount":25000,"detection_keywords":["thermis"],"exclude_keywords":[]},
  {"id":"install_2","label":"Pasang 2 Unit/hari","amount":50000,"detection_keywords":[],"exclude_keywords":[]},
  {"id":"install_3","label":"Pasang 3 Unit/hari","amount":150000,"detection_keywords":[],"exclude_keywords":[]},
  {"id":"install_4","label":"Pasang 4 Unit/hari","amount":300000,"detection_keywords":[],"exclude_keywords":[]},
  {"id":"manual","label":"Bonus Manual","amount":0,"detection_keywords":[],"exclude_keywords":[]}
]')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- SELECT elem->>'id', elem->>'amount', elem->>'detection_keywords', elem->>'exclude_keywords'
--   FROM app_settings, jsonb_array_elements(value::jsonb) elem WHERE key='bonus_categories';

-- ── ROLLBACK (nilai persis sebelum migrasi ini) ───────────────────────────────
-- UPDATE app_settings SET value = '[
--   {"id":"margin_1jt","label":"Margin >1jt","amount":50000,"detection_keywords":[]},
--   {"id":"margin_2jt","label":"Margin >2jt","amount":100000,"detection_keywords":[]},
--   {"id":"margin_3jt","label":"Margin >3jt","amount":200000,"detection_keywords":[]},
--   {"id":"freon","label":"Isi Freon","amount":20000,"detection_keywords":["freon"]},
--   {"id":"kapasitor","label":"Kapasitor","amount":35000,"detection_keywords":["kapasitor"]},
--   {"id":"thermis","label":"Sparepart Thermis","amount":35000,"detection_keywords":["thermis"]},
--   {"id":"install_2","label":"Pasang >2 Unit/hari","amount":100000,"detection_keywords":["pemasangan unit"]},
--   {"id":"install_3","label":"Pasang >3 Unit/hari","amount":200000,"detection_keywords":["pemasangan unit"]},
--   {"id":"install_4","label":"Pasang >4 Unit/hari","amount":300000,"detection_keywords":["pemasangan unit"]},
--   {"id":"manual","label":"Bonus Manual","amount":0,"detection_keywords":[]}
-- ]' WHERE key='bonus_categories';
