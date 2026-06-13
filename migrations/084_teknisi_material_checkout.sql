-- Migration 084: teknisi_material_checkout + material_checkout_items
-- Fitur "Material Harian Teknisi" — lapisan AUDIT/cross-check (anti-curang).
-- Pagi teknisi catat material yang DIBAWA, sore catat yang DIKEMBALIKAN.
-- Recon: used_implied (dibawa−dikembalikan) vs used_reported (pemakaian di laporan job).
-- CATATAN: TIDAK mengubah stok kantor (cross-check only). Berbeda & komplementer dgn
-- job_materials_brought (054) yang PER-JOB; tabel ini PER-HARI per teknisi. Jangan digabung.

-- ── Catalog material (opsional, untuk dropdown form) ──────────────────────────
CREATE TABLE IF NOT EXISTS material_checkout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_type text NOT NULL,                 -- 'pipa' | 'kabel' | 'freon' | 'lain'
  label text NOT NULL,                         -- "Pipa AC", "Kabel", "Freon R32"
  inventory_code text,                         -- nullable link ke inventory.code
  default_satuan text NOT NULL DEFAULT 'pcs',  -- 'meter' | 'kg' | 'tabung' | 'pcs'
  is_weighed boolean NOT NULL DEFAULT false,   -- true utk freon (ditimbang kg per tabung)
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(material_type, label)
);

-- ── Catatan harian per teknisi (pagi/pulang) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS teknisi_material_checkout (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teknisi_name text NOT NULL,
  teknisi_id uuid,                             -- nullable link user_profiles
  checkout_date date NOT NULL,                 -- hari kerja (join key ke inventory_transactions.job_date)
  session_type text NOT NULL CHECK (session_type IN ('pagi','pulang')),
  items jsonb NOT NULL DEFAULT '[]',           -- [{material_type,inventory_code,unit_id,unit_label,qty,satuan,weight_kg}]
  photo_url text,                              -- '/api/foto?key=material-checkout/...'
  ai_detected jsonb DEFAULT '{}',              -- {tabung_count, roll_count, confidence, raw}
  ai_status text NOT NULL DEFAULT 'PENDING' CHECK (ai_status IN ('PENDING','OK','MISMATCH','UNREADABLE','SKIPPED')),
  sender_phone text,
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app','wa')),
  created_by uuid,
  created_by_name text,
  notes text,
  warning_sent boolean NOT NULL DEFAULT false,
  reply_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(teknisi_name, checkout_date, session_type)  -- 1 pagi + 1 pulang per teknisi per hari (upsert/merge)
);

CREATE INDEX IF NOT EXISTS idx_tmc_tek_date ON teknisi_material_checkout(teknisi_name, checkout_date DESC);
CREATE INDEX IF NOT EXISTS idx_tmc_date     ON teknisi_material_checkout(checkout_date DESC);
CREATE INDEX IF NOT EXISTS idx_tmc_status   ON teknisi_material_checkout(ai_status, checkout_date DESC);

-- ── RLS (TO authenticated; webhook pakai service_role → bypass RLS) ──────────
ALTER TABLE material_checkout_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE teknisi_material_checkout ENABLE ROW LEVEL SECURITY;

CREATE POLICY mci_auth_all ON material_checkout_items   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY tmc_auth_all ON teknisi_material_checkout FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Seed catalog ─────────────────────────────────────────────────────────────
INSERT INTO material_checkout_items (material_type, label, default_satuan, is_weighed, sort_order) VALUES
  ('pipa',  'Pipa AC',     'meter', false, 1),
  ('kabel', 'Kabel',       'meter', false, 2),
  ('freon', 'Freon R32',   'kg',    true,  3),
  ('freon', 'Freon R22',   'kg',    true,  4),
  ('freon', 'Freon R410',  'kg',    true,  5)
ON CONFLICT (material_type, label) DO NOTHING;

-- ── Toggle di app_settings (pola cron toggle) ────────────────────────────────
INSERT INTO app_settings (key, value) VALUES
  ('material_checkout_enabled', 'true'),
  ('material_recon_alert_enabled', 'true'),
  ('material_recon_tolerances', '{"pipa":1.0,"kabel":1.0,"freon":0.3,"lain":1}')
ON CONFLICT (key) DO NOTHING;

-- ── Realtime publication (mirror pola existing) ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE teknisi_material_checkout; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

COMMENT ON TABLE teknisi_material_checkout IS 'Audit harian per teknisi: material dibawa (pagi) vs dikembalikan (pulang). Cross-check vs pemakaian laporan job. TIDAK ubah stok.';
COMMENT ON TABLE material_checkout_items IS 'Katalog material untuk form Material Harian (pipa/kabel/freon).';
