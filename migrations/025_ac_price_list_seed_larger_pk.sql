-- Migration 025: Tambah data 2.5PK dan 3PK untuk brand utama + unique constraint
ALTER TABLE ac_price_list ADD CONSTRAINT ac_price_list_unique
  UNIQUE (brand, tipe, kapasitas, seri);

INSERT INTO ac_price_list (brand, tipe, kapasitas, seri, nama_varian, harga_unit, harga_inc_pasang) VALUES
-- Daikin 2.5PK
('Daikin','Split Standard','2.5 PK','FTC','Nusantara Standard',8500000,10500000),
('Daikin','Split Inverter','2.5 PK','STKH','Alpha Inverter',10500000,12500000),
-- Panasonic 2.5PK
('Panasonic','Split Standard','2.5 PK','CS-LN','Standard',8000000,10000000),
('Panasonic','Split Inverter','2.5 PK','CS-PU','Aero Series Inverter',10000000,12000000),
-- Sharp 2.5PK
('Sharp','Split Standard','2.5 PK','AH-A5','Standard Series',7500000,9500000),
('Sharp','Split Inverter','2.5 PK','AH-X6','J-Tech Inverter',9500000,11500000),
-- Gree 2.5PK
('Gree','Split Standard','2.5 PK','GWC-MOO','Standard Series',7000000,9000000),
('Gree','Split Inverter','2.5 PK','GWC-AI','AI Airy Inverter',9000000,11000000),
-- Samsung 2.5PK
('Samsung','Split Standard','2.5 PK','AR-TGHQ','Standard R32',8200000,10200000),
('Samsung','Split Inverter','2.5 PK','AR-AYHL','Alpha Inverter',10200000,12200000),
-- LG 2.5PK
('LG','Split Standard','2.5 PK','T-CV','Standard Series',8000000,10000000),
('LG','Split Inverter','2.5 PK','T-EV5','DUALCOOL Inverter Eco',10000000,12000000),
-- Mitsubishi 2.5PK
('Mitsubishi','Split Standard','2.5 PK','MS-GN','Mr. Slim Standard',10000000,12000000),
('Mitsubishi','Split Inverter','2.5 PK','MSY-GN','Mr. Slim Inverter',12500000,14500000),
-- Daikin 3PK
('Daikin','Split Standard','3 PK','FTC','Nusantara Standard',11000000,13500000),
('Daikin','Split Inverter','3 PK','STKH','Alpha Inverter',14000000,16500000),
-- Panasonic 3PK
('Panasonic','Split Standard','3 PK','CS-LN','Standard',10500000,13000000),
('Panasonic','Split Inverter','3 PK','CS-PU','Aero Series Inverter',13500000,16000000),
-- Sharp 3PK
('Sharp','Split Standard','3 PK','AH-A5','Standard Series',10000000,12500000),
('Sharp','Split Inverter','3 PK','AH-X6','J-Tech Inverter',12500000,15000000),
-- Mitsubishi 3PK
('Mitsubishi','Split Standard','3 PK','MS-GN','Mr. Slim Standard',13000000,15500000),
('Mitsubishi','Split Inverter','3 PK','MSY-GN','Mr. Slim Inverter',16000000,18500000);
