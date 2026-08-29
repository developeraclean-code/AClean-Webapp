-- Migration 157: inventory.stock (agregat) = Σ inventory_units.stock untuk item tabung/roll
--
-- Why: material tabung/roll (freon/pipa/kabel) dilacak DUA kali — `inventory_units` (per
-- tabung/roll, dipakai teknisi & dipotong saat Konfirmasi Material) DAN `inventory.stock`
-- (agregat di menu Inventori). Pemotongan (usage tx) menurunkan KEDUANYA, tapi RESTOCK/tambah
-- tabung hanya menambah `inventory_units` — TIDAK insert transaksi masuk & tak menaikkan
-- `inventory.stock`. Akibatnya agregat cuma turun → MINUS (Kabel −46, Pipa −14,5, Freon −1,5…)
-- padahal stok per-tabung/roll positif & benar. `inventory_units` = sumber kebenaran.
--
-- Fix: untuk kode yang punya inventory_units, `inventory.stock` jadi CERMIN Σ unit non-archived,
-- dijaga oleh trigger di inventory_units. Trigger transaksi (usage/restock) DILEWATI untuk kode
-- itu supaya tak dobel-adjust. Item tanpa unit (armaplex, lakban, dll) tetap digerakkan trigger
-- transaksi seperti biasa. Ditutup dengan rekonsiliasi sekali (set agregat = Σ unit).

-- 1) Trigger: setiap perubahan inventory_units → inventory.stock = Σ unit non-archived kode itu
CREATE OR REPLACE FUNCTION sync_inventory_from_units()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $function$
DECLARE
  kode text;
  total numeric;
BEGIN
  kode := COALESCE(NEW.inventory_code, OLD.inventory_code);
  IF kode IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT COALESCE(SUM(stock), 0) INTO total
    FROM inventory_units
    WHERE inventory_code = kode AND COALESCE(archived, false) = false;
  UPDATE inventory
     SET stock = total,
         status = CASE
                    WHEN total <= 0         THEN 'OUT'
                    WHEN total <= min_alert THEN 'CRITICAL'
                    WHEN total <= reorder   THEN 'WARNING'
                    ELSE 'OK'
                  END,
         updated_at = NOW()
   WHERE code = kode;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_inventory_from_units ON inventory_units;
CREATE TRIGGER trg_sync_inventory_from_units
AFTER INSERT OR UPDATE OR DELETE ON inventory_units
FOR EACH ROW EXECUTE FUNCTION sync_inventory_from_units();

-- 2) Trigger transaksi (INSERT) — LEWATI kode yang punya inventory_units (dikelola trigger #1)
CREATE OR REPLACE FUNCTION update_inventory_stock()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $function$
DECLARE
  baru numeric;
  ada_unit boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM inventory_units WHERE inventory_code = NEW.inventory_code) INTO ada_unit;
  IF ada_unit THEN RETURN NEW; END IF;  -- stok agregat = Σ unit (trigger sync_inventory_from_units)

  SELECT stock + NEW.qty INTO baru FROM inventory WHERE code = NEW.inventory_code;
  UPDATE inventory
     SET stock = baru,
         status = CASE
                    WHEN baru <= 0         THEN 'OUT'
                    WHEN baru <= min_alert THEN 'CRITICAL'
                    WHEN baru <= reorder   THEN 'WARNING'
                    ELSE 'OK'
                  END,
         updated_at = NOW()
   WHERE code = NEW.inventory_code;
  RETURN NEW;
END;
$function$;

-- 3) Trigger transaksi (DELETE) — LEWATI kode yang punya inventory_units
CREATE OR REPLACE FUNCTION restore_inventory_stock()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $function$
DECLARE
  baru numeric;
  ada_unit boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM inventory_units WHERE inventory_code = OLD.inventory_code) INTO ada_unit;
  IF ada_unit THEN RETURN OLD; END IF;

  SELECT stock - OLD.qty INTO baru FROM inventory WHERE code = OLD.inventory_code;
  UPDATE inventory
     SET stock = baru,
         status = CASE
                    WHEN baru <= 0         THEN 'OUT'
                    WHEN baru <= min_alert THEN 'CRITICAL'
                    WHEN baru <= reorder   THEN 'WARNING'
                    ELSE 'OK'
                  END,
         updated_at = NOW()
   WHERE code = OLD.inventory_code;
  RETURN OLD;
END;
$function$;

-- 4) Rekonsiliasi sekali: set agregat = Σ unit non-archived untuk semua kode yang punya unit
UPDATE inventory i
SET stock = COALESCE((
      SELECT SUM(stock) FROM inventory_units u
      WHERE u.inventory_code = i.code AND COALESCE(u.archived, false) = false
    ), 0),
    updated_at = NOW()
WHERE EXISTS (SELECT 1 FROM inventory_units u WHERE u.inventory_code = i.code);

UPDATE inventory i
SET status = CASE
               WHEN i.stock <= 0         THEN 'OUT'
               WHEN i.stock <= i.min_alert THEN 'CRITICAL'
               WHEN i.stock <= i.reorder   THEN 'WARNING'
               ELSE 'OK'
             END
WHERE EXISTS (SELECT 1 FROM inventory_units u WHERE u.inventory_code = i.code);
