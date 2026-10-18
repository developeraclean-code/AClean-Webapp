-- Migration 217: build the consistent backup JSON once, not 51 growing copies.
-- Production snapshot is ~30 MB. Repeated jsonb concatenation in 216 copied that
-- payload repeatedly and timed out, although individual SELECTs finished quickly.
-- Use textual JSON aggregation and return JSON without a costly full JSONB rebuild.
-- API still returns the same object; one statement retains a consistent snapshot.
-- No business rows, feature toggles, schedules or credentials are changed.
BEGIN;
DROP FUNCTION IF EXISTS public.export_operational_backup_216();
CREATE FUNCTION public.export_operational_backup_216()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE names text[]:=public.backup_table_names_216(); t text; data_sql text;
  tables json; schemas jsonb:='{}'; cols jsonb; keys jsonb; uniques jsonb; fks jsonb; bundle json;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Backup worker only' USING ERRCODE='42501'; END IF;
  SELECT string_agg(format('SELECT %L::text AS table_name, coalesce(json_agg(row_to_json(r)),''[]''::json) AS table_rows FROM public.%I r',name,name),' UNION ALL ' ORDER BY ord)
    INTO data_sql FROM unnest(names) WITH ORDINALITY AS configured(name,ord);
  EXECUTE 'SELECT json_object_agg(table_name,table_rows) FROM ('||data_sql||') snapshot_rows' INTO tables;
  FOREACH t IN ARRAY names LOOP
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
  bundle:=json_build_object('format',2,'exported_at',statement_timestamp(),'schema_version',217,'tables',tables,'schema',schemas);
  IF octet_length(bundle::text)>67108864 THEN RAISE EXCEPTION 'Backup exceeds 64 MiB; use database dump'; END IF;
  RETURN bundle;
END $$;
CREATE OR REPLACE FUNCTION public.dispatch_cron_tick_216()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE secret text; request_id bigint;
BEGIN
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='aclean_cron_dispatcher_secret' LIMIT 1;
  IF secret IS NULL OR length(secret)<32 THEN RAISE EXCEPTION 'Dispatcher credential not provisioned'; END IF;
  SELECT net.http_post(url:='https://a-clean-webapp.vercel.app/api/cron-reminder?task=tick',
    headers:=jsonb_build_object('Content-Type','application/json','X-Internal-Token',secret),body:='{}'::jsonb,timeout_milliseconds:=55000) INTO request_id;
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.export_operational_backup_216(),public.dispatch_cron_tick_216() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.export_operational_backup_216(),public.dispatch_cron_tick_216() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
