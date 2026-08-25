-- 146 — Jejak audit koreksi admin atas material terpakai (sesi 'pulang').
--
-- LATAR
-- Angka "terpakai" di Material Harian dihitung otomatis: dibawa (pagi) − sisa
-- (pulang), keduanya dilaporkan teknisi sendiri. Kalau teknisi salah ukur sisa
-- atau lupa mencatat, stok ikut terpotong salah dan tidak ada jalan koreksi —
-- admin cuma bisa Confirm apa adanya atau Tolak seluruhnya.
--
-- Permintaan Owner (25 Agu 2026): admin boleh mengoreksi angka terpakai sebagai
-- double-check sebelum stok dipotong. Karena ini menyentuh stok, koreksinya WAJIB
-- meninggalkan jejak — tidak boleh jadi celah menyunting pemakaian diam-diam.
--
-- Kolom ini menyimpan daftar koreksi apa adanya:
--   [{ "key","unit_id","label","inventory_code","brought","returned",
--      "dari","jadi","oleh","pada","alasan" }]
-- Alasan wajib diisi di UI (min 5 karakter). Angka asli laporan teknisi di kolom
-- `items` TIDAK diubah — jadi laporan asli dan hasil koreksi bisa dibandingkan.
--
-- Jejak berlapis (sengaja tidak hanya satu tempat):
--   1. kolom ini                      — rincian per baris
--   2. teknisi_material_checkout.confirm_notes — alasan versi teks
--   3. inventory_transactions.notes   — menempel di transaksi stoknya sendiri
--   4. agent_logs (MATERIAL_KOREKSI_ADMIN, level WARNING) — muncul di Monitoring

ALTER TABLE teknisi_material_checkout
  ADD COLUMN IF NOT EXISTS admin_adjustments jsonb;

COMMENT ON COLUMN teknisi_material_checkout.admin_adjustments IS
  'Koreksi admin atas qty terpakai sebelum potong stok. NULL = tidak ada koreksi (angka murni dari laporan teknisi). Lihat migrasi 146.';
