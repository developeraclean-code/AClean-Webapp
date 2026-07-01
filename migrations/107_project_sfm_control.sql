-- 107 — Project SFM control (additive, aman: semua kolom nullable / punya default)
-- Tujuan: tutup lubang kontrol material & siklus hidup project.
-- TIDAK menyentuh tabel bisnis reguler — hanya prefix project_*.

-- 1) project_usage: ledger COGS. Simpan material_id + qty numerik + snapshot harga
--    supaya pemakaian stok bisa dibebankan ke biaya (COGS) & direkonsiliasi ke alokasi.
ALTER TABLE project_usage
  ADD COLUMN IF NOT EXISTS material_id TEXT REFERENCES project_materials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qty_num     NUMERIC,          -- qty numerik (angka murni)
  ADD COLUMN IF NOT EXISTS harga       BIGINT DEFAULT 0; -- snapshot harga satuan saat dipakai
CREATE INDEX IF NOT EXISTS idx_project_usage_material ON project_usage(material_id);

-- 2) project_projects: metadata penutupan project.
ALTER TABLE project_projects
  ADD COLUMN IF NOT EXISTS selesai_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS catatan_selesai TEXT;

-- 3) project_tools: akuntabilitas pemegang & kondisi saat kembali.
ALTER TABLE project_tools
  ADD COLUMN IF NOT EXISTS pemegang TEXT,
  ADD COLUMN IF NOT EXISTS kondisi  TEXT;
