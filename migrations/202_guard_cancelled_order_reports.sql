-- Jangan izinkan laporan baru/ulang menghidupkan kembali order yang dibatalkan.
-- Riwayat laporan yang sudah ada tetap disimpan untuk audit Owner/Admin.
CREATE OR REPLACE FUNCTION public.guard_cancelled_order_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  order_status text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status = 'SUBMITTED' THEN
    SELECT upper(o.status) INTO order_status
    FROM public.orders o WHERE o.id = NEW.job_id;
    IF order_status IN ('CANCELLED', 'RESCHEDULED') THEN
      RAISE EXCEPTION 'Job % dibatalkan atau dijadwal ulang; laporan ditolak', NEW.job_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_cancelled_order_report() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_cancelled_order_report ON public.service_reports;
CREATE TRIGGER trg_guard_cancelled_order_report
BEFORE INSERT OR UPDATE ON public.service_reports
FOR EACH ROW EXECUTE FUNCTION public.guard_cancelled_order_report();
