-- 102_order_paid_sync_trigger.sql
-- Permanent guarantee: ketika sebuah invoice menjadi PAID, order terkait ikut PAID.
-- Menutup celah desync (62 order ditemukan PAID-invoice tapi order belum PAID) yang lolos
-- dari markInvoicePaid() di App.jsx — terutama jalur pembayaran grup/manual/legacy.
-- DB-level trigger = berlaku untuk SEMUA jalur (frontend, backend, SQL manual).
-- Idempotent: aman di-run ulang.

CREATE OR REPLACE FUNCTION sync_order_paid_on_invoice() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.job_id IS NOT NULL AND upper(coalesce(NEW.status, '')) = 'PAID' THEN
    UPDATE orders
    SET status = 'PAID'
    WHERE id = NEW.job_id AND upper(coalesce(status, '')) <> 'PAID';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_paid ON invoices;
CREATE TRIGGER trg_sync_order_paid
AFTER INSERT OR UPDATE OF status ON invoices
FOR EACH ROW
EXECUTE FUNCTION sync_order_paid_on_invoice();
