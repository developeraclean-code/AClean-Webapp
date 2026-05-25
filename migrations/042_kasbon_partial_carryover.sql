-- Migration 042: Kasbon bisa dipotong sebagian, sisa carryover ke minggu depan
-- kasbon_total      = kasbon baru yang diambil minggu ini (auto-sum dari expenses)
-- kasbon_carryover  = sisa kasbon dari minggu lalu yang belum dipotong (auto saat generate)
-- kasbon_deduct     = jumlah yang BENAR-BENAR dipotong minggu ini (editable admin)
-- Sisa ke minggu depan = (kasbon_total + kasbon_carryover) - kasbon_deduct

ALTER TABLE weekly_payroll ADD COLUMN IF NOT EXISTS kasbon_carryover numeric NOT NULL DEFAULT 0;
ALTER TABLE weekly_payroll ADD COLUMN IF NOT EXISTS kasbon_deduct numeric NOT NULL DEFAULT 0;

-- Backfill: baris lama memotong kasbon penuh
UPDATE weekly_payroll SET kasbon_deduct = kasbon_total WHERE kasbon_total > 0;

-- Recreate gross_salary pakai kasbon_deduct (bukan kasbon_total)
ALTER TABLE weekly_payroll DROP COLUMN gross_salary;
ALTER TABLE weekly_payroll ADD COLUMN gross_salary numeric GENERATED ALWAYS AS (
  days_worked * daily_rate
  + CASE WHEN full_week_bonus THEN
      CASE WHEN role = 'Helper' THEN 75000 ELSE 100000 END
    ELSE 0 END
  - (late_days * 10000)
  - kasbon_deduct
  + manual_bonus
) STORED;

COMMENT ON COLUMN weekly_payroll.kasbon_carryover IS 'Sisa kasbon dari minggu sebelumnya yang belum dipotong';
COMMENT ON COLUMN weekly_payroll.kasbon_deduct IS 'Jumlah kasbon yang benar-benar dipotong minggu ini (bisa < total terutang). Sisa = kasbon_total + kasbon_carryover - kasbon_deduct';
