-- Migration 221: match the legacy payments header schema in production.
-- payments.invoice_id is NOT NULL and references invoices(id); the group
-- allocation ledger remains the source of per-invoice amounts. The header
-- points to the first invoice that actually receives cash. No old rows change.
BEGIN;

DO $migration$
DECLARE
  definition text;
  old_declaration text := 'locked_count integer:=0; claimed integer; mkey text; proof_url text';
  old_allocation text := '    allocated:=least(left_over,inv.total-coalesce(inv.paid_amount,0));';
  old_columns text := 'INSERT INTO public.payments(customer_phone,customer_name,total_amount,amount,method,is_partial,invoice_ids,';
  old_values text := 'VALUES(customer_phone,first_customer,p_total_received,p_total_received,p_method,p_total_received<total_due,ids,';
BEGIN
  SELECT pg_get_functiondef('public.record_group_payment_atomic(uuid,text[],numeric,timestamptz,text,text,jsonb,text,uuid,boolean)'::regprocedure)
    INTO definition;
  IF position('anchor_invoice_id text;' IN definition)>0 THEN
    RETURN; -- The same source may be applied twice during a manual recovery.
  END IF;
  IF position(old_declaration IN definition)=0 OR position(old_allocation IN definition)=0
    OR position(old_columns IN definition)=0 OR position(old_values IN definition)=0 THEN
    RAISE EXCEPTION 'Group payment function differs from migration 220; inspect before applying 221';
  END IF;
  definition:=replace(definition,old_declaration,
    'locked_count integer:=0; claimed integer; mkey text; anchor_invoice_id text; proof_url text');
  definition:=replace(definition,old_allocation,
    old_allocation||E'\n    anchor_invoice_id:=coalesce(anchor_invoice_id,inv.id);');
  definition:=replace(definition,old_columns,
    'INSERT INTO public.payments(invoice_id,customer_phone,customer_name,total_amount,amount,method,is_partial,invoice_ids,');
  definition:=replace(definition,old_values,
    'VALUES(anchor_invoice_id,customer_phone,first_customer,p_total_received,p_total_received,p_method,p_total_received<total_due,ids,');
  EXECUTE definition;
END $migration$;

-- Migration 220 accepts named bank/e-wallet methods. The old header CHECK
-- only accepted broad categories, so those selections would fail after the
-- invoice_id fix. Keep all legacy values and add the methods in the RPC.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_check CHECK
  (method IN ('cash','transfer','transfer_bca','transfer_bni','transfer_bri',
              'transfer_mandiri','transfer_gopay','transfer_ovo','transfer_dana',
              'gopay','ovo','dana','qris','other','lainnya'));

NOTIFY pgrst,'reload schema';
COMMIT;
