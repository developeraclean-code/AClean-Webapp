-- 171 — service_reports.id pada database AClean adalah TEXT, bukan UUID.
-- Migration 170 sudah terpasang dengan signature UUID; ganti dengan signature yang benar.

BEGIN;

DROP FUNCTION IF EXISTS public.record_report_card_wa_sent(uuid,text,text,text);

CREATE OR REPLACE FUNCTION public.record_report_card_wa_sent(
  p_report_id text,
  p_mode text DEFAULT 'single',
  p_actor_name text DEFAULT NULL,
  p_method text DEFAULT 'fonnte'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  actor_role text;
  actor_name text;
  result jsonb;
BEGIN
  actor_role := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin yang dapat mencatat pengiriman Report Card' USING ERRCODE = '42501';
  END IF;
  IF p_mode NOT IN ('single','invoice_view','schedule') THEN
    RAISE EXCEPTION 'Mode pengiriman Report Card tidak valid';
  END IF;
  IF nullif(trim(p_method), '') IS NULL THEN
    RAISE EXCEPTION 'Metode pengiriman Report Card wajib diisi';
  END IF;

  SELECT name INTO actor_name FROM public.user_profiles WHERE id = auth.uid();
  actor_name := coalesce(actor_name, nullif(trim(p_actor_name), ''), actor_role);

  UPDATE public.service_reports r
     SET report_card_sent_at = now(),
         report_card_sent_by = actor_name,
         report_card_sent_count = coalesce(r.report_card_sent_count, 0) + 1,
         report_card_last_sent_mode = p_mode,
         report_card_last_sent_method = lower(trim(p_method)),
         updated_at = now()
   WHERE r.id = p_report_id
   RETURNING to_jsonb(r) INTO result;

  IF result IS NULL THEN RAISE EXCEPTION 'Service Report tidak ditemukan'; END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.record_report_card_wa_sent(text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_report_card_wa_sent(text,text,text,text) TO authenticated, service_role;

COMMIT;
