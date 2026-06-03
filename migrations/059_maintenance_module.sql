-- Migration 059: Modul Maintenance (B2B Asset Registry)
-- Fitur: customer korporat dengan banyak unit AC, registry aset, history servis,
--        portal token PERMANEN (toggle on/off + hide cost), invoice B2B.
-- Jalankan di Supabase SQL Editor.
--
-- KEAMANAN (PENTING): tabel ini RLS-RESTRICTIVE.
--   - TIDAK ada policy untuk anon → anon key (yang ada di bundle frontend publik) DIBLOK total.
--   - Semua akses lewat backend api/[route].js memakai SUPABASE_SERVICE_KEY (service_role bypass RLS).
--   - Ini mencegah customer baca biaya yang di-hide via anon key. Jangan tambah policy USING(true).

-- ─────────────────────────────────────────────────────────────
-- 1. maintenance_clients — perusahaan / klien kontrak
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_clients (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name             text NOT NULL,
  address          text,
  pic_name         text,
  pic_phone        text,                                  -- normalize 628xxx
  contract_status  text DEFAULT 'active' CHECK (contract_status IN ('active','inactive')),
  portal_token     text UNIQUE,                           -- token PERMANEN
  token_active     boolean DEFAULT true,                  -- toggle on/off akses
  token_expires_at timestamptz,                           -- NULL = permanen
  hide_costs       boolean DEFAULT true,                  -- sembunyikan biaya di portal
  customer_id      uuid,                                  -- link opsional ke tabel customers (untuk invoice)
  notes            text,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mclients_token ON maintenance_clients(portal_token);

-- ─────────────────────────────────────────────────────────────
-- 2. maintenance_units — aset AC per perusahaan (preset)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_units (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id         uuid NOT NULL REFERENCES maintenance_clients(id) ON DELETE CASCADE,
  unit_code         text NOT NULL,                        -- "AC-LT2-007"
  location          text,                                 -- "Lantai 2 - R. Meeting"
  brand             text,
  ac_type           text,                                 -- split|cassette|standing|floor
  capacity_pk       numeric,
  refrigerant       text,                                 -- R32|R410A|R22
  year_installed    int,
  serial_no         text,
  status            text DEFAULT 'active' CHECK (status IN ('active','rusak','retired')),
  last_service_date date,
  notes             text,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (client_id, unit_code)
);
CREATE INDEX IF NOT EXISTS idx_munits_client ON maintenance_units(client_id);

-- ─────────────────────────────────────────────────────────────
-- 3. maintenance_logs — history perbaikan per unit
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_logs (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id       uuid NOT NULL REFERENCES maintenance_units(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES maintenance_clients(id) ON DELETE CASCADE,
  service_date  date NOT NULL,
  service_type  text,                                     -- Cuci|Perbaikan|Isi Freon|Pasang|Cek
  technician    text,
  description   text,
  parts_used    jsonb DEFAULT '[]'::jsonb,
  cost          bigint,                                   -- di-strip backend kalau client.hide_costs
  photos        jsonb DEFAULT '[]'::jsonb,                -- array R2 key (before/after)
  order_id      uuid,                                     -- link opsional ke orders existing
  invoiced      boolean DEFAULT false,                    -- sudah masuk invoice B2B?
  created_by    text,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mlogs_unit ON maintenance_logs(unit_id);
CREATE INDEX IF NOT EXISTS idx_mlogs_client ON maintenance_logs(client_id);

-- ─────────────────────────────────────────────────────────────
-- 4. invoices — link opsional ke maintenance client (invoice B2B)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS maintenance_client_id uuid;

-- ─────────────────────────────────────────────────────────────
-- 5. RLS — restrictive (NO anon policy). Service role bypass RLS otomatis.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE maintenance_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_units   ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_logs    ENABLE ROW LEVEL SECURITY;
-- sengaja TIDAK ada CREATE POLICY → anon & authenticated (anon key) diblok total.

-- ─────────────────────────────────────────────────────────────
-- 6. Auto-update last_service_date saat log baru masuk
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mlog_touch_unit() RETURNS trigger AS $$
BEGIN
  UPDATE maintenance_units
     SET last_service_date = GREATEST(COALESCE(last_service_date, NEW.service_date), NEW.service_date)
   WHERE id = NEW.unit_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mlog_touch_unit ON maintenance_logs;
CREATE TRIGGER trg_mlog_touch_unit
  AFTER INSERT ON maintenance_logs
  FOR EACH ROW EXECUTE FUNCTION mlog_touch_unit();
