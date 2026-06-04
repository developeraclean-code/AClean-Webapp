-- Migration 065: Tambah AC Floor Standing 2PK–5PK ke price_list
-- Harga samakan dengan AC Cassette (per request owner 2026-06-04)
-- Run manual di Supabase SQL Editor

INSERT INTO price_list (service, type, price, unit, is_active) VALUES
  ('Cleaning', 'AC Floor Standing 2-2.5PK', 250000, 'unit', true),
  ('Cleaning', 'AC Floor Standing 3PK',     300000, 'unit', true),
  ('Cleaning', 'AC Floor Standing 4PK',     400000, 'unit', true),
  ('Cleaning', 'AC Floor Standing 5PK',     500000, 'unit', true),
  ('Install',  'Pasang AC Floor Standing',  900000, 'unit', true)
ON CONFLICT (service, type) DO UPDATE
  SET price = EXCLUDED.price, is_active = true;
