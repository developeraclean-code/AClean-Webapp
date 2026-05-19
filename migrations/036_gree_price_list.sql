-- Migration 036: Tambah data Gree F5S, N1/A, AIRY (15 models)
-- Harga unit = Harga Retail dari brosur resmi Gree
-- Harga inc pasang = harga_unit + biaya pemasangan (≤1PK +1.400.000, ≥1.5PK +1.600.000)

INSERT INTO ac_price_list (brand, tipe, kapasitas, seri, nama_varian, harga_unit, harga_inc_pasang) VALUES

-- Gree F5S - Inverter Series (R32, Inverter)
('Gree', 'F5S - Inverter', '0.5 PK', 'GWC-05F5S', 'F5S Inverter Series', 4549000, 5949000),
('Gree', 'F5S - Inverter', '1 PK',   'GWC-09F5S', 'F5S Inverter Series', 4869000, 6269000),
('Gree', 'F5S - Inverter', '1.5 PK', 'GWC-12F5S', 'F5S Inverter Series', 5859000, 7459000),
('Gree', 'F5S - Inverter', '2 PK',   'GWC-18F5S', 'F5S Inverter Series', 8159000, 9759000),
('Gree', 'F5S - Inverter', '2.5 PK', 'GWC-24F5S', 'F5S Inverter Series', 10169000, 11769000),

-- Gree N1/A - Deluxe Standard Series (R32, Non-Inverter)
('Gree', 'N1/A - Standard', '0.5 PK',  'GWC-05N1/A', 'N1/A Deluxe Standard Series', 3339000, 4739000),
('Gree', 'N1/A - Standard', '0.75 PK', 'GWC-07N1/A', 'N1/A Deluxe Standard Series', 3799000, 5199000),
('Gree', 'N1/A - Standard', '1 PK',    'GWC-09N1/A', 'N1/A Deluxe Standard Series', 3969000, 5369000),
('Gree', 'N1/A - Standard', '1.5 PK',  'GWC-12N1/A', 'N1/A Deluxe Standard Series', 5149000, 6749000),
('Gree', 'N1/A - Standard', '2 PK',    'GWC-18N1/A', 'N1/A Deluxe Standard Series', 6849000, 8449000),

-- Gree AIRY - Premium Inverter Series (R32, Inverter)
('Gree', 'AIRY - Inverter', '1 PK',   'GWC-09AIRY', 'AIRY Premium Inverter Series', 10799000, 12199000),
('Gree', 'AIRY - Inverter', '1.5 PK', 'GWC-12AIRY', 'AIRY Premium Inverter Series', 12359000, 13959000),
('Gree', 'AIRY - Inverter', '2 PK',   'GWC-18AIRY', 'AIRY Premium Inverter Series', 14899000, 16499000),
('Gree', 'AIRY - Inverter', '2.5 PK', 'GWC-24AIRY', 'AIRY Premium Inverter Series', 17469000, 19069000),
('Gree', 'AIRY - Inverter', '3 PK',   'GWC-30AIRY', 'AIRY Premium Inverter Series', 20549000, 22549000);
