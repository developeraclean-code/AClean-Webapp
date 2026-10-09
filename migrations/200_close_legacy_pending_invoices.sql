-- Penutupan administratif 13 invoice legacy atas instruksi Owner 9 Okt 2026.
-- Ini menandai lunas di sistem, BUKAN klaim bahwa bukti transfer ditemukan.
-- Nilai positif dicatat di invoice_payments dengan metode khusus agar jejaknya jelas.
BEGIN;

DO $$
DECLARE
  target record;
  inv public.invoices%ROWTYPE;
  linked_order public.orders%ROWTYPE;
  report_status text;
  actor_name text := 'Owner::legacy_reconciliation_20261009';
  closure_note text := '[LEGACY-20261009] Penutupan administratif invoice pending lama atas instruksi Owner; bukti pembayaran tidak tersedia.';
  paid_date date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('INV-20260402-7LGQN', 100000::numeric),
      ('INV-20260406-P5NJO', 250000::numeric),
      ('INV-20260406-NZJTS', 85000::numeric),
      ('INV-20260406-I5KNU', 100000::numeric),
      ('INV-20260406-XJA4E', 200000::numeric),
      ('INV-20260407-L5B6K', 100000::numeric),
      ('INV-20260408-0CT6N', 200000::numeric),
      ('INV-20260408-0R07X', 400000::numeric),
      ('INV-20260408-RYGNQ', 100000::numeric),
      ('INV-20260408-KWZ3E', 100000::numeric),
      ('INV-20260408-XKN4E', 90000::numeric),
      ('INV-20260409-ZRDVR', 100000::numeric),
      ('INV-20261007-S9YLQ', 0::numeric)
    ) AS v(invoice_id, expected_total)
  LOOP
    SELECT * INTO inv FROM public.invoices WHERE id = target.invoice_id FOR UPDATE;
    IF NOT FOUND OR inv.total IS DISTINCT FROM target.expected_total THEN
      RAISE EXCEPTION 'Legacy invoice missing or amount changed: %', target.invoice_id;
    END IF;
    IF inv.status = 'PAID' AND inv.paid_method = 'legacy_reconciliation'
       AND inv.notes LIKE '%[LEGACY-20261009]%' THEN
      CONTINUE;
    END IF;
    IF inv.status IS DISTINCT FROM 'PENDING_APPROVAL'
       OR coalesce(inv.paid_amount, 0) <> 0
       OR inv.quotation_id IS NOT NULL
       OR inv.payment_proof_url IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.invoice_payments p WHERE p.invoice_id = inv.id) THEN
      RAISE EXCEPTION 'Legacy invoice has unexpected payment/status: %', target.invoice_id;
    END IF;

    SELECT * INTO linked_order FROM public.orders WHERE id = inv.job_id FOR UPDATE;
    SELECT status INTO report_status FROM public.service_reports WHERE job_id = inv.job_id;
    IF NOT FOUND OR linked_order.id IS NULL OR report_status IS DISTINCT FROM 'VERIFIED'
       OR linked_order.invoice_id IS DISTINCT FROM inv.id THEN
      RAISE EXCEPTION 'Legacy invoice order/report linkage changed: %', target.invoice_id;
    END IF;

    IF inv.total > 0 THEN
      INSERT INTO public.invoice_payments
        (invoice_id, amount, method, notes, paid_at, recorded_by_name)
      VALUES
        (inv.id, inv.total, 'legacy_reconciliation', closure_note, paid_date, actor_name);
    END IF;

    UPDATE public.invoices
       SET status = 'PAID', approved_by = actor_name, approved_at = now(),
           paid_at = now(), paid_method = 'legacy_reconciliation',
           paid_amount = inv.total, remaining_amount = 0,
           notes = concat_ws(' · ', nullif(trim(inv.notes), ''), closure_note),
           last_changed_by = actor_name
     WHERE id = inv.id;

    UPDATE public.orders
       SET status = 'PAID', last_changed_by = actor_name
     WHERE id = inv.job_id;
  END LOOP;
END $$;

COMMIT;
