-- 129 — Hapus UNIQUE(client_id, unit_code) di maintenance_units
--
-- Alasan: unit_code hanya LABEL pelengkap (mis. kode SNI / model plate). Pembeda
-- identitas unit yang sebenarnya = lokasi/nama ruangan, dan secara teknis = kolom
-- surrogate `id` (PK). Penautan laporan→registry memakai `maint_unit_id` (= id),
-- BUKAN unit_code — jadi keunikan unit_code tidak dipakai untuk lookup apa pun.
--
-- Masalah nyata di lapangan: bulk input teknisi untuk unit identik (PK/model sama
-- di beberapa ruangan, mis. "GWC-18MOO5A/I" di Ruang 18 dan Ruang 15) diblok error
-- "Kode unit sudah dipakai di klien ini". Constraint ini salah untuk model bisnis:
-- AC model sama memang wajar berulang antar ruangan.
--
-- Identitas tetap aman: PK `id` unik, dan tautan servis pakai maint_unit_id.
-- Idempotent: IF EXISTS supaya aman dijalankan ulang.

ALTER TABLE maintenance_units
  DROP CONSTRAINT IF EXISTS maintenance_units_client_id_unit_code_key;

-- Jaga-jaga bila di environment lain constraint terwujud sebagai index lepas.
DROP INDEX IF EXISTS maintenance_units_client_id_unit_code_key;
