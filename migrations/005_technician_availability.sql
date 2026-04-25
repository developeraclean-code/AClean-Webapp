-- Migration 005: Tabel kehadiran teknisi per hari
-- Dipakai Planning Order untuk filter dropdown assign teknisi/helper
CREATE TABLE IF NOT EXISTS technician_availability (
  id           BIGSERIAL PRIMARY KEY,
  date         DATE        NOT NULL,
  teknisi      TEXT        NOT NULL,
  is_available BOOLEAN     NOT NULL DEFAULT true,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date, teknisi)
);

CREATE INDEX IF NOT EXISTS idx_techavail_date     ON technician_availability (date);
CREATE INDEX IF NOT EXISTS idx_techavail_teknisi  ON technician_availability (teknisi);

COMMENT ON TABLE technician_availability IS 'Kehadiran teknisi per hari — dipakai Planning Order untuk filter dropdown assign';
