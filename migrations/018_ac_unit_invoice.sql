-- Migration 018: AC Unit Invoice Support
-- Fitur: Invoice penjualan unit AC dengan paket pemasangan
-- Passthrough unit AC tidak masuk omset AClean, hanya jasa+material yang dihitung
-- Jalankan di Supabase SQL Editor.

-- ─────────────────────────────────────────────────────────────
-- 1. Extend tabel invoices
-- ─────────────────────────────────────────────────────────────

-- Tipe invoice: 'service' (default, semua invoice lama) | 'ac_unit_sale' (invoice unit AC baru)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type text DEFAULT 'service';

-- Nilai unit AC passthrough — tidak masuk omset, hanya untuk total tagihan customer
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS unit_ac_amount bigint DEFAULT 0;

-- Snapshot paket pemasangan yang dipilih saat invoice dibuat (JSON: key, label, harga, include[])
-- Disimpan sebagai snapshot agar perubahan harga paket di masa depan tidak mengubah histori invoice
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paket_pasang jsonb DEFAULT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2. invoice_items.item_type — expand constraint untuk nilai AC unit invoice
--    Nilai lama: 'labor', 'material', 'additional'
--    Nilai baru: + 'unit_ac', 'paket', 'jasa', 'addon'
-- ─────────────────────────────────────────────────────────────
ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_item_type_check;
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_item_type_check
  CHECK (item_type = ANY (ARRAY[
    'labor'::text, 'material'::text, 'additional'::text,
    'unit_ac'::text, 'paket'::text, 'jasa'::text, 'addon'::text
  ]));

-- ─────────────────────────────────────────────────────────────
-- 3. app_settings — seed data paket pemasangan default
--    Di-load oleh frontend saat buka modal Invoice Unit AC
--    Bisa diubah langsung dari UI tanpa migrasi ulang
-- ─────────────────────────────────────────────────────────────
INSERT INTO app_settings (key, value) VALUES (
  'ac_paket_list',
  '[
    {
      "key": "paket_05_1pk",
      "label": "Paket Pemasangan 0,5PK – 1PK",
      "harga": 1400000,
      "include": [
        { "nama": "Jasa Pemasangan Unit", "satuan": "Unit", "qty": 1 },
        { "nama": "Pipa AC Hoda 1PK", "satuan": "Meter", "qty": 4 },
        { "nama": "Kabel Control 3x1,5", "satuan": "Meter", "qty": 4 },
        { "nama": "Breket Outdoor", "satuan": "Set", "qty": 1 },
        { "nama": "Jasa Vacum AC", "satuan": "Unit", "qty": 1 },
        { "nama": "Duct Tape", "satuan": "Roll", "qty": 1 }
      ]
    },
    {
      "key": "paket_15_2pk",
      "label": "Paket Pemasangan 1,5PK – 2PK",
      "harga": 1600000,
      "include": [
        { "nama": "Jasa Pemasangan Unit", "satuan": "Unit", "qty": 1 },
        { "nama": "Pipa AC Hoda 2PK", "satuan": "Meter", "qty": 4 },
        { "nama": "Kabel Control 3x2,5", "satuan": "Meter", "qty": 4 },
        { "nama": "Breket Outdoor", "satuan": "Set", "qty": 1 },
        { "nama": "Jasa Vacum AC", "satuan": "Unit", "qty": 1 },
        { "nama": "Duct Tape", "satuan": "Roll", "qty": 1 }
      ]
    },
    {
      "key": "paket_25pk",
      "label": "Paket Pemasangan 2,5PK",
      "harga": 2000000,
      "include": [
        { "nama": "Jasa Pemasangan Unit", "satuan": "Unit", "qty": 1 },
        { "nama": "Pipa AC Hoda 2,5PK", "satuan": "Meter", "qty": 4 },
        { "nama": "Kabel Control 3x2,5", "satuan": "Meter", "qty": 4 },
        { "nama": "Breket Outdoor", "satuan": "Set", "qty": 1 },
        { "nama": "Jasa Vacum AC", "satuan": "Unit", "qty": 1 },
        { "nama": "Duct Tape", "satuan": "Roll", "qty": 1 }
      ]
    }
  ]'
) ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 4. Index untuk query laporan omset — filter invoice_type
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_type ON invoices(invoice_type);

-- ─────────────────────────────────────────────────────────────
-- VERIFIKASI — jalankan setelah migration untuk cek hasilnya:
-- ─────────────────────────────────────────────────────────────
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'invoices'
--   AND column_name IN ('invoice_type', 'unit_ac_amount', 'paket_pasang')
-- ORDER BY column_name;

-- SELECT key, LEFT(value::text, 60) FROM app_settings WHERE key = 'ac_paket_list';
