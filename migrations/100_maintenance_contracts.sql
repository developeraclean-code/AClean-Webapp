-- Migration 100: maintenance_contracts + maintenance_work_orders

-- ─────────────────────────────────────────────────────────────
-- 1. maintenance_contracts
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_contracts (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id         uuid NOT NULL REFERENCES maintenance_clients(id) ON DELETE CASCADE,
  contract_number   text NOT NULL,
  title             text,
  start_date        date NOT NULL,
  end_date          date NOT NULL,
  value             bigint,               -- total nilai kontrak (Rp)
  billing_cycle     text DEFAULT 'quarterly'
    CHECK (billing_cycle IN ('monthly','quarterly','biannual','annual','per_visit')),
  billing_amount    bigint,              -- nominal per billing cycle
  services_included jsonb DEFAULT '["cuci_rutin"]'::jsonb,  -- array service types covered
  visits_per_year   int DEFAULT 4,
  notes             text,
  status            text DEFAULT 'active'
    CHECK (status IN ('draft','active','expired','cancelled','renewed')),
  auto_invoice      boolean DEFAULT false,
  created_by        text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (client_id, contract_number)
);

CREATE INDEX IF NOT EXISTS idx_contracts_client ON maintenance_contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON maintenance_contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_end    ON maintenance_contracts(end_date);

ALTER TABLE maintenance_contracts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION mcontract_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mcontract_updated_at ON maintenance_contracts;
CREATE TRIGGER trg_mcontract_updated_at
  BEFORE UPDATE ON maintenance_contracts
  FOR EACH ROW EXECUTE FUNCTION mcontract_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. maintenance_work_orders
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_work_orders (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  wo_number      text NOT NULL UNIQUE,   -- e.g. WO-BSD-2026-001
  client_id      uuid NOT NULL REFERENCES maintenance_clients(id) ON DELETE CASCADE,
  contract_id    uuid REFERENCES maintenance_contracts(id) ON DELETE SET NULL,
  followup_id    uuid REFERENCES maintenance_followups(id) ON DELETE SET NULL,
  wo_type        text DEFAULT 'preventive'
    CHECK (wo_type IN ('preventive','corrective','emergency','inspection')),
  title          text NOT NULL,
  description    text,
  scheduled_date date,
  unit_ids       uuid[],                 -- unit yang akan dikerjakan
  assigned_to    text,                   -- nama teknisi utama
  status         text DEFAULT 'draft'
    CHECK (status IN ('draft','approved','in_progress','done','cancelled')),
  estimated_cost bigint,
  actual_cost    bigint,
  approved_by    text,
  approved_at    timestamptz,
  completed_at   timestamptz,
  invoice_id     text,                   -- link ke maintenance invoice
  notes          text,
  created_by     text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wo_client ON maintenance_work_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_wo_status ON maintenance_work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_date   ON maintenance_work_orders(scheduled_date);

ALTER TABLE maintenance_work_orders ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_wo_updated_at ON maintenance_work_orders;
CREATE TRIGGER trg_wo_updated_at
  BEFORE UPDATE ON maintenance_work_orders
  FOR EACH ROW EXECUTE FUNCTION mcontract_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. Seed kontrak PT Belfood BSD (contoh nyata)
-- ─────────────────────────────────────────────────────────────
INSERT INTO maintenance_contracts (
  client_id, contract_number, title,
  start_date, end_date,
  value, billing_cycle, billing_amount,
  services_included, visits_per_year,
  notes, status, created_by
)
VALUES (
  '39c6e2f9-4b01-4f52-be35-f69178d1fbbc',
  'KTR-BSD-2026-01',
  'Kontrak Maintenance AC — PT Belfood BSD',
  '2026-01-01', '2026-12-31',
  32520000,   -- total nilai: 4 x Rp 8.13jt
  'quarterly',
  8130000,    -- per kunjungan quarterly (28 unit cuci rutin ~Rp 290rb/unit)
  '["cuci_rutin","inspeksi"]'::jsonb,
  4,
  '33 unit AC, kunjungan per kuartal. PIC: Ibu Mega 6281360924972.',
  'active',
  'admin'
)
ON CONFLICT (client_id, contract_number) DO NOTHING;

SELECT 'Migration 100 selesai' AS status;
