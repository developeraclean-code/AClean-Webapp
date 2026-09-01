-- Migration 160: tanggal beli + catatan pada unit stok (roll/tabung).
--
-- Keputusan Owner 1 Sep 2026. Saat admin/Owner menambah unit baru lewat
-- Inventori → "+ Tambah Unit", yang tersimpan hanya label, kapasitas, dan stok awal.
-- Tidak ada keterangan KAPAN unit itu masuk dan DARI MANA, sehingga audit stok
-- tidak bisa menjawab "roll ini dibeli kapan?" — padahal itu pertanyaan pertama
-- saat mencocokkan pemakaian dengan nota pembelian.
--
-- created_at TIDAK bisa dipakai untuk itu: ia mencatat kapan barisnya diketik,
-- bukan kapan barangnya dibeli. Unit yang baru diinput belakangan (backlog) akan
-- salah tanggal kalau memakai created_at.
--
-- purchase_date sengaja NULLABLE: unit lama (35 baris) tidak punya datanya dan
-- tidak boleh ditebak. Biarkan kosong — kosong yang jujur lebih baik daripada
-- tanggal karangan.
--
-- Kolom `notes` sudah ada sejak awal tapi tidak pernah diisi dari UI; mulai
-- sekarang dipakai untuk keterangan bebas (nomor nota, toko, kondisi awal).
--
-- Murni aditif: tidak ada RLS baru, tidak ada trigger, tidak menyentuh stok.

BEGIN;

ALTER TABLE inventory_units
  ADD COLUMN IF NOT EXISTS purchase_date date;

COMMENT ON COLUMN inventory_units.purchase_date IS
  'Tanggal unit ini dibeli/masuk gudang — diisi manual saat tambah unit. NULL = tidak diketahui (unit lama). Bukan created_at, yang hanya mencatat kapan barisnya diketik.';

COMMENT ON COLUMN inventory_units.notes IS
  'Keterangan bebas unit: nomor nota, toko, kondisi awal. Diisi dari Inventori → + Tambah Unit.';

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- SELECT unit_label, purchase_date, notes FROM inventory_units ORDER BY created_at DESC LIMIT 10;

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- ALTER TABLE inventory_units DROP COLUMN IF EXISTS purchase_date;
