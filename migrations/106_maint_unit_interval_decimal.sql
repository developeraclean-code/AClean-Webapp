-- 106_maint_unit_interval_decimal.sql
-- Ubah maintenance_units.service_interval_months dari INTEGER ke NUMERIC
-- agar periodisasi pecahan (mis. 1.5 bulan / 6 minggu, 0.5 bulan / 2 minggu) tersimpan persis.
-- Sebelumnya integer → periode pecahan dari kontrak korporat (PT Eka Jaya Internasional) hilang presisi.
-- Backward compatible: save-units (api/[route].js) sudah pakai Number(), portal hanya membaca.
--
-- Trigger trg_compute_next_service bergantung ke kolom ini, jadi harus di-drop dulu,
-- alter, lalu recreate. Fungsi fn_compute_next_service juga di-update: numeric * interval
-- tidak didukung langsung di Postgres → cast ::double precision sebelum dikali INTERVAL.
-- Applied via Supabase MCP.

DROP TRIGGER IF EXISTS trg_compute_next_service ON public.maintenance_units;

ALTER TABLE public.maintenance_units
  ALTER COLUMN service_interval_months TYPE numeric USING service_interval_months::numeric;
ALTER TABLE public.maintenance_units
  ALTER COLUMN service_interval_months SET DEFAULT 3;

CREATE OR REPLACE FUNCTION public.fn_compute_next_service()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN IF NEW.last_service_date IS NOT NULL THEN NEW.next_service_date := NEW.last_service_date + (COALESCE(NEW.service_interval_months, 3)::double precision * INTERVAL '1 month'); END IF; RETURN NEW; END; $function$;

CREATE TRIGGER trg_compute_next_service BEFORE INSERT OR UPDATE OF last_service_date, service_interval_months ON public.maintenance_units FOR EACH ROW EXECUTE FUNCTION fn_compute_next_service();
