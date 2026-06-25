-- 107_maint_unit_high_freq.sql
-- Flag unit "intensitas tinggi" (cleaning lebih sering dari ritme PPM standar, mis. 2-mingguan/bulanan).
-- Unit ber-high_freq DIKELUARKAN dari PPM Calendar level-site (api ppm-calendar) supaya tak
-- mengganggu ritme kunjungan quarterly per perusahaan, dan ditampilkan sebagai checklist
-- terpisah di tab Unit (MaintenanceView). Lihat [[project_eka_jaya_onboarding]] poin #2 & #3.
--
-- Backfill: unit dgn interval < 2 bulan (mis. 0.5 = 2 minggu, 1.5 = 6 minggu) ditandai high_freq.
-- Admin tetap bisa toggle manual per unit.
-- RLS: maintenance_units sudah RESTRICTIVE (migrasi 059) — kolom baru ikut terlindungi.

ALTER TABLE public.maintenance_units
  ADD COLUMN IF NOT EXISTS high_freq boolean NOT NULL DEFAULT false;

UPDATE public.maintenance_units
  SET high_freq = true
  WHERE service_interval_months IS NOT NULL
    AND service_interval_months < 2
    AND high_freq = false;

CREATE INDEX IF NOT EXISTS idx_munits_high_freq
  ON public.maintenance_units (client_id, high_freq);
