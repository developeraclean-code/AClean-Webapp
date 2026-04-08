# 🔍 Panduan Diagnosis ARA Chat Brain Error

## Langkah-Langkah

### 1. **Buka Supabase Dashboard**
   - Login ke [https://supabase.com](https://supabase.com)
   - Pilih project AClean
   - Klik menu **SQL Editor** (kiri)

### 2. **Jalankan Diagnostic Queries**

Buka file `SUPABASE_DIAGNOSTICS.sql` dan jalankan query-query berikut **secara berurutan**:

---

## Query 1: Cek Tabel Exist

```sql
SELECT
  table_name,
  table_schema
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'ara_brain';
```

**Hasil yang diharapkan:**
- ✅ Ada 1 row → `table_name = ara_brain` → Tabel exist, lanjut query 2
- ❌ Kosong (0 rows) → Tabel TIDAK ada → Perlu FIX (Query 8)

---

## Query 2: Cek Struktur Kolom

```sql
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ara_brain'
ORDER BY ordinal_position;
```

**Hasil yang diharapkan:**
- ✅ Ada kolom: `key` (text), `value` (text), dan mungkin `created_at`, `updated_at`
- ❌ Kosong → Tabel tidak ada atau tidak bisa diakses

---

## Query 3: Cek Data di Tabel

```sql
SELECT * FROM ara_brain;
```

**Hasil yang diharapkan:**
- ✅ Minimal 1 row dengan `key = 'brain_md'` dan `value` berisi isi brain (panjang > 100 karakter)
- ⚠️ Ada row dengan key='brain_md' tapi value kosong/NULL → Data corrupt
- ❌ Kosong (0 rows) → Tabel exist tapi DATA KOSONG → Perlu insert data (Query 8 bagian akhir)

---

## Query 4: Cek RLS Policy

```sql
SELECT
  schemaname,
  tablename,
  policyname,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'ara_brain';
```

**Hasil yang diharapkan:**
- ✅ Ada 1-2 policy dengan `policyname` seperti "Allow authenticated read" atau "Allow read"
- ✅ Kolom `qual` mengandung `auth.role() = 'authenticated'` atau similar
- ❌ Kosong → Tidak ada RLS policy (mungkin RLS disabled) → Perlu FIX (Query 9)
- ❌ Ada policy tapi qual-nya restrictive → Mungkin blocked akses

---

## Query 5: Cek RLS Status

```sql
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'ara_brain';
```

**Hasil yang diharapkan:**
- ✅ `rowsecurity = true` → RLS enabled ✅
- ❌ `rowsecurity = false` → RLS NOT enabled (tapi mungkin tidak masalah jika policy ada)

---

## Query 6: Simulasi Select Seperti Aplikasi

```sql
SELECT
  key,
  CASE
    WHEN length(value) > 100 THEN substring(value, 1, 100) || '...'
    ELSE value
  END as value_preview,
  length(value) as value_length
FROM ara_brain
WHERE key IN ('brain_md', 'brain_customer');
```

**Hasil yang diharapkan:**
- ✅ Ada row dengan `key = 'brain_md'` dan `value_length > 100`
- ❌ Error (permission denied) → RLS policy blocked
- ❌ Kosong → Data tidak ada

---

## 🛠️ Jika Error, Jalankan FIX

### **FIX 1: Tabel Tidak Ada (Query 1 kosong)**

Jalankan **Query 8** lengkap (CREATE TABLE + RLS + INSERT DATA):

```sql
CREATE TABLE IF NOT EXISTS ara_brain (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE ara_brain ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON ara_brain
  FOR SELECT
  USING (auth.role() = 'authenticated');

INSERT INTO ara_brain (key, value) VALUES
  ('brain_md', '# ARA BRAIN v5.1 — AClean Service Assistant
...')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

Lalu jalankan **Query 10** untuk verify.

---

### **FIX 2: RLS Policy Bermasalah (Query 4 kosong atau restrictive)**

Jalankan **Query 9** (RESET RLS policies):

```sql
DROP POLICY IF EXISTS "Allow authenticated read" ON ara_brain;
DROP POLICY IF EXISTS "Allow authenticated write" ON ara_brain;

ALTER TABLE ara_brain ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON ara_brain
  FOR SELECT
  USING (auth.role() = 'authenticated');
```

Lalu jalankan **Query 10** untuk verify.

---

## 📊 Diagnostic Checklist

Setelah menjalankan semua query, cek hasil di bawah ini:

| Check | Query | Expected | Status |
|-------|-------|----------|--------|
| Tabel exist | 1 | 1 row | ☐ |
| Kolom structure | 2 | key + value columns | ☐ |
| Data ada | 3 | key='brain_md' | ☐ |
| RLS Policy | 4 | 1-2 policies exist | ☐ |
| RLS enabled | 5 | rowsecurity=true | ☐ |
| Akses OK | 6 | 1+ rows with key='brain_md' | ☐ |
| Verify fix | 10 | All checks ✅ | ☐ |

---

## 📝 Kirim Screenshot

Setelah selesai diagnostics, **kirim hasil dari Query 10** (verification check):

```
SELECT
  'ara_brain table exists' as check_name,
  CASE WHEN EXISTS (...) THEN '✅ YES' ELSE '❌ NO' END as result
...
```

Hasil ini akan menunjukkan semua check status dalam format table rapi.

---

## 💡 Troubleshooting

### Error: "permission denied for schema public"
→ Mungkin role Anda bukan Owner/Admin di Supabase  
→ Contact Supabase project admin

### Error: "relation ara_brain does not exist"
→ Tabel belum dibuat  
→ Jalankan Query 8 (CREATE TABLE)

### Query 3 kosong tapi Query 1 ada hasil
→ Tabel exist tapi data kosong  
→ Jalankan INSERT di Query 8 (bagian akhir)

### Query 6 return kosong tapi Query 3 ada data
→ RLS policy blocking access  
→ Jalankan Query 9 (RESET policies)

---

## ✅ Setelah Fix

1. Jalankan **Query 10** untuk confirm semua ✅
2. Kirim screenshot hasilnya kesini
3. Restart aplikasi (F5)
4. Coba ARA Chat lagi

Good luck! 🚀
