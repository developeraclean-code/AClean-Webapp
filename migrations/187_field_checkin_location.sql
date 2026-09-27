-- 187 — Check-in lokasi opsional untuk teknisi/helper.
-- Lokasi hanya ditulis ketika pengguna menekan tombol Tiba dan mengizinkan browser.

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS on_site_latitude double precision,
  ADD COLUMN IF NOT EXISTS on_site_longitude double precision,
  ADD COLUMN IF NOT EXISTS on_site_accuracy_m double precision,
  ADD COLUMN IF NOT EXISTS on_site_location_captured_at timestamptz;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_on_site_latitude_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_on_site_latitude_check
  CHECK (on_site_latitude IS NULL OR on_site_latitude BETWEEN -90 AND 90);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_on_site_longitude_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_on_site_longitude_check
  CHECK (on_site_longitude IS NULL OR on_site_longitude BETWEEN -180 AND 180);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_on_site_accuracy_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_on_site_accuracy_check
  CHECK (on_site_accuracy_m IS NULL OR on_site_accuracy_m >= 0);

COMMIT;
