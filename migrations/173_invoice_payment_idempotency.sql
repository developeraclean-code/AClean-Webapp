-- 173 — Catat cicilan invoice dan saldo dalam satu transaksi, aman untuk retry.
-- ID pembayaran dibuat sekali di browser; klik/retry dengan ID itu tidak boleh
-- menambah ledger dua kali. Jangan pakai nomor telepon/nominal sebagai dedup key.
BEGIN;

CREATE OR REPLACE FUNCTION public.record_invoice_partial_payment_atomic(
  p_payment_id uuid, p_invoice_id text, p_amount numeric,
  p_method text, p_notes text, p_paid_at date, p_actor_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  actor_role text;
  actor_name text;
  inv public.invoices%ROWTYPE;
  previous public.invoice_payments%ROWTYPE;
  already_paid numeric;
  remaining numeric;
BEGIN
  actor_role := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role NOT IN ('Owner','Admin','Finance','service_role') THEN
    RAISE EXCEPTION 'Akses pembayaran ditolak' USING ERRCODE = '42501';
  END IF;
  IF p_payment_id IS NULL OR nullif(trim(p_invoice_id),'') IS NULL
     OR p_amount IS NULL OR p_amount <= 0 OR p_paid_at IS NULL
     OR nullif(trim(p_method),'') IS NULL THEN
    RAISE EXCEPTION 'Data pembayaran tidak lengkap';
  END IF;

  -- Kunci invoice menserialkan dua admin/tab yang mencatat pembayaran bersamaan.
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice tidak ditemukan'; END IF;
  SELECT * INTO previous FROM public.invoice_payments WHERE id = p_payment_id;
  IF FOUND THEN
    IF previous.invoice_id IS DISTINCT FROM p_invoice_id
       OR previous.amount IS DISTINCT FROM p_amount
       OR previous.method IS DISTINCT FROM p_method
       OR previous.paid_at IS DISTINCT FROM p_paid_at
       OR previous.notes IS DISTINCT FROM nullif(trim(p_notes),'') THEN
      RAISE EXCEPTION 'ID pembayaran sudah dipakai untuk data berbeda';
    END IF;
    RETURN jsonb_build_object('invoice',to_jsonb(inv),'payment',to_jsonb(previous),'replayed',true);
  END IF;

  IF inv.status IN ('PAID','CANCELLED') THEN RAISE EXCEPTION 'Invoice sudah lunas/dibatalkan'; END IF;
  already_paid := greatest(0, coalesce(inv.paid_amount, 0));
  remaining := greatest(0, coalesce(inv.total, 0) - already_paid);
  IF p_amount > remaining THEN RAISE EXCEPTION 'Nominal melebihi sisa tagihan (%)', remaining; END IF;

  SELECT name INTO actor_name FROM public.user_profiles WHERE id = auth.uid();
  actor_name := coalesce(actor_name, nullif(trim(p_actor_name),''), actor_role);
  INSERT INTO public.invoice_payments
    (id,invoice_id,amount,method,notes,paid_at,recorded_by_name)
  VALUES
    (p_payment_id,p_invoice_id,p_amount,p_method,nullif(trim(p_notes),''),p_paid_at,actor_name)
  RETURNING * INTO previous;

  UPDATE public.invoices
     SET paid_amount = already_paid + p_amount,
         remaining_amount = remaining - p_amount,
         status = CASE WHEN remaining = p_amount THEN 'PAID' ELSE 'PARTIAL_PAID' END,
         paid_at = CASE WHEN remaining = p_amount THEN p_paid_at ELSE paid_at END
   WHERE id = p_invoice_id RETURNING * INTO inv;

  RETURN jsonb_build_object('invoice',to_jsonb(inv),'payment',to_jsonb(previous),'replayed',false);
END $$;

REVOKE ALL ON FUNCTION public.record_invoice_partial_payment_atomic(uuid,text,numeric,text,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_partial_payment_atomic(uuid,text,numeric,text,text,date,text) TO authenticated, service_role;
COMMIT;
