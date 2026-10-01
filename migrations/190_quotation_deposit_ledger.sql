-- 190 — Ledger DP quotation dan penerapan otomatis ke invoice aktual.
--
-- Term DP pada quotation bukan kas. Kas baru tercatat melalui RPC ini. Ketika
-- invoice aktual dibuat dari laporan, trigger menautkan quotation dan memindahkan
-- DP ke invoice_payments tanpa menghitung kas dua kali di Finance.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quotation_payments (
  id uuid PRIMARY KEY,
  quotation_id text NOT NULL REFERENCES public.quotations(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  applied_amount numeric NOT NULL DEFAULT 0 CHECK (applied_amount >= 0 AND applied_amount <= amount),
  method text NOT NULL DEFAULT 'transfer' CHECK (method IN ('transfer','cash','qris','card','other')),
  paid_at date NOT NULL DEFAULT current_date,
  reference text,
  notes text,
  proof_url text,
  applied_invoice_id text REFERENCES public.invoices(id) ON DELETE RESTRICT,
  recorded_by text,
  recorded_by_name text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotation_payments_quotation
  ON public.quotation_payments(quotation_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotation_payments_unapplied
  ON public.quotation_payments(quotation_id, created_at)
  WHERE applied_amount < amount;

ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS quotation_payment_id uuid
    REFERENCES public.quotation_payments(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_invoice_payments_quotation_payment
  ON public.invoice_payments(quotation_payment_id)
  WHERE quotation_payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_invoice_total_against_payments()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE ledger_total numeric;
BEGIN
  SELECT coalesce(sum(amount),0) INTO ledger_total
    FROM public.invoice_payments WHERE invoice_id=OLD.id;
  ledger_total:=greatest(ledger_total,coalesce(OLD.paid_amount,0));
  IF coalesce(NEW.total,0)<ledger_total THEN
    RAISE EXCEPTION 'Total invoice tidak boleh lebih kecil dari pembayaran yang sudah diterima (%)',ledger_total;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_invoice_total_against_payments ON public.invoices;
CREATE TRIGGER trg_guard_invoice_total_against_payments
BEFORE UPDATE OF total ON public.invoices
FOR EACH ROW WHEN (NEW.total IS DISTINCT FROM OLD.total)
EXECUTE FUNCTION public.guard_invoice_total_against_payments();

ALTER TABLE public.quotation_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotation_payments_manager_read ON public.quotation_payments;
CREATE POLICY quotation_payments_manager_read ON public.quotation_payments
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('Owner','Admin','Finance'));
REVOKE INSERT, UPDATE, DELETE ON public.quotation_payments FROM anon, authenticated;
GRANT SELECT ON public.quotation_payments TO authenticated;
GRANT ALL ON public.quotation_payments TO service_role;

CREATE OR REPLACE FUNCTION public.guard_quotation_terms_with_receipts()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE received numeric;
BEGIN
  SELECT coalesce(sum(amount),0) INTO received FROM public.quotation_payments WHERE quotation_id=OLD.id;
  IF received>0 AND NEW.payment_method<>'DOWN_PAYMENT' THEN
    RAISE EXCEPTION 'Metode tidak dapat diubah ke Transfer Full karena DP sudah diterima';
  END IF;
  IF coalesce(NEW.total,0)<received THEN
    RAISE EXCEPTION 'Total quotation tidak boleh lebih kecil dari DP yang sudah diterima (%)',received;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_quotation_terms_with_receipts ON public.quotations;
CREATE TRIGGER trg_guard_quotation_terms_with_receipts
BEFORE UPDATE OF payment_method,total ON public.quotations
FOR EACH ROW EXECUTE FUNCTION public.guard_quotation_terms_with_receipts();

CREATE OR REPLACE FUNCTION public.apply_quotation_payments_to_invoice(
  p_quotation_id text,
  p_invoice_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  inv public.invoices%ROWTYPE;
  pay public.quotation_payments%ROWTYPE;
  room numeric;
  available numeric;
  used numeric;
  applied_total numeric := 0;
  payment_total numeric;
  ledger_before numeric;
  unledgered_paid numeric;
BEGIN
  IF nullif(trim(p_quotation_id),'') IS NULL OR nullif(trim(p_invoice_id),'') IS NULL THEN
    RAISE EXCEPTION 'Quotation dan invoice wajib diisi';
  END IF;

  SELECT * INTO inv FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tidak ditemukan'; END IF;
  IF inv.status='CANCELLED' THEN RAISE EXCEPTION 'DP tidak dapat diterapkan ke invoice batal'; END IF;

  UPDATE public.invoices
     SET quotation_id=p_quotation_id
   WHERE id=inv.id AND quotation_id IS NULL;
  IF inv.quotation_id IS NOT NULL AND inv.quotation_id IS DISTINCT FROM p_quotation_id THEN
    RAISE EXCEPTION 'Invoice sudah tertaut ke quotation lain';
  END IF;
  UPDATE public.quotations SET invoice_id=inv.id, updated_at=now()
   WHERE id=p_quotation_id AND (invoice_id IS NULL OR invoice_id=inv.id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation tidak ditemukan atau sudah tertaut ke invoice lain'; END IF;

  SELECT coalesce(sum(amount),0) INTO ledger_before
    FROM public.invoice_payments WHERE invoice_id=inv.id;
  -- Pertahankan pembayaran legacy yang dahulu hanya ditulis ke invoices.paid_amount.
  unledgered_paid:=greatest(coalesce(inv.paid_amount,0)-ledger_before,0);
  room := greatest(coalesce(inv.total,0) - coalesce(inv.paid_amount,0), 0);
  FOR pay IN
    SELECT * FROM public.quotation_payments
     WHERE quotation_id=p_quotation_id
       AND applied_amount < amount
       AND (applied_invoice_id IS NULL OR applied_invoice_id=p_invoice_id)
     ORDER BY paid_at, created_at, id
     FOR UPDATE
  LOOP
    EXIT WHEN room <= 0;
    available := pay.amount-pay.applied_amount;
    used := least(available, room);
    INSERT INTO public.invoice_payments(
      invoice_id,amount,method,notes,paid_at,recorded_by,recorded_by_name,quotation_payment_id
    ) VALUES (
      inv.id,used,pay.method,
      concat('DP dari quotation ',p_quotation_id,
        CASE WHEN nullif(trim(pay.reference),'') IS NOT NULL THEN ' · Ref '||trim(pay.reference) ELSE '' END),
      pay.paid_at,pay.recorded_by,pay.recorded_by_name,pay.id
    );
    UPDATE public.quotation_payments
       SET applied_amount=applied_amount+used,
           applied_invoice_id=inv.id,
           applied_at=now(), updated_at=now()
     WHERE id=pay.id;
    room := room-used;
    applied_total := applied_total+used;
  END LOOP;

  SELECT coalesce(sum(amount),0) INTO payment_total
    FROM public.invoice_payments WHERE invoice_id=inv.id;
  payment_total:=payment_total+unledgered_paid;
  payment_total := least(payment_total, greatest(coalesce(inv.total,0),0));

  UPDATE public.invoices
     SET paid_amount=payment_total,
         remaining_amount=greatest(coalesce(total,0)-payment_total,0),
         status=CASE
           WHEN status='PENDING_APPROVAL' THEN status
           WHEN payment_total >= coalesce(total,0) AND coalesce(total,0)>0 THEN 'PAID'
           WHEN payment_total>0 THEN 'PARTIAL_PAID'
           ELSE status END,
         paid_at=CASE
           WHEN payment_total >= coalesce(total,0) AND coalesce(total,0)>0
             THEN coalesce(paid_at,current_date)
           ELSE paid_at END
   WHERE id=inv.id
   RETURNING * INTO inv;

  RETURN jsonb_build_object(
    'invoice',to_jsonb(inv),
    'applied_now',applied_total,
    'received_total',(SELECT coalesce(sum(amount),0) FROM public.quotation_payments WHERE quotation_id=p_quotation_id),
    'credit_remaining',(SELECT coalesce(sum(amount-applied_amount),0) FROM public.quotation_payments WHERE quotation_id=p_quotation_id)
  );
END $$;

REVOKE ALL ON FUNCTION public.apply_quotation_payments_to_invoice(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_quotation_payments_to_invoice(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_quotation_deposit_atomic(
  p_payment_id uuid,
  p_quotation_id text,
  p_amount numeric,
  p_method text DEFAULT 'transfer',
  p_paid_at date DEFAULT current_date,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_proof_url text DEFAULT NULL,
  p_actor_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  role_name text;
  actor text;
  quo public.quotations%ROWTYPE;
  previous public.quotation_payments%ROWTYPE;
  saved public.quotation_payments%ROWTYPE;
  received numeric;
  apply_result jsonb := NULL;
  existing_invoice_id text;
BEGIN
  role_name := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','Finance','service_role') THEN
    RAISE EXCEPTION 'Akses pencatatan DP ditolak' USING ERRCODE='42501';
  END IF;
  IF p_payment_id IS NULL OR nullif(trim(p_quotation_id),'') IS NULL
     OR p_amount IS NULL OR p_amount<=0 OR p_paid_at IS NULL
     OR lower(trim(coalesce(p_method,''))) NOT IN ('transfer','cash','qris','card','other') THEN
    RAISE EXCEPTION 'Data penerimaan DP tidak lengkap';
  END IF;

  SELECT * INTO quo FROM public.quotations WHERE id=p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation tidak ditemukan'; END IF;
  IF quo.status='CANCELLED' THEN RAISE EXCEPTION 'Quotation sudah dibatalkan'; END IF;
  IF quo.payment_method<>'DOWN_PAYMENT' THEN
    RAISE EXCEPTION 'Quotation bukan menggunakan metode Down Payment';
  END IF;

  SELECT * INTO previous FROM public.quotation_payments WHERE id=p_payment_id;
  IF FOUND THEN
    IF previous.quotation_id IS DISTINCT FROM p_quotation_id
       OR previous.amount IS DISTINCT FROM p_amount
       OR previous.method IS DISTINCT FROM lower(trim(p_method))
       OR previous.paid_at IS DISTINCT FROM p_paid_at THEN
      RAISE EXCEPTION 'ID penerimaan DP sudah dipakai untuk data berbeda';
    END IF;
    RETURN jsonb_build_object('quotation',to_jsonb(quo),'payment',to_jsonb(previous),'application',NULL,'replayed',true);
  END IF;

  SELECT coalesce(sum(amount),0) INTO received
    FROM public.quotation_payments WHERE quotation_id=quo.id;
  IF received+p_amount > quo.total THEN
    RAISE EXCEPTION 'Total penerimaan melebihi nilai quotation (sisa maksimal %)', quo.total-received;
  END IF;

  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid();
  actor := coalesce(actor,nullif(trim(p_actor_name),''),role_name);
  INSERT INTO public.quotation_payments(
    id,quotation_id,amount,method,paid_at,reference,notes,proof_url,recorded_by,recorded_by_name
  ) VALUES (
    p_payment_id,quo.id,p_amount,lower(trim(p_method)),p_paid_at,
    nullif(trim(p_reference),''),nullif(trim(p_notes),''),nullif(trim(p_proof_url),''),auth.uid()::text,actor
  ) RETURNING * INTO saved;

  -- Rekonsiliasi aman untuk quotation lama yang invoice_id-nya belum pernah
  -- dibalik-link, tanpa membuat invoice baru.
  IF quo.invoice_id IS NULL THEN
    SELECT i.id INTO existing_invoice_id
      FROM public.invoices i
     WHERE i.status<>'CANCELLED'
       AND (i.quotation_id=quo.id OR (quo.job_id IS NOT NULL AND i.job_id=quo.job_id))
     ORDER BY i.created_at DESC LIMIT 1;
    IF existing_invoice_id IS NOT NULL THEN
      UPDATE public.quotations SET invoice_id=existing_invoice_id,updated_at=now()
       WHERE id=quo.id RETURNING * INTO quo;
    END IF;
  END IF;
  IF quo.invoice_id IS NOT NULL THEN
    apply_result := public.apply_quotation_payments_to_invoice(quo.id,quo.invoice_id);
    SELECT * INTO saved FROM public.quotation_payments WHERE id=saved.id;
  END IF;
  RETURN jsonb_build_object('quotation',to_jsonb(quo),'payment',to_jsonb(saved),'application',apply_result,'replayed',false);
END $$;

REVOKE ALL ON FUNCTION public.record_quotation_deposit_atomic(uuid,text,numeric,text,date,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_quotation_deposit_atomic(uuid,text,numeric,text,date,text,text,text,text) TO authenticated,service_role;

-- Tautkan invoice aktual ke quotation sumber, termasuk invoice grup team-split.
CREATE OR REPLACE FUNCTION public.resolve_invoice_source_quotation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
DECLARE source_id text; source_count integer;
BEGIN
  IF NEW.quotation_id IS NOT NULL OR NEW.job_id IS NULL THEN RETURN NEW; END IF;
  SELECT count(DISTINCT x.source_quotation_id),min(x.source_quotation_id)
    INTO source_count,source_id
    FROM (
      SELECT o.source_quotation_id FROM public.orders o WHERE o.id=NEW.job_id
      UNION ALL
      SELECT o.source_quotation_id FROM public.orders o
       WHERE o.job_group_id=NEW.job_id AND coalesce(o.is_team_split,false)
    ) x
   WHERE x.source_quotation_id IS NOT NULL;
  IF source_count>1 THEN RAISE EXCEPTION 'Invoice grup memiliki lebih dari satu quotation sumber'; END IF;
  NEW.quotation_id := source_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_resolve_invoice_source_quotation ON public.invoices;
CREATE TRIGGER trg_resolve_invoice_source_quotation
BEFORE INSERT OR UPDATE OF job_id ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.resolve_invoice_source_quotation();

CREATE OR REPLACE FUNCTION public.apply_invoice_quotation_deposit_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF NEW.quotation_id IS NOT NULL AND NEW.status<>'CANCELLED' THEN
    PERFORM public.apply_quotation_payments_to_invoice(NEW.quotation_id,NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_apply_invoice_quotation_deposit ON public.invoices;
CREATE TRIGGER trg_apply_invoice_quotation_deposit
AFTER INSERT OR UPDATE OF quotation_id,total ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.apply_invoice_quotation_deposit_trigger();

DROP TRIGGER IF EXISTS trg_apply_invoice_quotation_deposit_on_status ON public.invoices;
CREATE TRIGGER trg_apply_invoice_quotation_deposit_on_status
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status AND NEW.quotation_id IS NOT NULL AND NEW.status<>'CANCELLED')
EXECUTE FUNCTION public.apply_invoice_quotation_deposit_trigger();

-- Unified cash source: DP dihitung pada tanggal diterima. Saat kemudian masuk ke
-- invoice_payments, baris turunan dikecualikan supaya Finance tidak double-count.
CREATE OR REPLACE VIEW public.finance_cash_events AS
SELECT i.id,i.job_id,i.customer,i.service,i.status,i.total,
       ip.amount AS cash_amount,ip.amount AS paid_amount,
       ip.paid_at AS cash_date,ip.paid_at,i.created_at
  FROM public.invoice_payments ip JOIN public.invoices i ON i.id=ip.invoice_id
 WHERE ip.quotation_payment_id IS NULL
UNION ALL
SELECT 'DP-'||qp.id::text,q.job_id,q.customer,'Down Payment Quotation','DP_RECEIVED',q.total,
       qp.amount,qp.amount,qp.paid_at,qp.paid_at,qp.created_at
  FROM public.quotation_payments qp JOIN public.quotations q ON q.id=qp.quotation_id
UNION ALL
SELECT i.id,i.job_id,i.customer,i.service,i.status,i.total,
       greatest(CASE WHEN i.status='PAID' THEN coalesce(i.total,0) ELSE coalesce(i.paid_amount,0) END-ledger.amount,0),
       greatest(CASE WHEN i.status='PAID' THEN coalesce(i.total,0) ELSE coalesce(i.paid_amount,0) END-ledger.amount,0),
       i.paid_at::date,i.paid_at,i.created_at
  FROM public.invoices i
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(ip.amount),0) amount FROM public.invoice_payments ip WHERE ip.invoice_id=i.id
  ) ledger
 WHERE i.status IN ('PAID','PARTIAL_PAID') AND i.paid_at IS NOT NULL
   AND (CASE WHEN i.status='PAID' THEN coalesce(i.total,0) ELSE coalesce(i.paid_amount,0) END)>ledger.amount;

REVOKE ALL ON public.finance_cash_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.finance_cash_events TO service_role;

-- Finance summary yang dipakai UI membaca unified ledger di atas. Dengan ini DP
-- terlihat sebagai kas pada tanggal diterima, bahkan sebelum invoice aktual lahir.
CREATE OR REPLACE FUNCTION public.get_finance_summary_v2(
  p_day date DEFAULT current_date,
  p_month_start date DEFAULT date_trunc('month',current_date)::date,
  p_month_end date DEFAULT (date_trunc('month',current_date)+interval '1 month - 1 day')::date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE role_name text; result jsonb;
BEGIN
  role_name:=CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses Finance ditolak' USING ERRCODE='42501'; END IF;
  IF p_month_start>p_month_end THEN RAISE EXCEPTION 'Rentang bulan Finance tidak valid'; END IF;
  WITH valid_expenses AS (
    SELECT * FROM public.expenses WHERE deleted_at IS NULL
      AND coalesce(approval_status,'')<>'PENDING_APPROVAL'
      AND coalesce(validation_status,'')<>'PENDING_AI'
  ), cash_events AS (
    SELECT * FROM public.finance_cash_events
  ), day_cash AS (
    SELECT id,job_id,customer,service,max(status) status,max(total) total,
      sum(cash_amount) cash_amount,sum(paid_amount) paid_amount,cash_date paid_at
    FROM cash_events WHERE cash_date=p_day GROUP BY id,job_id,customer,service,cash_date
  ), month_expenses AS (
    SELECT * FROM valid_expenses WHERE date BETWEEN p_month_start AND p_month_end
  )
  SELECT jsonb_build_object(
    'generated_at',now(),'day',p_day,'month_start',p_month_start,'month_end',p_month_end,
    'summary',jsonb_build_object(
      'cash_all_time',coalesce((SELECT sum(cash_amount) FROM cash_events),0),
      'expenses_all_time',coalesce((SELECT sum(amount) FROM valid_expenses),0),
      'paid_count',(SELECT count(*) FROM public.invoices WHERE status='PAID'),
      'unpaid_count',(SELECT count(*) FROM public.invoices WHERE status IN ('UNPAID','OVERDUE')),
      'overdue_count',(SELECT count(*) FROM public.invoices WHERE status='OVERDUE'),
      'month_cash',coalesce((SELECT sum(cash_amount) FROM cash_events WHERE cash_date BETWEEN p_month_start AND p_month_end),0),
      'month_expenses',coalesce((SELECT sum(amount) FROM month_expenses),0),
      'day_cash',coalesce((SELECT sum(cash_amount) FROM day_cash),0),
      'day_paid_count',(SELECT count(*) FROM day_cash)
    ),
    'day_cash_rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM day_cash x),'[]'::jsonb),
    'top_expenses',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.total DESC) FROM (
      SELECT coalesce(subcategory,category,'Lain-lain') name,sum(amount) total
      FROM month_expenses GROUP BY coalesce(subcategory,category,'Lain-lain') ORDER BY sum(amount) DESC LIMIT 10
    ) x),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_finance_summary_v2(date,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_finance_summary_v2(date,date,date) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_finance_month_details(p_month_start date,p_month_end date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE role_name text; result jsonb;
BEGIN
  role_name:=CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses Finance ditolak' USING ERRCODE='42501'; END IF;
  IF p_month_start IS NULL OR p_month_end IS NULL OR p_month_start>p_month_end THEN RAISE EXCEPTION 'Rentang bulan Finance tidak valid'; END IF;
  WITH valid_expenses AS (
    SELECT id,date,category,subcategory,description,item_name,amount FROM public.expenses
     WHERE deleted_at IS NULL AND coalesce(approval_status,'')<>'PENDING_APPROVAL'
       AND coalesce(validation_status,'')<>'PENDING_AI' AND date BETWEEN p_month_start AND p_month_end
  ), cash_events AS (
    SELECT * FROM public.finance_cash_events WHERE cash_date BETWEEN p_month_start AND p_month_end
  ), month_invoices AS (
    SELECT id,job_id,customer,service,max(status) status,max(total) total,
      sum(cash_amount) cash_amount,sum(paid_amount) paid_amount,cash_date paid_at,max(created_at) created_at
    FROM cash_events GROUP BY id,job_id,customer,service,cash_date
  )
  SELECT jsonb_build_object(
    'month_invoices',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY coalesce(x.paid_at::date,x.created_at::date) DESC) FROM month_invoices x),'[]'::jsonb),
    'month_expenses',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.date DESC,x.id) FROM valid_expenses x),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_finance_month_details(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_finance_month_details(date,date) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_finance_snapshot(
  p_day date DEFAULT current_date,
  p_month_start date DEFAULT date_trunc('month',current_date)::date,
  p_month_end date DEFAULT (date_trunc('month',current_date)+interval '1 month - 1 day')::date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE role_name text; result jsonb;
BEGIN
  role_name:=CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','Finance','service_role') THEN RAISE EXCEPTION 'Akses Finance ditolak' USING ERRCODE='42501'; END IF;
  IF p_month_start>p_month_end THEN RAISE EXCEPTION 'Rentang bulan Finance tidak valid'; END IF;
  WITH valid_expenses AS (
    SELECT * FROM public.expenses WHERE deleted_at IS NULL
      AND coalesce(approval_status,'')<>'PENDING_APPROVAL' AND coalesce(validation_status,'')<>'PENDING_AI'
  ), month_invoices AS (
    SELECT id,job_id,customer,service,max(status) status,max(total) total,
      sum(cash_amount) cash_amount,sum(paid_amount) paid_amount,cash_date paid_at,max(created_at) created_at
    FROM public.finance_cash_events WHERE cash_date BETWEEN p_month_start AND p_month_end
    GROUP BY id,job_id,customer,service,cash_date
  ), month_expenses AS (
    SELECT id,date,category,subcategory,description,item_name,amount FROM valid_expenses
     WHERE date BETWEEN p_month_start AND p_month_end
  ), day_cash AS (
    SELECT id,job_id,customer,service,max(status) status,max(total) total,
      sum(cash_amount) cash_amount,sum(paid_amount) paid_amount,cash_date paid_at
    FROM public.finance_cash_events WHERE cash_date=p_day GROUP BY id,job_id,customer,service,cash_date
  )
  SELECT jsonb_build_object(
    'generated_at',now(),'day',p_day,'month_start',p_month_start,'month_end',p_month_end,
    'summary',jsonb_build_object(
      'cash_all_time',coalesce((SELECT sum(cash_amount) FROM public.finance_cash_events),0),
      'expenses_all_time',coalesce((SELECT sum(amount) FROM valid_expenses),0),
      'paid_count',(SELECT count(*) FROM public.invoices WHERE status='PAID'),
      'unpaid_count',(SELECT count(*) FROM public.invoices WHERE status IN ('UNPAID','OVERDUE')),
      'overdue_count',(SELECT count(*) FROM public.invoices WHERE status='OVERDUE'),
      'month_cash',coalesce((SELECT sum(cash_amount) FROM month_invoices),0),
      'month_expenses',coalesce((SELECT sum(amount) FROM month_expenses),0),
      'day_cash',coalesce((SELECT sum(cash_amount) FROM day_cash),0),
      'day_paid_count',(SELECT count(*) FROM day_cash)
    ),
    'month_invoices',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY coalesce(x.paid_at::date,x.created_at::date) DESC) FROM month_invoices x),'[]'::jsonb),
    'month_expenses',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.date DESC,x.id) FROM month_expenses x),'[]'::jsonb),
    'day_cash_rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM day_cash x),'[]'::jsonb),
    'top_expenses',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.total DESC) FROM (
      SELECT coalesce(subcategory,category,'Lain-lain') name,sum(amount) total FROM month_expenses
      GROUP BY coalesce(subcategory,category,'Lain-lain') ORDER BY sum(amount) DESC LIMIT 10
    ) x),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_finance_snapshot(date,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_finance_snapshot(date,date,date) TO authenticated,service_role;

COMMIT;
