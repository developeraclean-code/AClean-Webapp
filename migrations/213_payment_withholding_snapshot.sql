-- Fix the 212 false stale-invoice error: the browser parses materials_detail
-- into an array while the database stores JSON text. Compare JSON contents,
-- not the storage format. Preserve every financial/proof/replay guard in 212.
-- No historical invoice, payment, suggestion or stored request is rewritten.
BEGIN;

CREATE OR REPLACE FUNCTION public.payment_review_snapshot_213(p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE items jsonb; encoded text;
BEGIN
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR NOT (p_snapshot ? 'materials_detail') THEN
    RAISE EXCEPTION 'Rincian item snapshot tidak lengkap; muat ulang dan periksa invoice';
  END IF;
  items:=p_snapshot->'materials_detail';
  IF jsonb_typeof(items)='string' THEN
    encoded:=items#>>'{}';
    IF trim(encoded)='' THEN items:='[]'::jsonb;
    ELSE
      BEGIN items:=encoded::jsonb;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Rincian item invoice bukan JSON yang valid; periksa invoice sebelum pembayaran';
      END;
    END IF;
  END IF;
  IF items IS NULL OR items='null'::jsonb THEN items:='[]'::jsonb; END IF;
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Rincian item invoice harus berupa daftar; periksa invoice sebelum pembayaran';
  END IF;
  RETURN jsonb_set(p_snapshot,'{materials_detail}',items,false);
END $$;
REVOKE ALL ON FUNCTION public.payment_review_snapshot_213(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.payment_review_snapshot_213(jsonb) TO service_role;

-- A retry across frontend versions may carry array vs text in the original
-- request. Normalize only that snapshot; invoice, proof, date, note and all
-- other request fields remain exact. Missing/unrelated requests stay unequal.
CREATE OR REPLACE FUNCTION public.payment_review_request_213(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_catalog AS $$
BEGIN
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR NOT (p_request ? 'expected_invoice') THEN RETURN p_request; END IF;
  RETURN jsonb_set(p_request,'{expected_invoice}',public.payment_review_snapshot_213(p_request->'expected_invoice'),false);
END $$;
REVOKE ALL ON FUNCTION public.payment_review_request_213(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.payment_review_request_213(jsonb) TO service_role;

-- Patch exactly two comparisons in the existing, already deployed function.
-- Fail closed if its expected source has changed, instead of replacing any
-- other payment logic or silently applying only half the correction.
DO $$
DECLARE definition text;
  old_snapshot text:='IF snapshot IS DISTINCT FROM p_expected_invoice THEN';
  new_snapshot text:='IF public.payment_review_snapshot_213(snapshot) IS DISTINCT FROM public.payment_review_snapshot_213(p_expected_invoice) THEN';
  old_replay text:='OR payment.withholding_detail->''request'' IS DISTINCT FROM payload';
  new_replay text:='OR public.payment_review_request_213(payment.withholding_detail->''request'') IS DISTINCT FROM public.payment_review_request_213(payload)';
BEGIN
  definition:=pg_get_functiondef('public.confirm_invoice_wa_withholding_atomic(uuid,text,uuid,text,jsonb,date,text,boolean)'::regprocedure);
  IF position(new_snapshot in definition)>0 AND position(new_replay in definition)>0
    AND position(old_snapshot in definition)=0 AND position(old_replay in definition)=0 THEN RETURN; END IF;
  IF length(definition)-length(replace(definition,old_snapshot,''))<>length(old_snapshot)
    OR length(definition)-length(replace(definition,old_replay,''))<>length(old_replay) THEN
    RAISE EXCEPTION 'Definisi verifikasi pembayaran berbeda dari migrasi 212; hentikan dan periksa sebelum migrasi 213';
  END IF;
  EXECUTE replace(replace(definition,old_snapshot,new_snapshot),old_replay,new_replay);
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
