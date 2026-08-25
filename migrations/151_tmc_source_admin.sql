-- 151 — Izinkan source='admin' di teknisi_material_checkout.
--
-- BUG (dilaporkan Owner 25 Agu 2026: "+ Input Mewakili Teknisi error tidak bekerja")
-- Fitur input mewakili & pengisian sisa dari foto WA menulis source='admin', tapi
-- kolom itu punya CHECK yang hanya mengizinkan 'app' dan 'wa':
--   CHECK (source = ANY (ARRAY['app','wa']))
-- Jadi setiap INSERT ditolak database dengan 23514. Bukan RLS — sudah diuji,
-- Admin lolos policy INSERT; yang menolak constraint ini.
--
-- 'admin' dibuat sebagai nilai TERSENDIRI (bukan dipetakan ke 'app') supaya
-- sesi yang diisi admin mewakili teknisi tetap bisa dibedakan saat audit —
-- siapa yang benar-benar mengisi adalah informasi yang tidak boleh hilang.

ALTER TABLE teknisi_material_checkout
  DROP CONSTRAINT IF EXISTS teknisi_material_checkout_source_check;

ALTER TABLE teknisi_material_checkout
  ADD CONSTRAINT teknisi_material_checkout_source_check
  CHECK (source = ANY (ARRAY['app'::text, 'wa'::text, 'admin'::text]));

COMMENT ON COLUMN teknisi_material_checkout.source IS
  'app = diisi teknisi sendiri; wa = dari foto/teks grup lewat AI; admin = diisi Owner/Admin mewakili teknisi (lihat migrasi 151).';
