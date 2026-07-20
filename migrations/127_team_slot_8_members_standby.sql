-- Migration 127: daily_team_slots — kapasitas 4→8 anggota per tim + kolom Standby
-- Dipakai Planning Order → "Isi Tim Harian". Sebelumnya 1 slot maks 4 orang
-- (member1..4). Permintaan Owner 20 Jul 2026: 8 orang per tim (4 teknisi + 4
-- helper), plus kolom khusus untuk menandai satu tim sedang Standby (siaga,
-- terpisah dari status kehadiran per-orang yang sudah ada di technician_availability).

ALTER TABLE daily_team_slots
  ADD COLUMN IF NOT EXISTS member5      TEXT,
  ADD COLUMN IF NOT EXISTS member5_role TEXT NOT NULL DEFAULT 'helper',
  ADD COLUMN IF NOT EXISTS member6      TEXT,
  ADD COLUMN IF NOT EXISTS member6_role TEXT NOT NULL DEFAULT 'helper',
  ADD COLUMN IF NOT EXISTS member7      TEXT,
  ADD COLUMN IF NOT EXISTS member7_role TEXT NOT NULL DEFAULT 'helper',
  ADD COLUMN IF NOT EXISTS member8      TEXT,
  ADD COLUMN IF NOT EXISTS member8_role TEXT NOT NULL DEFAULT 'helper',
  ADD COLUMN IF NOT EXISTS standby      BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN daily_team_slots.standby IS
  'Tim ditandai siaga/cadangan hari ini oleh Admin — flag tampilan & organisasi, TIDAK otomatis mengubah technician_availability per-orang.';
