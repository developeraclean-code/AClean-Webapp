-- Migration 153: HPP material — simpan harga beli per satuan dasar (per meter / per kg / per pcs)
--
-- MASALAH (audit 28 Agu 2026): harga beli material tidak pernah tersimpan di mana pun.
--   - inventory: 27 item, kolom `price` = 0 SEMUA, `purchase_price` terisi cuma 2 item.
--   - RestockModal.jsx punya input "Harga Beli/Unit" tapi nilainya TIDAK PERNAH ditulis balik
--     ke inventory — hanya dipakai menghitung total expense lalu dibuang (RestockModal.jsx:79
--     cuma update stock). inventory_transactions tidak punya kolom harga sama sekali.
--   - Pembelian aslinya lewat menu Biaya: 73 nota Agustus (Rp 19,9jt), formatnya total rupiah
--     + nama barang teks bebas, tanpa qty/satuan, tak tertaut item inventori. Contoh 20 Agu:
--     "pipa 3/8 5/8" Rp 2.450.500 berisi pipa+ducttape+steam+kapasitor digabung satu baris.
--   Akibatnya field "Biaya Material Aktual" di modal Komisi (TeknisiAdminView.jsx:1947) 100%
--   ketik tangan → dari 95 baris order_bonuses hanya 18 yang punya material_cost, dan laporan
--   "Total Cost" pipa/kabel/freon di MatTrackView selalu Rp 0.
--
-- KEPUTUSAN OWNER (28 Agu 2026):
--   1. Metode HPP = RATA-RATA BERGERAK tertimbang, bukan harga beli terakhir.
--      (harga_terakhir tetap disimpan sebagai info/pembanding, TIDAK dipakai menghitung.)
--   2. Nota di menu Biaya TIDAK otomatis menambah stok — harus ditautkan manual oleh
--      Owner/Admin (AI nota bisa salah baca, dan banyak barang langsung dipakai di job).
--
-- PENTING — beda dua kolom harga yang gampang tertukar:
--   inventory.price          = harga JUAL. Dipakai pricing.js:302 sebagai fallback harga
--                              material ke invoice. JANGAN diisi harga beli.
--   inventory.purchase_price = harga BELI per satuan dasar (HPP). Kolom yang dipakai fitur ini.
--
-- Migrasi ini MURNI ADITIF: hanya menambah kolom + index. Tidak ada RLS baru — policy yang
-- sudah ada pada keempat tabel otomatis mencakup kolom baru. Tidak ada data yang diubah.
-- Idempotent: semua ADD COLUMN / CREATE INDEX pakai IF NOT EXISTS, aman di-run ulang.

BEGIN;

-- ── 1. inventory: metadata HPP + ukuran kemasan ──────────────────────────────
-- pack_size/pack_unit menjawab keluhan inti: barang dibeli per ROLL / per TABUNG / per DUS,
-- tapi dipakai per meter/kg. Konversinya harus tersimpan, bukan dihitung di kepala admin.
-- Contoh: Pipa AC Hoda 1PK → pack_size=30, pack_unit='roll' → nota Rp 900rb/roll otomatis
-- jadi HPP Rp 30.000/meter.
ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS purchase_price_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS purchase_price_source     text,      -- 'manual' | 'restock' | 'nota'
  ADD COLUMN IF NOT EXISTS purchase_price_last       numeric,   -- harga beli terakhir (info saja)
  ADD COLUMN IF NOT EXISTS pack_size                 numeric,   -- isi 1 kemasan dlm satuan dasar (30 m/roll, 5.4 kg/tabung)
  ADD COLUMN IF NOT EXISTS pack_unit                 text;      -- nama kemasan: 'roll', 'tabung', 'dus'

COMMENT ON COLUMN inventory.purchase_price IS
  'HPP per satuan dasar (kolom unit) — rata-rata bergerak tertimbang. Harga BELI, bukan jual.';
COMMENT ON COLUMN inventory.price IS
  'Harga JUAL per satuan — fallback harga material ke invoice (src/lib/pricing.js). Bukan HPP.';
COMMENT ON COLUMN inventory.pack_size IS
  'Isi 1 kemasan pembelian dalam satuan dasar (mis. 30 untuk roll pipa 30 meter). NULL = dibeli satuan.';

-- ── 2. inventory_transactions: ledger stok jadi ledger biaya juga ────────────
-- unit_cost disimpan PER TRANSAKSI supaya biaya material sebuah job dihitung dengan harga
-- yang berlaku SAAT ITU, bukan HPP hari ini (harga pipa/freon bergerak tiap bulan).
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS unit_cost  numeric,   -- HPP per satuan dasar saat transaksi
  ADD COLUMN IF NOT EXISTS total_cost numeric,   -- unit_cost * |qty|
  ADD COLUMN IF NOT EXISTS expense_id uuid;      -- tautan ke nota pembelian (expenses.id)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inv_tx_expense_id_fkey'
  ) THEN
    ALTER TABLE inventory_transactions
      ADD CONSTRAINT inv_tx_expense_id_fkey
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inv_tx_expense_id
  ON inventory_transactions (expense_id) WHERE expense_id IS NOT NULL;
-- Autosum biaya material bonus menyaring per job: order_id + qty negatif (pemakaian).
CREATE INDEX IF NOT EXISTS idx_inv_tx_order_id
  ON inventory_transactions (order_id) WHERE order_id IS NOT NULL;

-- ── 3. expenses: nota bisa menyebut qty + satuan + item inventori + job ──────
-- Tanpa qty, sebuah nota Rp 255.000 untuk "Kabel 3x1,5" tidak bisa diturunkan jadi harga
-- per meter. qty/unit/unit_cost diisi dari hasil baca AI nota (api/_ai-vision.js) atau
-- diketik admin saat menautkan ke stok.
-- order_id: banyak nota jelas untuk satu job ("BAPAK JOFINO - REY", "ibu sindhu - ardi") —
-- tautan ini yang membuat biaya material job bisa dijumlah otomatis untuk bonus margin.
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS inventory_code  text,      -- kode item inventori yang cocok
  ADD COLUMN IF NOT EXISTS qty             numeric,   -- jumlah dalam satuan `unit`
  ADD COLUMN IF NOT EXISTS unit            text,      -- satuan qty ('meter','kg','roll','pcs')
  ADD COLUMN IF NOT EXISTS unit_cost       numeric,   -- harga per satuan dasar hasil konversi
  ADD COLUMN IF NOT EXISTS order_id        text,      -- job yang memakai material ini
  ADD COLUMN IF NOT EXISTS stock_linked_at timestamptz, -- kapan nota ini jadi restock
  ADD COLUMN IF NOT EXISTS stock_linked_by text;

COMMENT ON COLUMN expenses.stock_linked_at IS
  'Terisi = nota ini SUDAH menambah stok (anti dobel-restock). NULL = belum ditautkan.';

CREATE INDEX IF NOT EXISTS idx_expenses_inventory_code
  ON expenses (inventory_code) WHERE inventory_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_order_id
  ON expenses (order_id) WHERE order_id IS NOT NULL;

-- ── 4. order_bonuses: jejak asal angka biaya material ────────────────────────
-- Supaya bisa dibedakan mana margin yang dihitung sistem dan mana yang diketik tangan.
ALTER TABLE order_bonuses
  ADD COLUMN IF NOT EXISTS material_cost_source text;  -- 'auto' | 'manual' | 'auto_edited'

COMMIT;

-- ── Verifikasi ────────────────────────────────────────────────────────────────
-- SELECT table_name, column_name FROM information_schema.columns
--  WHERE table_schema='public'
--    AND (   (table_name='inventory'               AND column_name IN ('purchase_price_updated_at','purchase_price_source','purchase_price_last','pack_size','pack_unit'))
--         OR (table_name='inventory_transactions'  AND column_name IN ('unit_cost','total_cost','expense_id'))
--         OR (table_name='expenses'                AND column_name IN ('inventory_code','qty','unit','unit_cost','order_id','stock_linked_at','stock_linked_by'))
--         OR (table_name='order_bonuses'           AND column_name = 'material_cost_source'))
--  ORDER BY table_name, column_name;
-- Harus mengembalikan 16 baris.

-- ── ROLLBACK ──────────────────────────────────────────────────────────────────
-- ALTER TABLE inventory DROP COLUMN IF EXISTS purchase_price_updated_at,
--   DROP COLUMN IF EXISTS purchase_price_source, DROP COLUMN IF EXISTS purchase_price_last,
--   DROP COLUMN IF EXISTS pack_size, DROP COLUMN IF EXISTS pack_unit;
-- ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inv_tx_expense_id_fkey;
-- ALTER TABLE inventory_transactions DROP COLUMN IF EXISTS unit_cost,
--   DROP COLUMN IF EXISTS total_cost, DROP COLUMN IF EXISTS expense_id;
-- ALTER TABLE expenses DROP COLUMN IF EXISTS inventory_code, DROP COLUMN IF EXISTS qty,
--   DROP COLUMN IF EXISTS unit, DROP COLUMN IF EXISTS unit_cost, DROP COLUMN IF EXISTS order_id,
--   DROP COLUMN IF EXISTS stock_linked_at, DROP COLUMN IF EXISTS stock_linked_by;
-- ALTER TABLE order_bonuses DROP COLUMN IF EXISTS material_cost_source;
