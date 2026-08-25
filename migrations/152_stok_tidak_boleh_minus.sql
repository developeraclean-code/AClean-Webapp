-- 152 — Stok tidak boleh minus, dan kelebihan pakai tidak boleh disembunyikan.
--
-- TEMUAN (simulasi 20 skenario, 25 Agu 2026)
-- Skenario 15: roll bersisa 2 meter dipotong 30 meter → database menerimanya
-- menjadi -28. Tidak ada CHECK sama sekali di kolom stok.
--
-- Lebih dalam lagi, kelebihan pakai memang SENGAJA disembunyikan di dua lapis:
--   1. aplikasi  : Math.max(0, stock - qty)      (MaterialConfirmTab)
--   2. database  : GREATEST(0, stock + NEW.qty)  (trigger update_inventory_stock)
-- Jadi kalau laporan mengklaim pakai 30 m padahal roll hanya berisi 2 m, sistem
-- diam-diam menulis 0 dan tidak ada satu pun jejak bahwa ada klaim 28 m yang
-- mustahil. Ini persis celah yang bisa dipakai memanipulasi stok kemudian hari.
-- Bukti nyata: 30 hari terakhir, 7 dari 114 pemotongan menimpa material berstok 0.
--
-- KEPUTUSAN OWNER: kunci ketat.
--
-- Dua lapis penjaga, dengan sifat berbeda karena siapa yang bisa memperbaikinya
-- juga berbeda:
--
-- A. inventory_units.stock (per tabung/roll) → CHECK >= 0, MENOLAK KERAS.
--    Hanya disentuh jalur Konfirmasi Material, dan yang menekannya adalah
--    Owner/Admin — pihak yang memang bisa membetulkan angka stok. Aplikasi
--    memeriksa lebih dulu dan memberi pesan jelas, jadi constraint ini adalah
--    jaring terakhir, bukan yang pertama dilihat orang.
--
-- B. inventory.stock (agregat) → berhenti meng-GREATEST, pakai angka sebenarnya.
--    Sengaja TIDAK menolak keras: kolom ini juga diubah oleh submit laporan
--    teknisi, dan teknisi tidak punya wewenang memperbaiki data stok — memblokir
--    di sana hanya akan menghentikan pekerjaan tanpa menyelesaikan apa pun.
--    Dengan angka sebenarnya, kelebihan pakai muncul sebagai stok MINUS yang
--    kasat mata di layar Stok & Tracking — bukti yang tidak bisa dihapus diam-diam.
--
-- Diverifikasi sebelum dijalankan: 0 unit minus, 0 material minus, jadi constraint
-- di bawah tidak akan menolak data yang sudah ada.

BEGIN;

-- A. Penjaga keras untuk stok per tabung/roll
ALTER TABLE inventory_units
  DROP CONSTRAINT IF EXISTS inventory_units_stock_tidak_minus;
ALTER TABLE inventory_units
  ADD CONSTRAINT inventory_units_stock_tidak_minus CHECK (stock >= 0);

-- B. Agregat: catat apa adanya, jangan disembunyikan
CREATE OR REPLACE FUNCTION public.update_inventory_stock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  baru numeric;
BEGIN
  SELECT stock + NEW.qty INTO baru FROM inventory WHERE code = NEW.inventory_code;
  UPDATE inventory
     SET stock = baru,
         status = CASE
                    WHEN baru < 0            THEN 'OUT'
                    WHEN baru = 0            THEN 'OUT'
                    WHEN baru <= min_alert   THEN 'CRITICAL'
                    WHEN baru <= reorder     THEN 'WARNING'
                    ELSE 'OK'
                  END,
         updated_at = NOW()
   WHERE code = NEW.inventory_code;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_inventory_stock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  baru numeric;
BEGIN
  SELECT stock - OLD.qty INTO baru FROM inventory WHERE code = OLD.inventory_code;
  UPDATE inventory
     SET stock = baru,
         status = CASE
                    WHEN baru <= 0           THEN 'OUT'
                    WHEN baru <= min_alert   THEN 'CRITICAL'
                    WHEN baru <= reorder     THEN 'WARNING'
                    ELSE 'OK'
                  END,
         updated_at = NOW()
   WHERE code = OLD.inventory_code;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_inventory_stock() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_inventory_stock() FROM PUBLIC, anon;

COMMIT;
