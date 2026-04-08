-- ═══════════════════════════════════════════════════════════════
-- SUPABASE DIAGNOSTICS untuk ARA Chat Brain Error
-- Jalankan queries ini di Supabase SQL Editor (Dashboard → SQL Editor)
-- ═══════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════
-- 1. CEK APAKAH TABEL ara_brain EXIST
-- ══════════════════════════════════════════════════════════════════
SELECT
  table_name,
  table_schema
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'ara_brain';

-- Expected output: Harus ada 1 row dengan table_name='ara_brain'
-- Jika kosong = TABEL TIDAK ADA → perlu dibuat


-- ══════════════════════════════════════════════════════════════════
-- 2. CEK STRUKTUR TABEL ara_brain (kolom apa saja)
-- ══════════════════════════════════════════════════════════════════
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ara_brain'
ORDER BY ordinal_position;

-- Expected columns: key (text), value (text)
-- Jika hasilnya kosong = TABEL TIDAK ADA


-- ══════════════════════════════════════════════════════════════════
-- 3. CEK ISI TABEL ara_brain
-- ══════════════════════════════════════════════════════════════════
SELECT * FROM ara_brain;

-- Expected: Minimal ada 1 row dengan key='brain_md' dan value=(isi brain)
-- Jika kosong = TABEL ADA TAPI DATA KOSONG
-- Jika tidak ada key 'brain_md' = MISSING KEY


-- ══════════════════════════════════════════════════════════════════
-- 4. CEK RLS POLICIES PADA TABEL ara_brain
-- ══════════════════════════════════════════════════════════════════
SELECT
  schemaname,
  tablename,
  policyname,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'ara_brain';

-- Expected: Ada minimal 1 policy untuk SELECT dengan condition auth.role() = 'authenticated'
-- Jika kosong = TIDAK ADA RLS POLICY → semua orang bisa baca (atau RLS disabled)
-- Jika ada tapi restrictive = MUNGKIN BLOCKED


-- ══════════════════════════════════════════════════════════════════
-- 5. CEK APAKAH RLS ENABLED PADA TABEL ara_brain
-- ══════════════════════════════════════════════════════════════════
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'ara_brain';

-- Expected: rowsecurity = true
-- Jika false = RLS TIDAK ENABLED → siapa saja bisa baca


-- ══════════════════════════════════════════════════════════════════
-- 6. COBA SELECT SEPERTI APLIKASI (simulasi auth user)
-- ══════════════════════════════════════════════════════════════════
SELECT
  key,
  CASE
    WHEN length(value) > 100 THEN substring(value, 1, 100) || '...'
    ELSE value
  END as value_preview,
  length(value) as value_length
FROM ara_brain
WHERE key IN ('brain_md', 'brain_customer');

-- Expected: Ada row(s) dengan key='brain_md' dan value bukan null
-- Jika error = RLS policy BLOCKED
-- Jika kosong = DATA BELUM ADA


-- ══════════════════════════════════════════════════════════════════
-- 7. DEBUG: CEK SEMUA TABEL YANG ADA (untuk lihat struktur DB)
-- ══════════════════════════════════════════════════════════════════
SELECT
  table_name,
  (SELECT count(*) FROM information_schema.columns
   WHERE information_schema.columns.table_name = information_schema.tables.table_name) as column_count
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Ini untuk lihat semua tabel apa saja yang ada di database


-- ══════════════════════════════════════════════════════════════════
-- 8. FIX JIKA TABEL TIDAK ADA - BUAT TABEL ara_brain
-- ══════════════════════════════════════════════════════════════════
-- JALANKAN INI HANYA JIKA QUERY 1 HASILNYA KOSONG!

CREATE TABLE IF NOT EXISTS ara_brain (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE ara_brain ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to read
CREATE POLICY "Allow authenticated read" ON ara_brain
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Policy: Allow authenticated users to write (optional, untuk admin)
CREATE POLICY "Allow authenticated write" ON ara_brain
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Insert default brain data
INSERT INTO ara_brain (key, value) VALUES
  ('brain_md', '# ARA BRAIN v5.1 — AClean Service Assistant

## Peran
Kamu adalah ARA (Aclean Robot Assistant), asisten AI untuk mengelola bisnis servis AC AClean.

## Kemampuan
- Kelola order, invoice, teknisi, material
- Monitor job, kirim WA, buat laporan
- Integrasi dengan WhatsApp Fonnte API

## Bahasa
Selalu jawab dalam Bahasa Indonesia, ringkas dan profesional.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- ══════════════════════════════════════════════════════════════════
-- 9. FIX: JIKA TABEL ADA TAPI RLS BERMASALAH
-- ══════════════════════════════════════════════════════════════════
-- Jalankan ini untuk RESET policies

DROP POLICY IF EXISTS "Allow authenticated read" ON ara_brain;
DROP POLICY IF EXISTS "Allow authenticated write" ON ara_brain;

ALTER TABLE ara_brain ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON ara_brain
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated write" ON ara_brain
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- ══════════════════════════════════════════════════════════════════
-- 10. VERIFY: Cek setelah fix
-- ══════════════════════════════════════════════════════════════════
SELECT
  'ara_brain table exists' as check_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='ara_brain'
  ) THEN '✅ YES' ELSE '❌ NO' END as result

UNION ALL

SELECT
  'brain_md data exists',
  CASE WHEN EXISTS (
    SELECT 1 FROM ara_brain WHERE key='brain_md' AND length(value) > 10
  ) THEN '✅ YES' ELSE '❌ NO' END

UNION ALL

SELECT
  'RLS enabled',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname='public' AND tablename='ara_brain' AND rowsecurity=true
  ) THEN '✅ YES' ELSE '❌ NO' END

UNION ALL

SELECT
  'SELECT policy exists',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ara_brain' AND policyname LIKE '%read%'
  ) THEN '✅ YES' ELSE '❌ NO' END;
