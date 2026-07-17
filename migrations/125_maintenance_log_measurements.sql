-- Migration 125: kolom measurements (jsonb) di maintenance_logs
-- Sprint 1 "kondisi AC terstruktur": selama ini kondisi/ampere/freon dari laporan
-- teknisi dilebur autolog jadi SATU string di kolom description ("Service Cleaning •
-- Kondisi: AC Dingin Kembali • Ampere 2.1") → tidak bisa dianalisa per unit
-- (tren ampere, frekuensi tambah freon = indikasi bocor, kondisi terakhir).
-- Kolom ini menyimpan data yang sama secara terstruktur; description tetap diisi
-- untuk tampilan history/portal (backward-compatible).
--
-- Bentuk isi (semua field opsional, dari laporan teknisi per unit):
-- {
--   "pekerjaan":       ["Service Cleaning", ...],
--   "kondisi_sebelum": ["AC Tidak Dingin", ...],
--   "kondisi_setelah": ["AC Dingin Kembali", ...],
--   "ampere":          2.1,          -- angka, dari ampere_akhir laporan
--   "freon_psi":       100           -- angka, TEKANAN freon psi (field laporan
-- }                                  --   freon_ditambah — labelnya "Tekanan Freon (psi)")
--
-- Log lama (pra-125) measurements = NULL → frontend fallback parse dari description
-- (lib/maintenanceHealth.js) supaya health badge tetap jalan untuk riwayat lama.

ALTER TABLE maintenance_logs
  ADD COLUMN IF NOT EXISTS measurements JSONB;

COMMENT ON COLUMN maintenance_logs.measurements IS
  'Data kondisi terstruktur per servis (pekerjaan/kondisi/ampere/freon_kg) dari laporan teknisi via autolog. NULL untuk log lama — fallback parse description di frontend.';
