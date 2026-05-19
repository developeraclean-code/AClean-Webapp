-- Migration 037: Tambah data Daikin Standar Nusantara, ALPHA, BETA, ZETA (21 models)
-- Harga unit = Harga Retail dari brosur resmi Daikin
-- Harga inc pasang = harga_unit + biaya pemasangan
--   0.5-1PK = +1.400.000
--   1.5-2PK = +1.600.000
--   2.5PK = +2.000.000

INSERT INTO ac_price_list (brand, tipe, kapasitas, seri, nama_varian, harga_unit, harga_inc_pasang) VALUES

-- Daikin Standar Nusantara (Non-Inverter)
('Daikin', 'Standar Nusantara', '0.5 PK', 'STC15YV', 'Standar Nusantara', 3909000, 5309000),
('Daikin', 'Standar Nusantara', '1 PK',   'STC25YV', 'Standar Nusantara', 4679000, 6079000),
('Daikin', 'Standar Nusantara', '1.5 PK', 'STC35YV', 'Standar Nusantara', 5789000, 7389000),
('Daikin', 'Standar Nusantara', '2 PK',   'STC50YV', 'Standar Nusantara', 7719000, 9319000),
('Daikin', 'Standar Nusantara', '2.5 PK', 'STV60CXV', 'Standar Nusantara', 9889000, 11889000),

-- Daikin ALPHA Inverter
('Daikin', 'ALPHA Inverter', '0.5 PK',  'STKH15YV', 'ALPHA Inverter', 6069000, 7469000),
('Daikin', 'ALPHA Inverter', '0.75 PK', 'STKH20YV', 'ALPHA Inverter', 6309000, 7709000),
('Daikin', 'ALPHA Inverter', '1 PK',    'STKH25YV', 'ALPHA Inverter', 6599000, 7999000),
('Daikin', 'ALPHA Inverter', '1.5 PK',  'STKH35YV', 'ALPHA Inverter', 8189000, 9789000),
('Daikin', 'ALPHA Inverter', '2 PK',    'STKH50YV', 'ALPHA Inverter', 10909000, 12509000),
('Daikin', 'ALPHA Inverter', '2.5 PK',  'STKH60YV', 'ALPHA Inverter', 13839000, 15839000),

-- Daikin BETA Inverter
('Daikin', 'BETA Inverter', '0.5 PK',  'STKE15YV', 'BETA Inverter', 4679000, 6079000),
('Daikin', 'BETA Inverter', '0.75 PK', 'STKE20YV', 'BETA Inverter', 4859000, 6259000),
('Daikin', 'BETA Inverter', '1 PK',    'STKE25YV', 'BETA Inverter', 5159000, 6559000),
('Daikin', 'BETA Inverter', '1.5 PK',  'STKE35YV', 'BETA Inverter', 6309000, 7909000),
('Daikin', 'BETA Inverter', '2 PK',    'STKE50YV', 'BETA Inverter', 8559000, 10159000),

-- Daikin ZETA Inverter
('Daikin', 'ZETA Inverter', '1 PK',   'STKZ25', 'ZETA Inverter', 10519000, 11919000),
('Daikin', 'ZETA Inverter', '1.5 PK', 'STKZ35', 'ZETA Inverter', 13289000, 14889000),
('Daikin', 'ZETA Inverter', '2 PK',   'STKZ50', 'ZETA Inverter', 19869000, 21469000),
('Daikin', 'ZETA Inverter', '2.5 PK', 'STKZ60', 'ZETA Inverter', 28309000, 30309000),
('Daikin', 'ZETA Inverter', '3 PK',   'STKZ71', 'ZETA Inverter', 34769000, 36769000);
