-- Read-only definition snapshot, 2026-11-12; no customer data.
CREATE OR REPLACE FUNCTION public.guard_combined_transfer_229()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF TG_TABLE_NAME='invoice_payments' THEN
    IF TG_OP IN ('UPDATE','DELETE') AND OLD.combined_transfer_detail IS NOT NULL THEN
      RAISE EXCEPTION 'Alokasi transfer gabungan tidak boleh diubah/dihapus lewat jalur biasa';
    END IF;
    -- Custom GUCs can be set by clients. They are never sufficient on their own:
    -- allow only the security-definer owner to add audit metadata, without
    -- changing any existing financial field in the same UPDATE.
    IF TG_OP='UPDATE' AND NEW.combined_transfer_detail IS NOT NULL
      AND current_setting('app.combined_transfer_write',true)='allowed'
      AND current_user=(SELECT pg_get_userbyid(proowner) FROM pg_proc
        WHERE oid='public.confirm_invoice_wa_combined_transfer_atomic(uuid,text,uuid,text,jsonb,date,text,boolean)'::regprocedure)
      AND (to_jsonb(NEW)-ARRAY['combined_transfer_detail','updated_at']) IS NOT DISTINCT FROM
          (to_jsonb(OLD)-ARRAY['combined_transfer_detail','updated_at']) THEN
      RETURN NEW;
    END IF;
    IF TG_OP IN ('INSERT','UPDATE') AND NEW.combined_transfer_detail IS NOT NULL THEN
      RAISE EXCEPTION 'Alokasi transfer gabungan hanya boleh dicatat lewat verifikasi atomik';
    END IF;
  ELSE
    IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=OLD.id AND ip.combined_transfer_detail IS NOT NULL) THEN
      RAISE EXCEPTION 'Invoice dengan alokasi transfer gabungan tidak boleh dihapus';
    END IF;
    IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=OLD.id AND ip.combined_transfer_detail IS NOT NULL)
      AND (to_jsonb(NEW)-ARRAY['updated_at','pdf_url','pdf_generated_at','last_changed_by','sent','sent_at','wa_sent_count','wa_last_sent_at','wa_last_sent_by','wa_last_sent_mode','wa_last_sent_method']) IS DISTINCT FROM
          (to_jsonb(OLD)-ARRAY['updated_at','pdf_url','pdf_generated_at','last_changed_by','sent','sent_at','wa_sent_count','wa_last_sent_at','wa_last_sent_by','wa_last_sent_mode','wa_last_sent_method']) THEN
      RAISE EXCEPTION 'Invoice dengan alokasi transfer gabungan dikunci untuk perubahan/revert biasa';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_invoice_total_against_payments()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE ledger_total numeric;
BEGIN
  SELECT coalesce(sum(amount),0) INTO ledger_total
    FROM public.invoice_payments WHERE invoice_id=OLD.id;
  ledger_total:=greatest(ledger_total,coalesce(OLD.paid_amount,0));
  IF coalesce(NEW.total,0)<ledger_total THEN
    RAISE EXCEPTION 'Total invoice tidak boleh lebih kecil dari pembayaran yang sudah diterima (%)',ledger_total;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_reviewed_withholding_212()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF current_setting('app.reviewed_withholding_write',true)='allowed' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='invoice_payments' THEN
    IF TG_OP IN ('DELETE','UPDATE') THEN
      IF OLD.withheld_amount>0 THEN RAISE EXCEPTION 'Pembayaran dengan potongan PPh tidak boleh diubah/dihapus lewat jalur biasa; perlukan pembalikan terverifikasi'; END IF;
    END IF;
    IF TG_OP IN ('INSERT','UPDATE') THEN
      IF NEW.withheld_amount>0 OR NEW.withholding_detail IS NOT NULL THEN RAISE EXCEPTION 'Potongan PPh hanya boleh dicatat melalui verifikasi atomik'; END IF;
    END IF;
  ELSE
    IF TG_OP='DELETE' AND OLD.withheld_amount>0 THEN RAISE EXCEPTION 'Invoice dengan potongan PPh tidak boleh dihapus'; END IF;
    IF TG_OP='INSERT' AND NEW.withheld_amount>0 THEN RAISE EXCEPTION 'Potongan PPh hanya boleh dicatat melalui verifikasi atomik'; END IF;
    IF TG_OP='UPDATE' THEN
      IF NEW.withheld_amount IS DISTINCT FROM OLD.withheld_amount OR (OLD.withheld_amount>0 AND
        (to_jsonb(NEW)-ARRAY['updated_at','pdf_url','pdf_generated_at','last_changed_by','sent','sent_at','wa_sent_count','wa_last_sent_at','wa_last_sent_by','wa_last_sent_mode','wa_last_sent_method','wa_last_sent_batch']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['updated_at','pdf_url','pdf_generated_at','last_changed_by','sent','sent_at','wa_sent_count','wa_last_sent_at','wa_last_sent_by','wa_last_sent_mode','wa_last_sent_method','wa_last_sent_batch'])) THEN
        RAISE EXCEPTION 'Invoice dengan potongan PPh dikunci untuk perubahan/revert biasa; perlukan pembalikan terverifikasi';
      END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.trigger_fix_invoice_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_items jsonb;
BEGIN
  -- Hanya proses jika materials_detail kosong/null
  IF NEW.materials_detail IS NOT NULL AND NEW.materials_detail != 'null' AND NEW.materials_detail != '[]' THEN
    -- Sudah ada data, fix garansi saja jika perlu
    IF NEW.garansi_expires IS NULL AND NEW.garansi_days IS NOT NULL THEN
      NEW.garansi_expires := (NEW.created_at + (NEW.garansi_days || ' days')::interval)::date;
    END IF;
    RETURN NEW;
  END IF;

  -- Cari materials_json dari laporan terkait (ambil yang paling baru)
  SELECT jsonb_agg(
    jsonb_build_object(
      'nama',         m->>'nama',
      'jumlah',       (m->>'jumlah')::numeric,
      'satuan',       COALESCE(m->>'satuan','pcs'),
      'harga_satuan', COALESCE((m->>'harga_satuan')::numeric, 0),
      'subtotal',     COALESCE((m->>'harga_satuan')::numeric, 0) * COALESCE((m->>'jumlah')::numeric, 1),
      'keterangan',   COALESCE(m->>'keterangan', '')
    ) ORDER BY CASE COALESCE(m->>'keterangan','')
      WHEN 'jasa'   THEN 1
      WHEN 'repair' THEN 2
      ELSE 3 END
  )
  INTO v_items
  FROM (
    SELECT materials_json FROM service_reports
    WHERE job_id = NEW.job_id
      AND materials_json IS NOT NULL
      AND materials_json != '[]'
    ORDER BY created_at DESC LIMIT 1
  ) r,
  jsonb_array_elements(r.materials_json::jsonb) m
  WHERE (m->>'nama') IS NOT NULL AND (m->>'nama') != '';

  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 0 THEN
    NEW.materials_detail := v_items::text;
  END IF;

  -- Fix garansi_expires
  IF NEW.garansi_expires IS NULL AND NEW.garansi_days IS NOT NULL THEN
    NEW.garansi_expires := (NEW.created_at + (NEW.garansi_days || ' days')::interval)::date;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER auto_fix_invoice_materials BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION trigger_fix_invoice_on_insert();
CREATE TRIGGER auto_fix_invoice_materials_update BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION trigger_fix_invoice_on_insert();
CREATE TRIGGER trg_guard_combined_transfer_229 BEFORE DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION guard_combined_transfer_229();
CREATE TRIGGER trg_guard_invoice_total_against_payments BEFORE UPDATE OF total ON public.invoices FOR EACH ROW WHEN ((new.total IS DISTINCT FROM old.total)) EXECUTE FUNCTION guard_invoice_total_against_payments();
CREATE TRIGGER trg_guard_reviewed_withholding_212 BEFORE INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION guard_reviewed_withholding_212();

