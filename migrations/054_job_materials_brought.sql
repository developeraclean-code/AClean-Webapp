-- Migration 054: job_materials_brought
-- Track material yang dibawa teknisi/helper ke lokasi per job_id.
-- Workflow: teknisi pagi declare bawa tabung X → di laporan pre-filled
-- + soft-reserve stok supaya 2 teknisi tidak rebutan unit yang sama.

CREATE TABLE IF NOT EXISTS job_materials_brought (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES inventory_units(id) ON DELETE SET NULL,
  inventory_code text,
  inventory_name text,
  unit_label text,
  material_type text,
  qty_estimate numeric,
  qty_used numeric,
  brought_at timestamptz DEFAULT now(),
  brought_by text,
  used_at timestamptz,
  status text NOT NULL DEFAULT 'BROUGHT' CHECK (status IN ('BROUGHT','USED','RETURNED','CANCELLED')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jmb_job_id ON job_materials_brought(job_id);
CREATE INDEX IF NOT EXISTS idx_jmb_unit_status ON job_materials_brought(unit_id, status) WHERE unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jmb_brought_at ON job_materials_brought(brought_at DESC);

ALTER TABLE job_materials_brought ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jmb_select_all" ON job_materials_brought FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "jmb_insert_all" ON job_materials_brought FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "jmb_update_all" ON job_materials_brought FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "jmb_delete_all" ON job_materials_brought FOR DELETE TO anon, authenticated USING (true);

-- Realtime publication (optional, mirror existing pattern)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE job_materials_brought;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

COMMENT ON TABLE job_materials_brought IS 'Material yang dibawa teknisi per job (freon/pipa/kabel) — pre-fill laporan & soft-reserve stok';
COMMENT ON COLUMN job_materials_brought.status IS 'BROUGHT=dibawa belum dipakai, USED=sudah dipakai (laporan submit), RETURNED=balik ke stok, CANCELLED=batal';
