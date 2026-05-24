-- Migration 040: Tabel weekly_payroll — slip gaji mingguan per orang
-- Payroll dibayar setiap Sabtu. TIDAK termasuk bonus/komisi (kolom terpisah).

CREATE TABLE IF NOT EXISTS weekly_payroll (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  user_name     text NOT NULL,
  role          text NOT NULL,                        -- 'Teknisi' | 'Helper'
  period_start  date NOT NULL,                        -- Senin minggu ini
  period_end    date NOT NULL,                        -- Sabtu minggu ini

  -- Kehadiran
  days_worked   int  NOT NULL DEFAULT 0,              -- auto dari orders, bisa di-override admin
  days_override bool NOT NULL DEFAULT false,          -- true jika admin sudah edit manual

  -- Komponen gaji
  daily_rate    numeric NOT NULL DEFAULT 0,           -- snapshot rate saat generate
  late_days     int  NOT NULL DEFAULT 0,              -- jumlah hari telat (checklist manual)
  full_week_bonus bool NOT NULL DEFAULT false,        -- checklist manual (Senin–Sabtu penuh)

  -- Deductions & additions
  kasbon_total  numeric NOT NULL DEFAULT 0,           -- auto-sum dari expenses.kasbon periode ini
  manual_bonus  numeric NOT NULL DEFAULT 0,           -- bonus/lembur manual dari owner/admin
  manual_bonus_note text,

  -- Kalkulasi (dihitung saat generate, bisa recalc)
  gross_salary  numeric GENERATED ALWAYS AS (
    days_worked * daily_rate
    + CASE WHEN full_week_bonus THEN
        CASE WHEN role = 'Helper' THEN 75000 ELSE 100000 END
      ELSE 0 END
    - (late_days * 10000)
    - kasbon_total
    + manual_bonus
  ) STORED,

  -- Status pembayaran
  is_paid       bool NOT NULL DEFAULT false,
  paid_at       timestamptz,
  paid_by       text,

  -- WA slip
  wa_sent_at    timestamptz,

  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, period_start)                      -- 1 row per orang per minggu
);

CREATE INDEX IF NOT EXISTS idx_weekly_payroll_period ON weekly_payroll(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_weekly_payroll_user   ON weekly_payroll(user_id);

COMMENT ON TABLE weekly_payroll IS 'Slip gaji mingguan (Senin–Sabtu). Komisi/bonus order di tabel order_bonuses terpisah.';
