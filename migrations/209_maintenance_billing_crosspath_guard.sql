-- One billing route per work item. Preserve the deployed finalizer implementation
-- (multi-team, material/report fields and prior fixes) behind a private wrapper.
-- No UPDATE/DELETE of historical invoices, payments, reports or links at migration time.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.finalize_service_report_atomic_base_209(text,jsonb,text,text)') IS NULL THEN
    IF to_regprocedure('public.finalize_service_report_atomic(text,jsonb,text,text)') IS NULL THEN
      RAISE EXCEPTION 'Finalizer laporan belum tersedia; terapkan workflow 179 terlebih dahulu';
    END IF;
    ALTER FUNCTION public.finalize_service_report_atomic(text,jsonb,text,text) RENAME TO finalize_service_report_atomic_base_209;
  END IF;
  IF to_regprocedure('public.create_maintenance_invoice_atomic_base_209(jsonb,uuid[],jsonb,text)') IS NULL THEN
    IF to_regprocedure('public.create_maintenance_invoice_atomic(jsonb,uuid[],jsonb,text)') IS NULL THEN
      RAISE EXCEPTION 'Terapkan migrasi 208 sebelum 209';
    END IF;
    ALTER FUNCTION public.create_maintenance_invoice_atomic(jsonb,uuid[],jsonb,text) RENAME TO create_maintenance_invoice_atomic_base_209;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.finalize_service_report_atomic_base_209(text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_maintenance_invoice_atomic_base_209(jsonb,uuid[],jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

-- During rollout an old server may still try INSERT + PATCH instead of the RPC.
-- Only log-backed B2B inserts are gated; regular jobs, contract invoices without
-- source log IDs and historical rows are untouched.
CREATE OR REPLACE FUNCTION public.guard_maintenance_b2b_insert_209()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE lines jsonb;
BEGIN
  IF NEW.maintenance_client_id IS NULL OR NEW.job_id IS NOT NULL OR NEW.materials_detail IS NULL THEN RETURN NEW; END IF;
  BEGIN lines:=NEW.materials_detail::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Item invoice maintenance tidak valid'; END;
  IF jsonb_typeof(lines)='array' AND EXISTS(SELECT 1 FROM jsonb_array_elements(lines) x WHERE nullif(x->>'log_id','') IS NOT NULL)
    AND current_setting('aclean.maintenance_b2b_atomic',true) IS DISTINCT FROM '209' THEN
    RAISE EXCEPTION 'Invoice B2B berbasis log wajib melalui transaksi atomik terbaru; muat ulang aplikasi';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_maintenance_b2b_insert_209() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_guard_maintenance_b2b_insert_209 ON public.invoices;
CREATE TRIGGER trg_guard_maintenance_b2b_insert_209 BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_maintenance_b2b_insert_209();

CREATE OR REPLACE FUNCTION public.create_maintenance_invoice_atomic(
  p_invoice jsonb,p_log_ids uuid[],p_snapshot jsonb,p_actor_name text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE previous_marker text; result_value jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Akses pembuatan invoice maintenance ditolak' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.maintenance_logs l WHERE l.id=ANY(p_log_ids) AND nullif(trim(l.order_id),'') IS NOT NULL) THEN
    RAISE EXCEPTION 'Log dari Order/Laporan ditagih melalui verifikasi laporan; gunakan invoice yang ada atau Mode Gabung Invoice, bukan Invoice B2B';
  END IF;
  previous_marker:=current_setting('aclean.maintenance_b2b_atomic',true);
  PERFORM set_config('aclean.maintenance_b2b_atomic','209',true);
  result_value:=public.create_maintenance_invoice_atomic_base_209(p_invoice,p_log_ids,p_snapshot,p_actor_name);
  PERFORM set_config('aclean.maintenance_b2b_atomic',coalesce(previous_marker,''),true);
  RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.create_maintenance_invoice_atomic(jsonb,uuid[],jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_maintenance_invoice_atomic(jsonb,uuid[],jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_service_report_atomic(
  p_report_id text,p_invoice jsonb DEFAULT NULL,p_actor_name text DEFAULT NULL,p_mutation_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  role_name text; actor text; r public.service_reports%ROWTYPE; o public.orders%ROWTYPE;
  inv public.invoices%ROWTYPE; initial_job text; initial_group text; is_group boolean;
  work_ids text[]; locked_work_ids text[]; lock_ids text[]; candidate_ids text[]; n_candidates integer;
  team_count integer; verified_count integer; group_value jsonb := NULL;
  order_values jsonb := '[]'::jsonb; result_value jsonb; mkey text; receipt public.operational_mutations%ROWTYPE;
BEGIN
  role_name := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name IS NULL OR role_name NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin dapat memfinalisasi laporan' USING ERRCODE='42501';
  END IF;
  IF nullif(trim(p_report_id),'') IS NULL THEN RAISE EXCEPTION 'Report ID wajib diisi'; END IF;
  SELECT * INTO r FROM public.service_reports WHERE id=p_report_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Laporan tidak ditemukan'; END IF;
  initial_job := r.job_id;
  SELECT * INTO o FROM public.orders WHERE id=initial_job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order laporan tidak ditemukan'; END IF;
  is_group := coalesce(o.is_team_split,false) AND nullif(o.job_group_id,'') IS NOT NULL;
  initial_group := CASE WHEN is_group THEN o.job_group_id ELSE o.id END;
  IF is_group THEN
    SELECT array_agg(id ORDER BY id) INTO work_ids FROM public.orders
      WHERE job_group_id=initial_group AND coalesce(is_team_split,false);
  ELSE work_ids := ARRAY[o.id]; END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO lock_ids FROM unnest(work_ids||ARRAY[initial_group]) x;
  -- Both wrappers take order locks before report/log locks; stale browsers cannot bypass this.
  PERFORM t.id FROM public.orders t WHERE t.id=ANY(lock_ids) ORDER BY t.id FOR UPDATE;
  IF is_group THEN
    SELECT array_agg(id ORDER BY id) INTO locked_work_ids FROM public.orders
      WHERE job_group_id=initial_group AND coalesce(is_team_split,false);
    IF locked_work_ids IS DISTINCT FROM work_ids THEN RAISE EXCEPTION 'Anggota grup berubah; muat ulang sebelum verifikasi'; END IF;
  END IF;
  SELECT * INTO r FROM public.service_reports WHERE id=p_report_id FOR UPDATE;
  SELECT * INTO o FROM public.orders WHERE id=initial_job;
  IF r.job_id IS DISTINCT FROM initial_job OR
    (CASE WHEN coalesce(o.is_team_split,false) AND nullif(o.job_group_id,'') IS NOT NULL THEN o.job_group_id ELSE o.id END) IS DISTINCT FROM initial_group THEN
    RAISE EXCEPTION 'Tautan laporan/grup berubah; muat ulang sebelum verifikasi';
  END IF;
  IF r.status NOT IN ('SUBMITTED','REVISION','VERIFIED') OR r.status IS NULL THEN
    RAISE EXCEPTION 'Status laporan tidak dapat diverifikasi';
  END IF;
  IF EXISTS(SELECT 1 FROM public.orders WHERE id=ANY(work_ids) AND upper(status) IN ('CANCELLED','RESCHEDULED')) THEN
    RAISE EXCEPTION 'Order dibatalkan atau dijadwal ulang; verifikasi ditahan';
  END IF;
  PERFORM l.id FROM public.maintenance_logs l WHERE l.order_id=ANY(work_ids) ORDER BY l.id FOR UPDATE;
  SELECT array_agg(DISTINCT i.id ORDER BY i.id) INTO candidate_ids FROM public.invoices i
    WHERE i.status IS DISTINCT FROM 'CANCELLED' AND (
      i.job_id=ANY(work_ids) OR (is_group AND i.job_id=initial_group)
      OR i.id IN (SELECT t.invoice_id FROM public.orders t WHERE t.id=ANY(lock_ids))
      OR i.id IN (SELECT l.invoice_id FROM public.maintenance_logs l WHERE l.order_id=ANY(work_ids))
    );
  n_candidates := coalesce(cardinality(candidate_ids),0);
  IF n_candidates>1 THEN
    RAISE EXCEPTION 'Ada beberapa invoice aktif untuk pekerjaan/grup ini; periksa tautan invoice dahulu. Tidak membuat invoice baru';
  END IF;
  IF n_candidates=0 THEN
    IF EXISTS(SELECT 1 FROM public.maintenance_logs l WHERE l.order_id=ANY(work_ids) AND
      (l.invoiced IS TRUE OR l.invoice_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'Log sudah ditagih tetapi tautan invoice tidak jelas/aktif; periksa Maintenance sebelum verifikasi';
    END IF;
    -- New work uses the original atomic workflow, including all team completeness rules.
    RETURN public.finalize_service_report_atomic_base_209(p_report_id,p_invoice,p_actor_name,p_mutation_key);
  END IF;

  SELECT * INTO inv FROM public.invoices WHERE id=candidate_ids[1] FOR UPDATE;
  IF inv.status IS NULL OR inv.status NOT IN ('PENDING_APPROVAL','APPROVED','UNPAID','OVERDUE','PARTIAL_PAID','PAID') THEN
    RAISE EXCEPTION 'Status invoice tertaut perlu diperiksa; verifikasi ditahan';
  END IF;
  IF EXISTS(SELECT 1 FROM public.orders t WHERE t.id=ANY(work_ids) AND
    t.maintenance_client_id IS NOT NULL AND inv.maintenance_client_id IS NOT NULL AND t.maintenance_client_id<>inv.maintenance_client_id) THEN
    RAISE EXCEPTION 'Invoice tertaut bukan milik perusahaan maintenance pekerjaan ini';
  END IF;
  IF is_group AND inv.job_id IS DISTINCT FROM initial_group AND EXISTS(
    SELECT 1 FROM public.orders t WHERE t.id=ANY(work_ids) AND t.invoice_id IS DISTINCT FROM inv.id
  ) THEN
    RAISE EXCEPTION 'Invoice hanya mencakup sebagian tim; periksa tautan grup sebelum verifikasi';
  END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id=auth.uid();
  actor := coalesce(actor,nullif(trim(p_actor_name),''),role_name);
  mkey := coalesce(nullif(trim(p_mutation_key),''),'report-finalize:'||p_report_id);
  SELECT * INTO receipt FROM public.operational_mutations WHERE mutation_key=mkey FOR UPDATE;
  IF FOUND AND (receipt.operation IS DISTINCT FROM 'FINALIZE_REPORT'
    OR (receipt.result->'report'->>'id' IS NOT NULL AND receipt.result->'report'->>'id'<>p_report_id)) THEN
    RAISE EXCEPTION 'ID permintaan telah digunakan proses lain';
  END IF;
  -- Reusing a linked invoice NEVER overwrites totals, items, cash, paid status or PDF.
  UPDATE public.service_reports SET status='VERIFIED',last_changed_by=actor,updated_at=now()
    WHERE id=r.id RETURNING * INTO r;
  IF is_group THEN
    team_count := cardinality(work_ids);
    SELECT count(DISTINCT job_id) INTO verified_count FROM public.service_reports
      WHERE job_id=ANY(work_ids) AND status='VERIFIED';
    group_value := jsonb_build_object('id',initial_group,'team_count',team_count,'verified_count',verified_count,'ready',verified_count=team_count);
  END IF;
  UPDATE public.orders SET status=CASE WHEN inv.status='PAID' THEN 'PAID' ELSE 'COMPLETED' END,
    invoice_id=inv.id,last_changed_by=actor
    WHERE id=o.id OR (is_group AND verified_count=team_count AND id=ANY(work_ids));
  SELECT * INTO o FROM public.orders WHERE id=initial_job;
  IF is_group THEN SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) INTO order_values
    FROM public.orders t WHERE t.id=ANY(work_ids); END IF;
  result_value := jsonb_build_object('report',to_jsonb(r),'order',to_jsonb(o),'orders',order_values,
    'invoice',to_jsonb(inv),'group',group_value,'invoice_reused',true,
    'replayed',receipt.completed_at IS NOT NULL);
  INSERT INTO public.operational_mutations(mutation_key,operation,actor_id,actor_name,result,completed_at)
    VALUES(mkey,'FINALIZE_REPORT',auth.uid(),actor,result_value,now())
    ON CONFLICT(mutation_key) DO UPDATE SET result=excluded.result,completed_at=excluded.completed_at;
  RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.finalize_service_report_atomic(text,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_service_report_atomic(text,jsonb,text,text) TO authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
