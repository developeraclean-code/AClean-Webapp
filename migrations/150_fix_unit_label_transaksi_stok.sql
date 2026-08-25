-- 150 — Betulkan unit_label di inventory_transactions: isinya nama MATERIAL, bukan tabung/roll.
--
-- MASALAH
-- Saat konfirmasi Material Harian, baris transaksi ditulis dengan
--   unit_label: l.unit_id ? l.label : null
-- padahal `l.label` adalah nama materialnya ("Freon R-32"), sementara nama fisik
-- tabung/roll-nya ("Tabung R32 - K") ada di data sesi tapi tidak ikut terbawa
-- oleh computeDayDeduct(). Akibatnya:
--   - riwayat stok tidak menyebut tabung/roll mana yang berkurang
--   - kalau teknisi membawa DUA roll dari material yang sama, keduanya tampil
--     sebagai baris kembar yang tidak bisa dibedakan sama sekali
-- unit_id-nya sendiri SELALU benar, jadi pemotongan stok per unit tidak pernah
-- salah — yang rusak hanya keterbacaannya.
--
-- Ditemukan 25 Agu 2026 saat Owner bertanya "kok tidak ada pilihan tabung/roll?".
-- Jawabannya: memang tidak perlu dipilih (sudah ditentukan teknisi di sesi pagi),
-- tapi memang tidak pernah ditampilkan.
--
-- Kode sudah diperbaiki (unit_label ikut terbawa dari items sesi + ditampilkan di
-- kartu konfirmasi). Migrasi ini merapikan 32 baris lama, diambil dari sumber yang
-- pasti benar: inventory_units.unit_label lewat unit_id.
--
-- TIDAK ADA ANGKA STOK YANG BERUBAH — hanya kolom nama.

UPDATE inventory_transactions t
   SET unit_label = u.unit_label
  FROM inventory_units u
 WHERE t.unit_id = u.id
   AND t.unit_label IS DISTINCT FROM u.unit_label;
