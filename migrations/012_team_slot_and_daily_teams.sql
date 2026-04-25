-- Migration 012: Team slot column on orders + daily_team_slots table
-- Dipakai Planning Order untuk sistem penugasan tim per hari

-- Kolom team_slot di orders (misal "Team 01" … "Team 10")
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS team_slot TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_team_slot ON orders (team_slot);

-- Tabel komposisi tim harian
CREATE TABLE IF NOT EXISTS daily_team_slots (
  id           BIGSERIAL PRIMARY KEY,
  date         DATE        NOT NULL,
  slot_name    TEXT        NOT NULL,           -- "Team 01" … "Team 10"
  member1      TEXT,
  member1_role TEXT        NOT NULL DEFAULT 'teknisi',
  member2      TEXT,
  member2_role TEXT        NOT NULL DEFAULT 'helper',
  member3      TEXT,
  member3_role TEXT        NOT NULL DEFAULT 'helper',
  member4      TEXT,
  member4_role TEXT        NOT NULL DEFAULT 'helper',
  confirmed    BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date, slot_name)
);

CREATE INDEX IF NOT EXISTS idx_daily_team_date      ON daily_team_slots (date);
CREATE INDEX IF NOT EXISTS idx_daily_team_slot_name ON daily_team_slots (slot_name);

COMMENT ON TABLE daily_team_slots IS 'Komposisi tim harian — maks 4 anggota per slot, dipakai Planning Order';
COMMENT ON COLUMN daily_team_slots.confirmed IS 'true = nama anggota sudah di-propagate ke orders.teknisi/helper pada hari tsb';
