-- 185 — Bulk pencairan bonus dan verifikasi invoice PAID tanpa bukti.
--
-- Dua aksi massal ini sebelumnya berisiko dijalankan sebagai beberapa UPDATE dari
-- browser. RPC berikut mengunci seluruh target, memvalidasi semuanya, lalu commit
-- sebagai satu transaksi. operational_mutations memberi audit + idempotency.

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_order_bonuses_paid_bulk_atomic(
  p_bonus_ids uuid[],
  p_actor_name text DEFAULT NULL,
  p_mutation_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  role_name text;
  actor text;
  ids uuid[];
  expected_count integer;
  found_count integer;
  invalid_count integer;
  updated_count integer;
  total_paid numeric;
  result_value jsonb;
  claimed integer;
  mkey text;
BEGIN
  role_name := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner', 'Finance', 'service_role') THEN
    RAISE EXCEPTION 'Hanya Owner/Finance yang dapat membayar bonus' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT x), '{}'::uuid[]) INTO ids
  FROM unnest(coalesce(p_bonus_ids, '{}'::uuid[])) AS x
  WHERE x IS NOT NULL;
  expected_count := cardinality(ids);
  IF expected_count = 0 THEN RAISE EXCEPTION 'Tidak ada bonus siap cair yang dipilih'; END IF;

  SELECT name INTO actor FROM public.user_profiles WHERE id = auth.uid();
  actor := coalesce(actor, nullif(trim(p_actor_name), ''), role_name);
  mkey := coalesce(nullif(trim(p_mutation_key), ''), 'bonus-bulk:' || md5(array_to_string(ids, ',')));

  INSERT INTO public.operational_mutations(mutation_key, operation, actor_id, actor_name)
  VALUES (mkey, 'BULK_PAY_ORDER_BONUSES', auth.uid(), actor)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed = ROW_COUNT;
  IF claimed = 0 THEN
    SELECT result INTO result_value FROM public.operational_mutations WHERE mutation_key = mkey;
    RETURN coalesce(result_value, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;

  -- Kunci seluruh target sebelum validasi agar perubahan parsial/race tidak mungkin.
  PERFORM 1 FROM public.order_bonuses WHERE id = ANY(ids) FOR UPDATE;
  SELECT count(*) INTO found_count FROM public.order_bonuses WHERE id = ANY(ids);
  IF found_count <> expected_count THEN
    RAISE EXCEPTION 'Sebagian bonus tidak ditemukan; pembayaran dibatalkan';
  END IF;

  SELECT count(*) INTO invalid_count
  FROM public.order_bonuses
  WHERE id = ANY(ids)
    AND NOT (
      (status = 'ELIGIBLE' OR (status = 'PENDING' AND order_date <= current_date - 30))
      AND coalesce(total_amount, 0) > 0
      AND coalesce(array_length(team_members, 1), 0) > 0
    );
  IF invalid_count > 0 THEN
    RAISE EXCEPTION '% bonus bukan Siap Cair / nilai atau tim belum valid; pembayaran dibatalkan', invalid_count;
  END IF;

  WITH changed AS (
    UPDATE public.order_bonuses
       SET status = 'PAID', paid_at = now(), paid_by = actor, updated_at = now()
     WHERE id = ANY(ids)
     RETURNING id, total_amount
  )
  SELECT count(*), coalesce(sum(total_amount), 0)
    INTO updated_count, total_paid
  FROM changed;

  result_value := jsonb_build_object(
    'updated_count', updated_count,
    'total_paid', total_paid,
    'bonus_ids', to_jsonb(ids),
    'paid_by', actor,
    'paid_at', now(),
    'replayed', false
  );
  UPDATE public.operational_mutations
     SET result = result_value, completed_at = now()
   WHERE mutation_key = mkey;
  RETURN result_value;
END $$;

REVOKE ALL ON FUNCTION public.mark_order_bonuses_paid_bulk_atomic(uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_order_bonuses_paid_bulk_atomic(uuid[], text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.acknowledge_paid_invoices_without_proof_atomic(
  p_invoice_ids text[],
  p_mode text,
  p_actor_name text DEFAULT NULL,
  p_mutation_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  role_name text;
  actor text;
  ids text[];
  expected_count integer;
  found_count integer;
  invalid_count integer;
  updated_count integer;
  result_value jsonb;
  claimed integer;
  mkey text;
  audit_note text;
BEGIN
  role_name := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner', 'Finance', 'service_role') THEN
    RAISE EXCEPTION 'Hanya Owner/Finance yang dapat memverifikasi pembayaran tanpa bukti' USING ERRCODE = '42501';
  END IF;
  IF p_mode NOT IN ('cash', 'no_proof') THEN RAISE EXCEPTION 'Mode verifikasi tidak valid'; END IF;

  SELECT coalesce(array_agg(DISTINCT trim(x)), '{}'::text[]) INTO ids
  FROM unnest(coalesce(p_invoice_ids, '{}'::text[])) AS x
  WHERE nullif(trim(x), '') IS NOT NULL;
  expected_count := cardinality(ids);
  IF expected_count = 0 THEN RAISE EXCEPTION 'Tidak ada invoice yang dipilih'; END IF;

  SELECT name INTO actor FROM public.user_profiles WHERE id = auth.uid();
  actor := coalesce(actor, nullif(trim(p_actor_name), ''), role_name);
  mkey := coalesce(nullif(trim(p_mutation_key), ''), 'invoice-no-proof:' || p_mode || ':' || md5(array_to_string(ids, ',')));

  INSERT INTO public.operational_mutations(mutation_key, operation, actor_id, actor_name)
  VALUES (mkey, CASE WHEN p_mode = 'cash' THEN 'ACK_PAID_CASH' ELSE 'ACK_PAID_WITHOUT_PROOF' END, auth.uid(), actor)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed = ROW_COUNT;
  IF claimed = 0 THEN
    SELECT result INTO result_value FROM public.operational_mutations WHERE mutation_key = mkey;
    RETURN coalesce(result_value, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;

  PERFORM 1 FROM public.invoices WHERE id = ANY(ids) FOR UPDATE;
  SELECT count(*) INTO found_count FROM public.invoices WHERE id = ANY(ids);
  IF found_count <> expected_count THEN
    RAISE EXCEPTION 'Sebagian invoice tidak ditemukan; verifikasi dibatalkan';
  END IF;

  SELECT count(*) INTO invalid_count
  FROM public.invoices
  WHERE id = ANY(ids)
    AND NOT (
      status = 'PAID'
      AND coalesce(total, 0) > 0
      -- Kolom legacy ini bertipe TEXT: NULL/kosong = invoice normal,
      -- nilai seperti gratis-garansi/gratis-customer = jangan ikut aksi massal.
      AND nullif(trim(coalesce(repair_gratis, '')), '') IS NULL
      AND nullif(trim(payment_proof_url), '') IS NULL
    );
  IF invalid_count > 0 THEN
    RAISE EXCEPTION '% invoice sudah berubah / tidak memenuhi syarat; verifikasi dibatalkan', invalid_count;
  END IF;

  audit_note := CASE WHEN p_mode = 'cash'
    THEN 'Pembayaran cash dikonfirmasi oleh ' || actor
    ELSE 'Lunas tanpa bukti dikonfirmasi oleh ' || actor
  END;

  WITH changed AS (
    UPDATE public.invoices
       SET payment_proof_url = 'verified-no-proof',
           paid_method = CASE
             WHEN p_mode = 'cash' THEN 'cash'
             ELSE coalesce(nullif(trim(paid_method), ''), 'manual_no_proof')
           END,
           notes = concat_ws(E'\n', nullif(trim(notes), ''), audit_note),
           last_changed_by = actor,
           updated_at = now()
     WHERE id = ANY(ids)
     RETURNING id
  )
  SELECT count(*) INTO updated_count FROM changed;

  result_value := jsonb_build_object(
    'updated_count', updated_count,
    'invoice_ids', to_jsonb(ids),
    'mode', p_mode,
    'actor', actor,
    'acknowledged_at', now(),
    'replayed', false
  );
  UPDATE public.operational_mutations
     SET result = result_value, completed_at = now()
   WHERE mutation_key = mkey;
  RETURN result_value;
END $$;

REVOKE ALL ON FUNCTION public.acknowledge_paid_invoices_without_proof_atomic(text[], text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_paid_invoices_without_proof_atomic(text[], text, text, text) TO authenticated, service_role;

COMMIT;
