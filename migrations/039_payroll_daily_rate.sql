-- Migration 039: Tambah daily_rate ke user_profiles untuk konfigurasi gaji harian
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS daily_rate numeric DEFAULT 0;

COMMENT ON COLUMN user_profiles.daily_rate IS 'Gaji harian (Rp) — dipakai untuk hitung weekly payroll';
