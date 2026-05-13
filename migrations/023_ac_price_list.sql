-- Migration 023: Tabel harga unit AC per brand/tipe/kapasitas
CREATE TABLE IF NOT EXISTS ac_price_list (
  id               SERIAL PRIMARY KEY,
  brand            TEXT NOT NULL,
  tipe             TEXT NOT NULL,
  kapasitas        TEXT NOT NULL,
  harga_unit       INTEGER NOT NULL DEFAULT 0,
  harga_inc_pasang INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ac_price_list_brand_idx ON ac_price_list (brand);
CREATE INDEX IF NOT EXISTS ac_price_list_active_idx ON ac_price_list (is_active);

-- Seed data: brand umum di Indonesia, tipe Split Standard & Inverter, kapasitas 0.5-2PK
INSERT INTO ac_price_list (brand, tipe, kapasitas, harga_unit, harga_inc_pasang) VALUES
-- Daikin
('Daikin', 'Split Standard', '0.5 PK', 3200000, 4600000),
('Daikin', 'Split Standard', '0.75 PK', 3600000, 5000000),
('Daikin', 'Split Standard', '1 PK', 4100000, 5500000),
('Daikin', 'Split Standard', '1.5 PK', 5200000, 6800000),
('Daikin', 'Split Standard', '2 PK', 6800000, 8400000),
('Daikin', 'Split Inverter', '0.75 PK', 4500000, 5900000),
('Daikin', 'Split Inverter', '1 PK', 5200000, 6600000),
('Daikin', 'Split Inverter', '1.5 PK', 6500000, 8100000),
('Daikin', 'Split Inverter', '2 PK', 8500000, 10100000),
-- Panasonic
('Panasonic', 'Split Standard', '0.5 PK', 3000000, 4400000),
('Panasonic', 'Split Standard', '0.75 PK', 3400000, 4800000),
('Panasonic', 'Split Standard', '1 PK', 3900000, 5300000),
('Panasonic', 'Split Standard', '1.5 PK', 5000000, 6600000),
('Panasonic', 'Split Standard', '2 PK', 6500000, 8100000),
('Panasonic', 'Split Inverter', '0.75 PK', 4200000, 5600000),
('Panasonic', 'Split Inverter', '1 PK', 4900000, 6300000),
('Panasonic', 'Split Inverter', '1.5 PK', 6200000, 7800000),
('Panasonic', 'Split Inverter', '2 PK', 8000000, 9600000),
-- Sharp
('Sharp', 'Split Standard', '0.5 PK', 2800000, 4200000),
('Sharp', 'Split Standard', '0.75 PK', 3200000, 4600000),
('Sharp', 'Split Standard', '1 PK', 3700000, 5100000),
('Sharp', 'Split Standard', '1.5 PK', 4800000, 6400000),
('Sharp', 'Split Standard', '2 PK', 6200000, 7800000),
('Sharp', 'Split Inverter', '1 PK', 4700000, 6100000),
('Sharp', 'Split Inverter', '1.5 PK', 5900000, 7500000),
('Sharp', 'Split Inverter', '2 PK', 7800000, 9400000),
-- Gree
('Gree', 'Split Standard', '0.5 PK', 2600000, 4000000),
('Gree', 'Split Standard', '0.75 PK', 2900000, 4300000),
('Gree', 'Split Standard', '1 PK', 3400000, 4800000),
('Gree', 'Split Standard', '1.5 PK', 4400000, 6000000),
('Gree', 'Split Standard', '2 PK', 5800000, 7400000),
('Gree', 'Split Inverter', '1 PK', 4300000, 5700000),
('Gree', 'Split Inverter', '1.5 PK', 5500000, 7100000),
('Gree', 'Split Inverter', '2 PK', 7200000, 8800000),
-- Samsung
('Samsung', 'Split Standard', '1 PK', 4000000, 5400000),
('Samsung', 'Split Standard', '1.5 PK', 5100000, 6700000),
('Samsung', 'Split Standard', '2 PK', 6600000, 8200000),
('Samsung', 'Split Inverter', '1 PK', 5000000, 6400000),
('Samsung', 'Split Inverter', '1.5 PK', 6300000, 7900000),
('Samsung', 'Split Inverter', '2 PK', 8200000, 9800000),
-- LG
('LG', 'Split Standard', '1 PK', 3900000, 5300000),
('LG', 'Split Standard', '1.5 PK', 5000000, 6600000),
('LG', 'Split Standard', '2 PK', 6400000, 8000000),
('LG', 'Split Inverter', '1 PK', 4900000, 6300000),
('LG', 'Split Inverter', '1.5 PK', 6100000, 7700000),
('LG', 'Split Inverter', '2 PK', 8000000, 9600000),
-- Mitsubishi
('Mitsubishi', 'Split Standard', '1 PK', 4500000, 5900000),
('Mitsubishi', 'Split Standard', '1.5 PK', 5800000, 7400000),
('Mitsubishi', 'Split Standard', '2 PK', 7500000, 9100000),
('Mitsubishi', 'Split Inverter', '1 PK', 5800000, 7200000),
('Mitsubishi', 'Split Inverter', '1.5 PK', 7200000, 8800000),
('Mitsubishi', 'Split Inverter', '2 PK', 9500000, 11100000),
-- Haier
('Haier', 'Split Standard', '0.5 PK', 2400000, 3800000),
('Haier', 'Split Standard', '1 PK', 3200000, 4600000),
('Haier', 'Split Standard', '1.5 PK', 4100000, 5700000),
('Haier', 'Split Standard', '2 PK', 5500000, 7100000),
('Haier', 'Split Inverter', '1 PK', 4000000, 5400000),
('Haier', 'Split Inverter', '1.5 PK', 5200000, 6800000),
-- Midea
('Midea', 'Split Standard', '0.5 PK', 2300000, 3700000),
('Midea', 'Split Standard', '1 PK', 3100000, 4500000),
('Midea', 'Split Standard', '1.5 PK', 3900000, 5500000),
('Midea', 'Split Standard', '2 PK', 5200000, 6800000),
('Midea', 'Split Inverter', '1 PK', 3900000, 5300000),
('Midea', 'Split Inverter', '1.5 PK', 5000000, 6600000),
-- Hisense
('Hisense', 'Split Standard', '1 PK', 3000000, 4400000),
('Hisense', 'Split Standard', '1.5 PK', 3800000, 5400000),
('Hisense', 'Split Standard', '2 PK', 5000000, 6600000),
('Hisense', 'Split Inverter', '1 PK', 3800000, 5200000),
('Hisense', 'Split Inverter', '1.5 PK', 4900000, 6500000);
