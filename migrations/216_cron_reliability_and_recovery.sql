-- Migration 216: durable dispatcher lease, consistent recovery export and read-only audit.
-- Scheduler activation is deliberately separate from DDL/deploy. No historical business
-- rows or feature toggles are changed. All new worker RPCs are service-role only.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cron_worker_leases (
  name text PRIMARY KEY, token uuid NOT NULL, expires_at timestamptz NOT NULL
);
ALTER TABLE public.cron_worker_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_worker_leases FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.cron_worker_leases TO service_role;

CREATE OR REPLACE FUNCTION public.claim_cron_worker_216(p_name text,p_token uuid,p_seconds integer DEFAULT 180)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE acquired boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker only' USING ERRCODE='42501'; END IF;
  IF p_name<>'dispatcher' OR p_token IS NULL OR p_seconds NOT BETWEEN 120 AND 300 THEN RAISE EXCEPTION 'Invalid lease'; END IF;
  INSERT INTO public.cron_worker_leases(name,token,expires_at)
    VALUES(p_name,p_token,clock_timestamp()+make_interval(secs=>p_seconds))
    ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at
    WHERE cron_worker_leases.expires_at<clock_timestamp()
    RETURNING true INTO acquired;
  RETURN coalesce(acquired,false);
END $$;
CREATE OR REPLACE FUNCTION public.release_cron_worker_216(p_name text,p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Worker only' USING ERRCODE='42501'; END IF;
  DELETE FROM public.cron_worker_leases WHERE name=p_name AND token=p_token;
END $$;

CREATE OR REPLACE FUNCTION public.backup_table_names_216()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT ARRAY[
 'customers','user_profiles','ac_units','project_projects','quotations','orders','service_reports',
 'invoices','invoice_items','invoice_payments','payments','payment_logs','quotation_payments','team_invoice_parts',
 'inventory','inventory_units','inventory_transactions','inventory_unit_stock_log','job_materials_brought',
 'expenses','weekly_payroll','order_bonuses','kasbon_requests',
 'maintenance_clients','maintenance_units','maintenance_logs','maintenance_followups','maintenance_contracts',
 'maintenance_client_prices','maintenance_work_orders','pre_service_manifests','pre_service_manifest_items',
 'project_daily_reports','project_expenses','project_dp','project_purchases','project_materials',
 'project_alokasi','project_usage','project_material_transactions','project_harian',
 'teknisi_material_checkout','material_checkout_items','material_job_movement',
 'daily_team_slots','team_presets','team_daily_helper','technician_availability','technician_schedule',
 'price_list','ac_price_list'
]::text[] $$;

-- STABLE: every table is read from the same statement snapshot, including DP/ledger/stock.
-- Never expose this SECURITY DEFINER export to browser roles, even Owner.
CREATE OR REPLACE FUNCTION public.export_operational_backup_216()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE names text[]:=public.backup_table_names_216(); t text; rows jsonb;
  tables jsonb:='{}'; schemas jsonb:='{}'; cols jsonb; keys jsonb; uniques jsonb; fks jsonb; bundle jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Backup worker only' USING ERRCODE='42501'; END IF;
  FOREACH t IN ARRAY names LOOP
    IF to_regclass(format('public.%I',t)) IS NULL THEN RAISE EXCEPTION 'Required backup table missing: %',t; END IF;
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM public.%I r',t) INTO rows;
    tables:=tables||jsonb_build_object(t,rows);
    SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod)) ORDER BY a.attnum)
      INTO cols FROM pg_attribute a WHERE a.attrelid=to_regclass(format('public.%I',t)) AND a.attnum>0 AND NOT a.attisdropped;
    SELECT coalesce(jsonb_agg(a.attname ORDER BY x.n),'[]'::jsonb) INTO keys
      FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY x(k,n)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=x.k
      WHERE c.conrelid=to_regclass(format('public.%I',t)) AND c.contype='p';
    SELECT coalesce(jsonb_agg(def.cols),'[]'::jsonb) INTO uniques FROM (
      SELECT (SELECT jsonb_agg(a.attname ORDER BY x.n) FROM unnest(ix.indkey) WITH ORDINALITY x(k,n)
        JOIN pg_attribute a ON a.attrelid=ix.indrelid AND a.attnum=x.k WHERE x.n<=ix.indnkeyatts) cols
      FROM pg_index ix WHERE ix.indrelid=to_regclass(format('public.%I',t)) AND ix.indisunique
        AND NOT ix.indisprimary AND ix.indpred IS NULL AND ix.indexprs IS NULL
    ) def;
    SELECT coalesce(jsonb_agg(jsonb_build_object('target',cl.relname,'target_schema',ns.nspname,
      'columns',(SELECT jsonb_agg(a.attname ORDER BY x.n) FROM unnest(c.conkey) WITH ORDINALITY x(k,n) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=x.k),
      'target_columns',(SELECT jsonb_agg(a.attname ORDER BY x.n) FROM unnest(c.confkey) WITH ORDINALITY x(k,n) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=x.k))),'[]'::jsonb)
      INTO fks FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.confrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace
      WHERE c.conrelid=to_regclass(format('public.%I',t)) AND c.contype='f';
    schemas:=schemas||jsonb_build_object(t,jsonb_build_object('columns',cols,'primary_key',keys,'unique_keys',uniques,'foreign_keys',fks));
  END LOOP;
  bundle:=jsonb_build_object('format',2,'exported_at',statement_timestamp(),'schema_version',216,'tables',tables,'schema',schemas);
  IF octet_length(bundle::text)>67108864 THEN RAISE EXCEPTION 'Backup exceeds 64 MiB; use database dump'; END IF;
  RETURN bundle;
END $$;

-- Invalid JSON/UUID references become findings instead of crashing the entire audit.
CREATE OR REPLACE FUNCTION public.audit_operational_integrity_216()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH refs AS (
   SELECT o.id,o.maintenance_client_id client_id,j.uid FROM public.orders o
   CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.maintenance_unit_ids)='array' THEN o.maintenance_unit_ids ELSE '[]'::jsonb END) j(uid)
   WHERE o.maintenance_client_id IS NOT NULL
 ), checks AS (
   SELECT 'invoice_maint_yatim' chk,'critical' severity,count(*)::integer n,min(i.id::text) sample
     FROM public.invoices i JOIN public.orders o ON o.id=i.job_id WHERE o.maintenance_client_id IS NOT NULL AND i.maintenance_client_id IS NULL
   UNION ALL SELECT 'log_client_mismatch','critical',count(*)::integer,min(l.id::text)
     FROM public.maintenance_logs l JOIN public.maintenance_units u ON u.id=l.unit_id WHERE l.client_id IS DISTINCT FROM u.client_id
   UNION ALL SELECT 'log_unit_dangling','critical',count(*)::integer,min(l.id::text)
     FROM public.maintenance_logs l WHERE l.unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.maintenance_units u WHERE u.id=l.unit_id)
   UNION ALL SELECT 'unit_client_dangling','critical',count(*)::integer,min(u.id::text)
     FROM public.maintenance_units u WHERE u.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.maintenance_clients c WHERE c.id=u.client_id)
   UNION ALL SELECT 'unit_code_dup','critical',count(*)::integer,min(d.unit_code)
     FROM (SELECT client_id,unit_code FROM public.maintenance_units WHERE nullif(btrim(unit_code),'') IS NOT NULL GROUP BY client_id,unit_code HAVING count(*)>1) d
   UNION ALL SELECT 'unit_ids_missing','critical',count(*)::integer,min(r.id::text)
     FROM refs r WHERE NOT EXISTS(SELECT 1 FROM public.maintenance_units u WHERE u.id::text=r.uid)
   UNION ALL SELECT 'unit_ids_other_client','critical',count(*)::integer,min(r.id::text)
     FROM refs r JOIN public.maintenance_units u ON u.id::text=r.uid WHERE u.client_id IS DISTINCT FROM r.client_id
   UNION ALL SELECT 'unit_ids_invalid_json','warn',count(*)::integer,min(o.id::text)
     FROM public.orders o WHERE o.maintenance_unit_ids IS NOT NULL AND jsonb_typeof(o.maintenance_unit_ids)<>'array'
   UNION ALL SELECT 'followup_unit_dangling','critical',count(*)::integer,min(f.id::text)
     FROM public.maintenance_followups f WHERE f.unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.maintenance_units u WHERE u.id=f.unit_id)
   UNION ALL SELECT 'followup_log_dangling','warn',count(*)::integer,min(f.id::text)
     FROM public.maintenance_followups f WHERE f.log_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.maintenance_logs l WHERE l.id=f.log_id)
   UNION ALL SELECT 'unit_active_no_interval','info',count(*)::integer,min(u.unit_code)
     FROM public.maintenance_units u WHERE u.status='active' AND coalesce(u.service_interval_months,0)<=0
   UNION ALL SELECT 'invoice_payment_orphan','critical',count(*)::integer,min(p.id::text)
     FROM public.invoice_payments p WHERE NOT EXISTS(SELECT 1 FROM public.invoices i WHERE i.id=p.invoice_id)
   UNION ALL SELECT 'inventory_unit_orphan','critical',count(*)::integer,min(u.id::text)
     FROM public.inventory_units u WHERE NOT EXISTS(SELECT 1 FROM public.inventory i WHERE i.code=u.inventory_code)
   UNION ALL SELECT 'inventory_negative','critical',count(*)::integer,min(i.code)
     FROM public.inventory i WHERE i.stock<0
   UNION ALL SELECT 'inventory_unit_negative','critical',count(*)::integer,min(u.id::text)
     FROM public.inventory_units u WHERE u.stock<0
   UNION ALL SELECT 'quotation_payment_overapplied','critical',count(*)::integer,min(p.id::text)
     FROM public.quotation_payments p WHERE p.applied_amount>p.amount OR p.applied_amount<0
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('check',chk,'severity',severity,'n',n,'sample',left(sample,120)) ORDER BY severity,chk),'[]'::jsonb)
 FROM checks WHERE n>0 AND auth.role()='service_role'
$$;

CREATE OR REPLACE FUNCTION public.dispatch_cron_tick_216()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE secret text; request_id bigint;
BEGIN
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='aclean_cron_dispatcher_secret' LIMIT 1;
  IF secret IS NULL OR length(secret)<32 THEN RAISE EXCEPTION 'Dispatcher credential not provisioned'; END IF;
  SELECT net.http_post(url:='https://a-clean-webapp.vercel.app/api/cron-reminder?task=tick',
    headers:=jsonb_build_object('Content-Type','application/json','X-Internal-Token',secret),body:='{}'::jsonb,timeout_milliseconds:=40000) INTO request_id;
  RETURN request_id;
END $$;

CREATE OR REPLACE FUNCTION public.get_operational_recovery_status_216()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE audit jsonb; backup jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND coalesce(public.get_my_role(),'')<>'Owner' THEN
    RAISE EXCEPTION 'Owner only' USING ERRCODE='42501';
  END IF;
  SELECT value::jsonb INTO audit FROM public.app_settings WHERE key='data_integrity_snapshot';
  SELECT jsonb_build_object('at',created_at,'type',type,'tables',cardinality(tables),
    'encrypted',row_counts->>'format'='2','verified',row_counts->>'format'='2') INTO backup
    FROM public.backup_log ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('audit',audit,'backup',backup);
END $$;
REVOKE ALL ON FUNCTION public.get_operational_recovery_status_216() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_operational_recovery_status_216() TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.claim_cron_worker_216(text,uuid,integer),public.release_cron_worker_216(text,uuid),
  public.backup_table_names_216(),public.export_operational_backup_216(),public.audit_operational_integrity_216(),public.dispatch_cron_tick_216() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cron_worker_216(text,uuid,integer),public.release_cron_worker_216(text,uuid),
  public.backup_table_names_216(),public.export_operational_backup_216(),public.audit_operational_integrity_216(),public.dispatch_cron_tick_216() TO service_role;
-- AFTER deployment and explicit production approval: provision Vault secret, then
-- cron.schedule('aclean-cron-dispatcher-10m','*/10 * * * *','SELECT public.dispatch_cron_tick_216();');
NOTIFY pgrst,'reload schema';
COMMIT;
