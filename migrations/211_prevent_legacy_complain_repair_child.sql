-- Upgrade Complain → Repair sekarang mengubah order yang sama (ID tetap).
-- Blokir klien lama yang masih mencoba INSERT child Repair terpisah.
-- Trigger hanya memeriksa INSERT atau perubahan parent/service; data lama tidak diubah.
CREATE OR REPLACE FUNCTION public.prevent_legacy_complain_repair_child()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.parent_job_id IS NULL OR NEW.service IS DISTINCT FROM 'Repair' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.parent_job_id IS NOT DISTINCT FROM OLD.parent_job_id
       AND NEW.service IS NOT DISTINCT FROM OLD.service THEN
      RETURN NEW;
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders parent
    WHERE parent.id = NEW.parent_job_id
      AND (parent.service = 'Complain'
        OR (parent.service = 'Repair' AND position('[UPGRADED_FROM_COMPLAIN]' in coalesce(parent.notes, '')) > 0))
  ) THEN
    RAISE EXCEPTION 'Upgrade Complain ke Repair harus memakai ID job yang sama (%). Muat ulang aplikasi.', NEW.parent_job_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_legacy_complain_repair_child ON public.orders;
CREATE TRIGGER trg_prevent_legacy_complain_repair_child
BEFORE INSERT OR UPDATE OF parent_job_id, service ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.prevent_legacy_complain_repair_child();
