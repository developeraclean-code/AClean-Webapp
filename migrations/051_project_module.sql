-- Migration 051: Project Module (standalone)
-- Tujuan: skema database untuk modul Project (pemasangan + pipa, ducting, pekerjaan
--         di luar service reguler). BERDIRI SENDIRI dari tabel operasional utama:
--         semua tabel pakai prefix `project_`, tidak ada FK paksa ke orders/invoices/
--         customers. Supabase yang sama dipakai sebagai pintu masuk (auth + koneksi),
--         tapi isinya terpisah penuh dari bisnis utama AClean.
--
-- Dibuat: 2026-05-30
-- Jalankan di Supabase SQL Editor. Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Pola id: TEXT PK (di-generate frontend, mis. "p"+timestamp) — konsisten dgn modul.
--          default gen_random_uuid()::text sebagai fallback bila insert tanpa id.
-- Pola RLS: mirip migration 046 — anon (frontend) boleh SELECT/INSERT/UPDATE.
--           DELETE TIDAK ada policy anon → hanya service key (backend) yang bisa hapus.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) project_projects — master project
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_projects (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nama        TEXT NOT NULL,
  kategori    TEXT,
  lokasi      TEXT,
  pic         TEXT,
  status      TEXT NOT NULL DEFAULT 'BERJALAN'
              CHECK (status IN ('BERJALAN','FINISHING','SELESAI','HOLD')),
  progress    INT  NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  mulai       DATE,
  target      DATE,
  nilai       BIGINT NOT NULL DEFAULT 0,   -- nilai kontrak
  rab         BIGINT NOT NULL DEFAULT 0,   -- estimasi biaya / RAB
  tim         JSONB  NOT NULL DEFAULT '[]'::jsonb,  -- array nama tim
  prev_status TEXT,                        -- status sebelum HOLD (resume)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) project_dp — DP / termin pembayaran diterima
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_dp (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id  TEXT NOT NULL REFERENCES project_projects(id) ON DELETE CASCADE,
  tanggal     DATE,
  jumlah      BIGINT NOT NULL DEFAULT 0,
  ket         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_dp_project ON project_dp(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) project_materials — stok material project (gudang)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_materials (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nama        TEXT NOT NULL,
  sub         TEXT,                        -- sub-kategori
  satuan      TEXT,
  gudang      NUMERIC NOT NULL DEFAULT 0,  -- stok di gudang
  min_qty     NUMERIC NOT NULL DEFAULT 0,  -- ambang minimum (JS: "min")
  harga       BIGINT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) project_alokasi — alokasi material ke project (1 baris per material+project)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_alokasi (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  material_id TEXT NOT NULL REFERENCES project_materials(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES project_projects(id) ON DELETE CASCADE,
  qty         NUMERIC NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (material_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_project_alokasi_material ON project_alokasi(material_id);
CREATE INDEX IF NOT EXISTS idx_project_alokasi_project  ON project_alokasi(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) project_usage — pemakaian material per project + tanggal
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_usage (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id  TEXT NOT NULL REFERENCES project_projects(id) ON DELETE CASCADE,
  tanggal     DATE,
  material    TEXT,
  qty         TEXT,                        -- string "5 m" (qty + satuan)
  oleh        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_usage_project ON project_usage(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) project_tools — alat kerja project (terpisah dari Tas Teknisi reguler)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_tools (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nama        TEXT NOT NULL,
  jumlah      INT  NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'tersedia'
              CHECK (status IN ('tersedia','di lokasi','servis')),
  lokasi      TEXT NOT NULL DEFAULT '',    -- '' = gudang, selain itu = project_id
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) project_expenses — pengeluaran harian (project_id NULL = umum)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_expenses (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id  TEXT REFERENCES project_projects(id) ON DELETE SET NULL,
  tanggal     DATE,
  kategori    TEXT,
  ket         TEXT,
  nominal     BIGINT NOT NULL DEFAULT 0,
  oleh        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_expenses_project ON project_expenses(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) project_purchases — pembelian material & alat (project_id NULL = umum)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_purchases (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id  TEXT REFERENCES project_projects(id) ON DELETE SET NULL,
  tanggal     DATE,
  jenis       TEXT CHECK (jenis IN ('Material','Alat')),
  item        TEXT,
  qty         TEXT,                        -- string "2 set"
  total       BIGINT NOT NULL DEFAULT 0,
  nota        BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_purchases_project ON project_purchases(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) project_harian — laporan harian (1 baris per project+tanggal, sesi pagi/sore)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_harian (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id  TEXT NOT NULL REFERENCES project_projects(id) ON DELETE CASCADE,
  tanggal     DATE NOT NULL,
  oleh        TEXT,
  pagi        JSONB,   -- {jam, material, alat, foto}
  sore        JSONB,   -- {jam, progress, material, alat, foto}
  status      TEXT NOT NULL DEFAULT 'DRAFT'
              CHECK (status IN ('DRAFT','SUBMITTED','VERIFIED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, tanggal)
);
CREATE INDEX IF NOT EXISTS idx_project_harian_project ON project_harian(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) project_documents — dokumen / BAST (Surat Penerimaan/Pengiriman, Berita Acara)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_documents (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id        TEXT REFERENCES project_projects(id) ON DELETE SET NULL,
  jenis             TEXT,
  tanggal           DATE,
  nomor             TEXT,
  kepada            TEXT,
  periode           TEXT,
  uraian            TEXT,
  items             JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{nama,qty,satuan,ket}]
  foto              INT   NOT NULL DEFAULT 0,
  ttd_teknisi       TEXT,
  ttd_customer      TEXT,
  ttd_customer_img  TEXT,                                 -- data URL TTD virtual
  checklist         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{item,done}]
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11) Jembatan opsional: hubungkan order servis 'Project' ke entitas project.
--     Nullable + ON DELETE SET NULL → tidak ada ketergantungan keras ke modul.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS project_id TEXT
  REFERENCES project_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_project_id ON orders(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: enable + policy anon (SELECT/INSERT/UPDATE). DELETE = service key only.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'project_projects','project_dp','project_materials','project_alokasi',
    'project_usage','project_tools','project_expenses','project_purchases',
    'project_harian','project_documents'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_select_anon', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO anon USING (true);', t || '_select_anon', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_insert_anon', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO anon WITH CHECK (true);', t || '_insert_anon', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_update_anon', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO anon USING (true) WITH CHECK (true);', t || '_update_anon', t);
    -- DELETE: sengaja tidak dibuat policy anon (hanya service key)
  END LOOP;
END $$;
