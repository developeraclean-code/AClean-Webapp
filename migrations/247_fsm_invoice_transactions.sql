-- Migration 247: atomic invoice commands; retain every posted payment.
-- No ledger/schema rewrites. Apply before deploying the RPC-only browser callers.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE OR REPLACE FUNCTION public.guard_fsm_posted_invoice_239()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE posted boolean;
BEGIN
  posted := (OLD.status IN ('PAID','PARTIAL_PAID') AND coalesce(OLD.total,0)>0)
    OR coalesce(OLD.paid_amount,0)>0 OR coalesce(OLD.withheld_amount,0)>0
    OR EXISTS(SELECT 1 FROM public.invoice_payments WHERE invoice_id=OLD.id)
    OR EXISTS(SELECT 1 FROM public.payment_logs WHERE invoice_id=OLD.id)
    OR EXISTS(SELECT 1 FROM public.payments WHERE invoice_id=OLD.id OR OLD.id=ANY(invoice_ids));
  IF posted AND (TG_OP='DELETE') THEN
    RAISE EXCEPTION 'Invoice dengan riwayat pembayaran tidak boleh dihapus; ledger tetap dipertahankan'
      USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND posted AND (
      coalesce(NEW.paid_amount,0)<coalesce(OLD.paid_amount,0)
      OR (OLD.status IN ('PAID','PARTIAL_PAID') AND NEW.status IN ('UNPAID','OVERDUE','PENDING_APPROVAL'))
      OR (EXISTS(SELECT 1 FROM public.invoice_payments WHERE invoice_id=OLD.id)
          AND NEW.status IN ('UNPAID','OVERDUE'))
    ) THEN
    RAISE EXCEPTION 'Pembayaran tercatat tidak boleh direset. Ledger dan penerimaan kas tetap dipertahankan'
      USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_fsm_posted_invoice_239() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER trg_guard_fsm_posted_invoice_239
  BEFORE UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_fsm_posted_invoice_239();

-- Old browser tabs must not erase evidence before their later DELETE is denied.
CREATE OR REPLACE FUNCTION public.guard_fsm_evidence_delete_239()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_TABLE_NAME='payment_logs' THEN
    RAISE EXCEPTION 'Catatan pembayaran tetap dipertahankan; penghapusan invoice tidak boleh menghapus bukti'
      USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.invoices WHERE job_id=OLD.job_id)
     OR EXISTS(SELECT 1 FROM public.inventory_transactions WHERE report_id=OLD.id) THEN
    RAISE EXCEPTION 'Laporan terkait invoice atau stok tidak boleh dihapus bertahap; data tetap dipertahankan'
      USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.guard_fsm_evidence_delete_239() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER trg_guard_fsm_evidence_delete_239
  BEFORE DELETE ON public.payment_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_fsm_evidence_delete_239();
CREATE OR REPLACE TRIGGER trg_guard_fsm_evidence_delete_239
  BEFORE DELETE ON public.service_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_fsm_evidence_delete_239();

CREATE OR REPLACE FUNCTION public.guard_fsm_paid_order_link_239()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     AND EXISTS(SELECT 1 FROM public.invoices i WHERE i.id=OLD.invoice_id AND (
       i.status IN ('PAID','PARTIAL_PAID') OR coalesce(i.paid_amount,0)>0 OR coalesce(i.withheld_amount,0)>0
       OR EXISTS(SELECT 1 FROM public.invoice_payments WHERE invoice_id=i.id)
       OR EXISTS(SELECT 1 FROM public.payment_logs WHERE invoice_id=i.id)
       OR EXISTS(SELECT 1 FROM public.payments WHERE invoice_id=i.id OR i.id=ANY(invoice_ids))
     )) THEN
    RAISE EXCEPTION 'Relasi order ke pembayaran tercatat tetap dipertahankan' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_fsm_paid_order_link_239() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER trg_guard_fsm_paid_order_link_239
  BEFORE UPDATE OF invoice_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_fsm_paid_order_link_239();

CREATE OR REPLACE FUNCTION public.revert_invoice_unpaid_atomic(
  p_invoice_id text, p_actor_name text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET lock_timeout='5s' AS $$
DECLARE actor_role text; actor text; inv public.invoices%ROWTYPE; changed_orders jsonb; next_status text;
BEGIN
  actor_role:=public.get_my_role();
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
     OR actor_role IS DISTINCT FROM 'Owner' THEN
    RAISE EXCEPTION 'Hanya Owner aktif dapat membatalkan status invoice' USING ERRCODE='42501';
  END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid();
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tidak ditemukan' USING ERRCODE='P0002'; END IF;
  IF inv.status NOT IN ('PAID','PARTIAL_PAID') THEN
    RAISE EXCEPTION 'Status invoice sudah berubah; muat ulang sebelum koreksi' USING ERRCODE='40001';
  END IF;
  -- Positive PAID legacy rows also represent cash even when the detailed ledger
  -- predates migration 029. Never turn absence of a ledger into permission to reset.
  IF coalesce(inv.total,0)>0 OR coalesce(inv.paid_amount,0)>0 OR coalesce(inv.withheld_amount,0)>0
     OR EXISTS(SELECT 1 FROM public.invoice_payments WHERE invoice_id=inv.id)
     OR EXISTS(SELECT 1 FROM public.payment_logs WHERE invoice_id=inv.id)
     OR EXISTS(SELECT 1 FROM public.payments WHERE invoice_id=inv.id OR inv.id=ANY(invoice_ids)) THEN
    RAISE EXCEPTION 'Pembayaran tercatat tidak boleh direset. Ledger dan penerimaan kas tetap dipertahankan'
      USING ERRCODE='55000';
  END IF;
  -- Only an unposted zero-value status correction remains reversible.
  -- Repeat calls cannot create payment rows or reset another financial event.
  next_status:=CASE WHEN inv.due < (now() AT TIME ZONE 'Asia/Jakarta')::date THEN 'OVERDUE' ELSE 'UNPAID' END;
  UPDATE public.invoices SET status=next_status,paid_at=NULL,paid_method=NULL,
    pdf_url=NULL,pdf_generated_at=NULL,last_changed_by=actor||'::REVERT_ZERO_STATUS'
  WHERE id=inv.id RETURNING * INTO inv;
  WITH changed AS (
    UPDATE public.orders SET status='INVOICE_APPROVED',last_changed_by=actor
    WHERE (id=inv.job_id OR invoice_id=inv.id) AND status='PAID' RETURNING *
  ) SELECT coalesce(jsonb_agg(to_jsonb(changed)),'[]'::jsonb) INTO changed_orders FROM changed;
  RETURN jsonb_build_object('invoice',to_jsonb(inv),'orders',changed_orders,'new_status',next_status);
END $$;

CREATE OR REPLACE FUNCTION public.delete_invoice_atomic(
  p_invoice_id text,p_actor_name text DEFAULT NULL,p_reason text DEFAULT 'MANUAL_DELETE'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET lock_timeout='5s' AS $$
DECLARE actor_role text; actor text; inv public.invoices%ROWTYPE; changed_orders jsonb;
BEGIN
  actor_role:=public.get_my_role();
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
     OR actor_role IS NULL OR actor_role NOT IN ('Owner','Admin') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin aktif dapat menghapus invoice' USING ERRCODE='42501';
  END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid();
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('deleted',true,'already_absent',true,'id',p_invoice_id,'orders','[]'::jsonb); END IF;
  IF inv.status IN ('PAID','PARTIAL_PAID') OR coalesce(inv.paid_amount,0)>0 OR coalesce(inv.withheld_amount,0)>0
     OR EXISTS(SELECT 1 FROM public.invoice_payments WHERE invoice_id=inv.id)
     OR EXISTS(SELECT 1 FROM public.payment_logs WHERE invoice_id=inv.id)
     OR EXISTS(SELECT 1 FROM public.payments WHERE invoice_id=inv.id OR inv.id=ANY(invoice_ids)) THEN
    RAISE EXCEPTION 'Invoice dengan riwayat pembayaran tidak boleh dihapus; ledger tetap dipertahankan'
      USING ERRCODE='55000';
  END IF;
  -- Set audit actor and unlink orders in the same transaction as DELETE.
  UPDATE public.invoices SET last_changed_by=actor||'::'||left(coalesce(p_reason,'MANUAL_DELETE'),100) WHERE id=inv.id;
  WITH changed AS (
    UPDATE public.orders SET invoice_id=NULL,last_changed_by=actor
    WHERE invoice_id=inv.id RETURNING *
  ) SELECT coalesce(jsonb_agg(to_jsonb(changed)),'[]'::jsonb) INTO changed_orders FROM changed;
  DELETE FROM public.invoices WHERE id=inv.id;
  -- Any FK/trigger error rolls back actor/link changes too; no payment evidence is deleted.
  RETURN jsonb_build_object('deleted',true,'id',inv.id,'orders',changed_orders);
END $$;

CREATE OR REPLACE FUNCTION public.approve_invoice_atomic(
  p_invoice_id text,p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET lock_timeout='5s' AS $$
DECLARE actor_role text; actor text; inv public.invoices%ROWTYPE; ord public.orders%ROWTYPE;
  paid numeric; outstanding numeric; approved_status text; approved_due date;
BEGIN
  actor_role:=public.get_my_role();
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
     OR actor_role IS NULL OR actor_role NOT IN ('Owner','Admin','Finance') THEN
    RAISE EXCEPTION 'Akses approval ditolak' USING ERRCODE='42501';
  END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid();
  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tidak ditemukan' USING ERRCODE='P0002'; END IF;
  IF p_expected_updated_at IS NOT NULL AND inv.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Invoice berubah sejak dibuka; muat ulang saldo' USING ERRCODE='40001';
  END IF;
  IF inv.status='CANCELLED' THEN RAISE EXCEPTION 'Invoice dibatalkan' USING ERRCODE='55000'; END IF;
  IF inv.total IS NULL OR inv.total<0 OR inv.total::text IN ('NaN','Infinity','-Infinity')
     OR (inv.total=0 AND nullif(trim(coalesce(inv.repair_gratis,'')),'') IS NULL) THEN
    RAISE EXCEPTION 'Total invoice tidak valid' USING ERRCODE='22023';
  END IF;
  IF inv.job_id IS NOT NULL THEN
    SELECT * INTO ord FROM public.orders WHERE id=inv.job_id FOR UPDATE;
    IF NOT FOUND OR ord.status='CANCELLED' OR (ord.invoice_id IS NOT NULL AND ord.invoice_id<>inv.id) THEN
      RAISE EXCEPTION 'Relasi order/invoice tidak valid' USING ERRCODE='55000';
    END IF;
    IF nullif(inv.phone,'') IS NOT NULL AND nullif(ord.phone,'') IS NOT NULL
       AND regexp_replace(regexp_replace(regexp_replace(inv.phone,'[^0-9]','','g'),'^0','62'),'^8','628')
           <>regexp_replace(regexp_replace(regexp_replace(ord.phone,'[^0-9]','','g'),'^0','62'),'^8','628') THEN
      RAISE EXCEPTION 'Customer invoice berbeda dari order' USING ERRCODE='55000';
    END IF;
  END IF;
  -- paid_amount already includes withholding settlement (migration 212).
  paid:=coalesce(inv.paid_amount,0);
  outstanding:=greatest(0,inv.total-paid);
  approved_status:=CASE WHEN outstanding=0 THEN 'PAID' WHEN paid>0 THEN 'PARTIAL_PAID' ELSE 'UNPAID' END;
  approved_due:=coalesce(inv.due,(now() AT TIME ZONE 'Asia/Jakarta')::date+1);
  -- Already posted rows retain their status and all balances; repeats are read-only.
  IF inv.status NOT IN ('PAID','PARTIAL_PAID') AND
     (inv.approved_at IS NULL OR inv.status NOT IN ('UNPAID','OVERDUE')) THEN
    UPDATE public.invoices SET status=approved_status,due=approved_due,approved_by=actor,approved_at=now(),
      paid_at=CASE WHEN approved_status='PAID' THEN coalesce(paid_at,(now() AT TIME ZONE 'Asia/Jakarta')::date) ELSE paid_at END,
      pdf_url=NULL,pdf_generated_at=NULL,last_changed_by=actor
    WHERE id=inv.id RETURNING * INTO inv;
  END IF;
  -- Deposit triggers may have reconciled the invoice in that UPDATE.
  SELECT * INTO inv FROM public.invoices WHERE id=inv.id;
  IF ord.id IS NOT NULL THEN
    UPDATE public.orders SET invoice_id=inv.id,
      status=CASE WHEN inv.status='PAID' THEN 'PAID' ELSE 'INVOICE_APPROVED' END,last_changed_by=actor
    WHERE id=ord.id RETURNING * INTO ord;
  END IF;
  RETURN jsonb_build_object('invoice',to_jsonb(inv),'order',CASE WHEN ord.id IS NULL THEN NULL ELSE to_jsonb(ord) END,
    'due',coalesce(inv.due,approved_due));
END $$;

REVOKE ALL ON FUNCTION public.revert_invoice_unpaid_atomic(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.delete_invoice_atomic(text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.approve_invoice_atomic(text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revert_invoice_unpaid_atomic(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_invoice_atomic(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_invoice_atomic(text,timestamptz) TO authenticated;

-- Existing dangling historical IDs are retained. New references are enforced;
-- validation/repair of old exceptions is a separate, explicitly reviewed task.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='orders_invoice_fsm_239_fkey') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_invoice_fsm_239_fkey
      FOREIGN KEY(invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
