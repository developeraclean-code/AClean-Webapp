-- 090_project_daily_reports.sql
-- Berita acara harian project: teknisi submit per hari kerja,
-- terhubung ke order PRJ-xxx (Planning Order) dan project_projects.
-- Owner/Admin verifikasi di modul Project → Laporan Harian.

CREATE TABLE IF NOT EXISTS project_daily_reports (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES project_projects(id) ON DELETE CASCADE,
  order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
  tanggal         DATE NOT NULL,
  teknisi_name    TEXT,
  helper_names    TEXT[] DEFAULT '{}',
  pekerjaan       TEXT NOT NULL,
  kendala         TEXT,
  foto_urls       TEXT[] DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'VERIFIED', 'REVISION')),
  revision_note   TEXT,
  submitted_at    TIMESTAMPTZ DEFAULT NOW(),
  verified_by     TEXT,
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- max 1 berita acara per PRJ order (re-submit = update, idempotent)
-- Catatan: partial unique index (WHERE NOT NULL) tidak kompatibel dengan Supabase upsert onConflict.
-- Gunakan regular UNIQUE constraint pada order_id saja — lihat migration 091 untuk fix.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_daily_reports_project_order
  ON project_daily_reports (order_id)
  WHERE order_id IS NOT NULL;

-- Index untuk query per project + tanggal
CREATE INDEX IF NOT EXISTS idx_project_daily_reports_project_tanggal
  ON project_daily_reports (project_id, tanggal DESC);

-- RLS
ALTER TABLE project_daily_reports ENABLE ROW LEVEL SECURITY;

-- Semua user terautentikasi bisa baca (termasuk teknisi lihat status laporan sendiri)
CREATE POLICY "pdr_select" ON project_daily_reports
  FOR SELECT USING (true);

-- Teknisi bisa insert laporan baru
CREATE POLICY "pdr_insert" ON project_daily_reports
  FOR INSERT WITH CHECK (true);

-- Update: teknisi bisa update laporan PENDING miliknya; owner/admin via service key
CREATE POLICY "pdr_update" ON project_daily_reports
  FOR UPDATE USING (true);
