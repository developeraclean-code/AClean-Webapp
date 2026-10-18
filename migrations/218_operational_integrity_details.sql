-- Migration 218: Owner-only, paginated drill-down for integrity findings.
-- Aggregate counts alone forced manual searches and hid the affected company/job.
-- This RPC returns only explicit review fields and never repairs business rows.
-- A scoped ops-alert Owner setting, when selected, never changes other WA targets.
BEGIN;
-- Registry-based alert targets are safe only if lower roles cannot retarget an
-- Owner's identity/contact. Preserve broad non-Owner attendance updates.
CREATE OR REPLACE FUNCTION public.guard_ops_owner_contact_218()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.role='Owner' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.phone IS DISTINCT FROM OLD.phone OR NEW.active IS DISTINCT FROM OLD.active)
    AND auth.role() IS DISTINCT FROM 'service_role' AND coalesce(public.get_my_role(),'')<>'Owner' THEN
    RAISE EXCEPTION 'Owner only: alert recipient identity/contact' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_ops_owner_contact_218() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_ops_owner_contact_218 ON public.user_profiles;
CREATE TRIGGER trg_ops_owner_contact_218 BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_ops_owner_contact_218();
CREATE OR REPLACE FUNCTION public.guard_ops_alert_owner_218()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF (TG_OP<>'INSERT' AND OLD.key='ops_alert_owner_id') OR (TG_OP<>'DELETE' AND NEW.key='ops_alert_owner_id') THEN
    IF auth.role() IS DISTINCT FROM 'service_role' AND coalesce(public.get_my_role(),'')<>'Owner' THEN
      RAISE EXCEPTION 'Owner only: alert configuration' USING ERRCODE='42501';
    END IF;
    IF TG_OP<>'DELETE' AND NEW.key='ops_alert_owner_id' AND NOT EXISTS(
      SELECT 1 FROM public.user_profiles WHERE id::text=NEW.value AND role='Owner' AND active=true
    ) THEN RAISE EXCEPTION 'Select an active Owner' USING ERRCODE='22023'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_ops_alert_owner_218() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_ops_alert_owner_218 ON public.app_settings;
CREATE TRIGGER trg_ops_alert_owner_218 BEFORE INSERT OR UPDATE OR DELETE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.guard_ops_alert_owner_218();
CREATE OR REPLACE FUNCTION public.get_operational_integrity_details_218(p_check text,p_offset integer DEFAULT 0,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source text; result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND coalesce(public.get_my_role(),'')<>'Owner' THEN
    RAISE EXCEPTION 'Owner only' USING ERRCODE='42501';
  END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_offset>1000000 OR p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN
    RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023';
  END IF;
  CASE p_check
  WHEN 'invoice_maint_yatim' THEN source:=$q$
    SELECT i.id::text record_key,jsonb_build_object('id',i.id,'invoice_id',i.id,'order_id',o.id,'customer',i.customer,
      'client_id',o.maintenance_client_id,'client_name',c.name,'date',o.date,'description','Invoice belum membawa tautan klien dari order') item
    FROM public.invoices i JOIN public.orders o ON o.id=i.job_id LEFT JOIN public.maintenance_clients c ON c.id=o.maintenance_client_id
    WHERE o.maintenance_client_id IS NOT NULL AND i.maintenance_client_id IS NULL$q$;
  WHEN 'unit_code_dup' THEN source:=$q$
    SELECT coalesce(u.client_id::text,'(tanpa-klien)')||':'||u.unit_code record_key,jsonb_build_object('id',coalesce(u.client_id::text,'(tanpa-klien)')||':'||u.unit_code,
      'client_id',u.client_id,'client_name',c.name,'unit_code',u.unit_code,'count',count(*),'description','Kode yang sama dipakai beberapa aset; jangan hapus otomatis') item
    FROM public.maintenance_units u LEFT JOIN public.maintenance_clients c ON c.id=u.client_id
    WHERE nullif(btrim(u.unit_code),'') IS NOT NULL GROUP BY u.client_id,c.name,u.unit_code HAVING count(*)>1$q$;
  WHEN 'unit_ids_missing','unit_ids_other_client' THEN
    source:=$q$
      SELECT o.id||':'||j.ord record_key,jsonb_build_object('id',o.id||':'||j.ord,'order_id',o.id,'customer',o.customer,'date',o.date,
        'client_id',o.maintenance_client_id,'client_name',c.name,'unit_id',j.uid,'unit_code',u.unit_code,
        'related_client_name',actual.name,'related_client_id',actual.id,'description','Periksa unit yang dipilih pada order dan perusahaan pemilik aset') item
      FROM public.orders o CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.maintenance_unit_ids)='array' THEN o.maintenance_unit_ids ELSE '[]'::jsonb END) WITH ORDINALITY j(uid,ord)
      LEFT JOIN public.maintenance_units u ON u.id::text=j.uid LEFT JOIN public.maintenance_clients c ON c.id=o.maintenance_client_id
      LEFT JOIN public.maintenance_clients actual ON actual.id=u.client_id WHERE o.maintenance_client_id IS NOT NULL AND $q$;
    source:=source||CASE WHEN p_check='unit_ids_missing' THEN 'u.id IS NULL' ELSE 'u.id IS NOT NULL AND u.client_id IS DISTINCT FROM o.maintenance_client_id' END;
  WHEN 'unit_ids_invalid_json' THEN source:=$q$
    SELECT o.id::text record_key,jsonb_build_object('id',o.id,'order_id',o.id,'customer',o.customer,'date',o.date,
      'client_id',o.maintenance_client_id,'client_name',c.name,'description','Daftar unit order bukan array JSON') item
    FROM public.orders o LEFT JOIN public.maintenance_clients c ON c.id=o.maintenance_client_id
    WHERE o.maintenance_unit_ids IS NOT NULL AND jsonb_typeof(o.maintenance_unit_ids)<>'array'$q$;
  WHEN 'log_client_mismatch','log_unit_dangling' THEN
    source:=$q$
      SELECT l.id::text record_key,jsonb_build_object('id',l.id,'order_id',l.order_id,'unit_id',l.unit_id,'unit_code',u.unit_code,
        'client_id',l.client_id,'client_name',c.name,'related_client_name',actual.name,'related_client_id',actual.id,'date',l.service_date,
        'description','Periksa tautan laporan servis, aset dan perusahaan') item
      FROM public.maintenance_logs l LEFT JOIN public.maintenance_units u ON u.id=l.unit_id
      LEFT JOIN public.maintenance_clients c ON c.id=l.client_id LEFT JOIN public.maintenance_clients actual ON actual.id=u.client_id WHERE $q$;
    source:=source||CASE WHEN p_check='log_client_mismatch' THEN 'u.id IS NOT NULL AND l.client_id IS DISTINCT FROM u.client_id' ELSE 'l.unit_id IS NOT NULL AND u.id IS NULL' END;
  WHEN 'unit_client_dangling','unit_active_no_interval' THEN
    source:=$q$
      SELECT u.id::text record_key,jsonb_build_object('id',u.id,'unit_id',u.id,'unit_code',u.unit_code,'client_id',u.client_id,
        'client_name',c.name,'location',u.location,'description','Periksa profil aset; interval PM yang sengaja kosong tidak perlu diubah') item
      FROM public.maintenance_units u LEFT JOIN public.maintenance_clients c ON c.id=u.client_id WHERE $q$;
    source:=source||CASE WHEN p_check='unit_client_dangling' THEN 'u.client_id IS NOT NULL AND c.id IS NULL' ELSE 'u.status=''active'' AND coalesce(u.service_interval_months,0)<=0' END;
  WHEN 'followup_unit_dangling','followup_log_dangling' THEN
    source:=$q$
      SELECT f.id::text record_key,jsonb_build_object('id',f.id,'order_id',f.order_id,'unit_id',f.unit_id,'client_id',f.client_id,
        'client_name',c.name,'date',f.found_date,'description','Follow-up merujuk aset/laporan yang tidak tersedia') item
      FROM public.maintenance_followups f LEFT JOIN public.maintenance_units u ON u.id=f.unit_id
      LEFT JOIN public.maintenance_logs l ON l.id=f.log_id LEFT JOIN public.maintenance_clients c ON c.id=f.client_id WHERE $q$;
    source:=source||CASE WHEN p_check='followup_unit_dangling' THEN 'f.unit_id IS NOT NULL AND u.id IS NULL' ELSE 'f.log_id IS NOT NULL AND l.id IS NULL' END;
  WHEN 'invoice_payment_orphan' THEN source:=$q$
    SELECT p.id::text record_key,jsonb_build_object('id',p.id,'invoice_id',p.invoice_id,'description','Pembayaran merujuk invoice yang tidak tersedia; jangan buat pelunasan baru otomatis') item
    FROM public.invoice_payments p WHERE NOT EXISTS(SELECT 1 FROM public.invoices i WHERE i.id=p.invoice_id)$q$;
  WHEN 'inventory_unit_orphan','inventory_unit_negative' THEN
    source:=$q$
      SELECT u.id::text record_key,jsonb_build_object('id',u.id,'inventory_code',u.inventory_code,'unit_code',u.unit_label,'value',u.stock,
        'description','Periksa unit fisik dan master inventori, tanpa koreksi stok otomatis') item FROM public.inventory_units u WHERE $q$;
    source:=source||CASE WHEN p_check='inventory_unit_orphan' THEN 'NOT EXISTS(SELECT 1 FROM public.inventory i WHERE i.code=u.inventory_code)' ELSE 'u.stock<0' END;
  WHEN 'inventory_negative' THEN source:=$q$
    SELECT coalesce(i.code,i.id::text) record_key,jsonb_build_object('id',coalesce(i.code,i.id::text),'inventory_code',i.code,'customer',i.name,'value',i.stock,
      'description','Stok master negatif; telusuri transaksi sebelum koreksi') item FROM public.inventory i WHERE i.stock<0$q$;
  WHEN 'quotation_payment_overapplied' THEN source:=$q$
    SELECT p.id::text record_key,jsonb_build_object('id',p.id,'quotation_id',p.quotation_id,'value',p.applied_amount,'received',p.amount,
      'description','Alokasi DP di luar jumlah penerimaan; jangan mengubah ledger otomatis') item
    FROM public.quotation_payments p WHERE p.applied_amount>p.amount OR p.applied_amount<0$q$;
  ELSE RAISE EXCEPTION 'Unknown integrity check' USING ERRCODE='22023';
  END CASE;
  EXECUTE 'WITH records AS MATERIALIZED ('||source||'), page AS (SELECT record_key,item FROM records ORDER BY record_key LIMIT $1 OFFSET $2)
    SELECT jsonb_build_object(''check'',$3,''total'',(SELECT count(*) FROM records),''offset'',$2,''limit'',$1,
      ''rows'',coalesce((SELECT jsonb_agg(item ORDER BY record_key) FROM page),''[]''::jsonb))' INTO result USING p_limit,p_offset,p_check;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_operational_integrity_details_218(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_operational_integrity_details_218(text,integer,integer) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
