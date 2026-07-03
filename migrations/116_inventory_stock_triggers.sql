-- Migration 116: perbaiki trigger stok inventory + tambah trigger DELETE (restore).
--
-- (A) INSERT trigger update_inventory_stock: status 'WARN' → 'WARNING' agar sama dengan
--     frontend (computeStockStatus / InventoryView), yang selama ini bikin badge warning
--     tampil hijau (string tak match).
--
-- (B) AFTER DELETE trigger restore_inventory_stock: kembalikan stok saat transaksi dihapus.
--     Dipakai syncTrackedStock saat revisi laporan (hapus usage lama → insert baru). Dulu
--     syncTrackedStock pakai RECALC ABSOLUT (stock = sum semua tx) yang MENGHAPUS base stok
--     (seed awal tak tercatat sebagai transaksi) → stok pipa/freon ter-wipe ke 0. Kini master
--     stok murni incremental via trigger INSERT (potong) + DELETE (balikin).
--
-- ⚠️ CAVEAT: dengan trigger DELETE ini, BULK DELETE inventory_transactions akan meng-INFLATE
--     stok (tiap baris dibalikin). Jika suatu saat mau wipe histori, DISABLE trigger dulu:
--       ALTER TABLE inventory_transactions DISABLE TRIGGER trg_restore_stock;
--       DELETE FROM inventory_transactions; ...
--       ALTER TABLE inventory_transactions ENABLE TRIGGER trg_restore_stock;

CREATE OR REPLACE FUNCTION public.update_inventory_stock()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $function$
BEGIN
  UPDATE inventory
  SET
    stock  = GREATEST(0, stock + NEW.qty),
    status = CASE
               WHEN GREATEST(0, stock + NEW.qty) = 0             THEN 'OUT'
               WHEN GREATEST(0, stock + NEW.qty) <= min_alert     THEN 'CRITICAL'
               WHEN GREATEST(0, stock + NEW.qty) <= reorder       THEN 'WARNING'
               ELSE 'OK'
             END,
    updated_at = NOW()
  WHERE code = NEW.inventory_code;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_inventory_stock()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $function$
BEGIN
  UPDATE inventory
  SET
    stock  = GREATEST(0, stock - OLD.qty),
    status = CASE
               WHEN GREATEST(0, stock - OLD.qty) = 0             THEN 'OUT'
               WHEN GREATEST(0, stock - OLD.qty) <= min_alert     THEN 'CRITICAL'
               WHEN GREATEST(0, stock - OLD.qty) <= reorder       THEN 'WARNING'
               ELSE 'OK'
             END,
    updated_at = NOW()
  WHERE code = OLD.inventory_code;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_restore_stock ON inventory_transactions;
CREATE TRIGGER trg_restore_stock
  AFTER DELETE ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION restore_inventory_stock();
