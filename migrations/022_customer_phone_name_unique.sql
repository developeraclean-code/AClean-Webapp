-- Migration 022: Ganti unique constraint phone saja → unique (phone, name)
-- Support customer multi-lokasi: 1 HP bisa punya banyak customer asal nama berbeda
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_phone_key;
ALTER TABLE customers ADD CONSTRAINT customers_phone_name_key UNIQUE (phone, name);
