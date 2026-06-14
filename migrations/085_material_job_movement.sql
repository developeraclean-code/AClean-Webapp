-- Migration 085: material_job_movement
-- Per-job Bawa/Pulang untuk PIPA & KABEL (freon ditangani harian di teknisi_material_checkout).
-- used = bawa - pulang (pemakaian fisik). FASE 1: deduct_status='CROSSCHECK' (belum potong stok).
-- FASE 2 akan pakai 'PENDING_CONFIRM' → owner confirm → deduct.

CREATE TABLE IF NOT EXISTS material_job_movement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('pipa','kabel')),
  inventory_code text NOT NULL,          -- SKU022.. / SKU025..
  type_label text,                       -- "1PK", "3x2,5"
  qty_bawa numeric NOT NULL DEFAULT 0,
  qty_pulang numeric,                    -- null sampai sesi Pulang diisi
  qty_used numeric GENERATED ALWAYS AS (CASE WHEN qty_pulang IS NULL THEN NULL ELSE qty_bawa - qty_pulang END) STORED,
  brought_by text,
  brought_at timestamptz DEFAULT now(),
  returned_at timestamptz,
  deduct_status text NOT NULL DEFAULT 'CROSSCHECK' CHECK (deduct_status IN ('CROSSCHECK','PENDING_CONFIRM','CONFIRMED','REJECTED')),
  confirmed_by text,
  confirmed_at timestamptz,
  deduct_tx_id text,                     -- referensi inventory_transactions saat deduct (idempotensi)
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mjm_job ON material_job_movement(job_id);
CREATE INDEX IF NOT EXISTS idx_mjm_status ON material_job_movement(deduct_status, created_at DESC);

ALTER TABLE material_job_movement ENABLE ROW LEVEL SECURITY;
CREATE POLICY mjm_auth_all ON material_job_movement FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Toggle & toleransi (dipakai mulai Fase 2)
INSERT INTO app_settings (key, value) VALUES
  ('material_movement_enabled', 'true'),
  ('material_deduct_tolerance', '{"pipa":1.0,"kabel":1.0}')
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE material_job_movement; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMENT ON TABLE material_job_movement IS 'Per-job Bawa/Pulang pipa & kabel. used=bawa-pulang. Fase 1 CROSSCHECK (no deduct); Fase 2 owner-confirm → deduct.';
