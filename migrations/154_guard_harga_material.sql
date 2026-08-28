-- Migration 154: kunci kolom harga di `inventory` — hanya Owner/Admin boleh mengubahnya
--
-- TEMUAN (simulasi sesi asli, 28 Agu 2026): tabel `inventory` cuma punya SATU policy blanket
--   inventory_all  FOR ALL  USING (auth.role() = 'authenticated')
-- tanpa WITH CHECK dan tanpa pembedaan role. Dibuktikan dengan menyamar jadi Teknisi
-- (Hamdan, 3d9cced7-…): UPDATE inventory SET purchase_price=1 → 1 baris terubah.
--
-- Sebelum migrasi 153 dampaknya terbatas (kolom harga tak dipakai apa-apa, nilainya 0 semua).
-- Sesudahnya `purchase_price` jadi dasar biaya material job → dasar bonus margin, alias UANG:
-- teknisi bisa menolkan HPP material job-nya sendiri supaya profit tampak besar dan bonus
-- margin cair. Karena itu kolom harga dikunci sekarang, sekalian dengan fiturnya.
--
-- Kenapa TRIGGER, bukan mempersempit policy jadi Owner/Admin saja:
--   - `stock` di tabel yang sama masih harus bisa bergerak lewat jalur non-Owner (trigger
--     dari inventory_transactions saat teknisi submit laporan). Mengunci seluruh baris
--     akan mematikan pemotongan stok.
--   - Playbook repo: WITH CHECK menyaring BARIS; perubahan NILAI (OLD vs NEW) urusan trigger
--     — hanya trigger yang bisa membandingkan keduanya.
--
-- Yang dijaga: price (harga jual), purchase_price, purchase_price_last, pack_size, pack_unit.
-- Yang TETAP bebas: stock, status, reorder, min_alert, nama, dll — jalur operasional harian.
-- INSERT tidak dijaga (item baru memang dibuat Owner/Admin lewat UI yang sudah ter-gate).
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

BEGIN;

CREATE OR REPLACE FUNCTION guard_inventory_price_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  peran text;
BEGIN
  -- service_role (backend cron/API) lewat: tidak melalui JWT user.
  IF (SELECT auth.role()) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.price                IS DISTINCT FROM OLD.price
     OR NEW.purchase_price      IS DISTINCT FROM OLD.purchase_price
     OR NEW.purchase_price_last IS DISTINCT FROM OLD.purchase_price_last
     OR NEW.pack_size           IS DISTINCT FROM OLD.pack_size
     OR NEW.pack_unit           IS DISTINCT FROM OLD.pack_unit
  THEN
    peran := get_my_role();
    IF peran IS NULL OR peran NOT IN ('Owner', 'Admin') THEN
      RAISE EXCEPTION 'Hanya Owner/Admin yang boleh mengubah harga material (role: %)', COALESCE(peran, 'tidak dikenal')
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION guard_inventory_price_columns() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_guard_inventory_price ON inventory;
CREATE TRIGGER trg_guard_inventory_price
  BEFORE UPDATE ON inventory
  FOR EACH ROW
  EXECUTE FUNCTION guard_inventory_price_columns();

COMMIT;

-- ── Verifikasi (jalankan terpisah; keduanya harus sesuai harapan) ─────────────
-- Serangan — HARUS gagal 42501:
--   BEGIN; set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-teknisi>","role":"authenticated"}';
--   UPDATE inventory SET purchase_price = 1 WHERE code = 'SKU022';  -- expect: EXCEPTION
--   ROLLBACK;
-- Kerja normal Owner — HARUS lolos:
--   BEGIN; set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-owner>","role":"authenticated"}';
--   UPDATE inventory SET purchase_price = 30000 WHERE code = 'SKU022';  -- expect: 1 baris
--   ROLLBACK;
-- Stok teknisi TIDAK ikut terkunci — HARUS lolos:
--   UPDATE inventory SET stock = stock WHERE code = 'SKU022';  -- expect: 1 baris

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_guard_inventory_price ON inventory;
-- DROP FUNCTION IF EXISTS guard_inventory_price_columns();
