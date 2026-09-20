-- 179 — Workflow invoice grup, rekonsiliasi link, retensi log, dan query health.
--
-- Prinsip:
-- 1. Team split menghasilkan SATU invoice setelah seluruh laporan tim diverifikasi.
-- 2. Setiap laporan menyimpan billing part; agregasi dan pembuatan invoice satu transaksi.
-- 3. Rekonsiliasi order.invoice_id hanya mengisi link yang kosong/putus. Tidak menghapus data.
-- 4. Retensi hanya menyentuh log teknis, bounded per batch, dan mendukung dry-run.
-- 5. Query health bersifat observasional. Tidak membuat index otomatis.

BEGIN;

-- ── A. Billing parts untuk team split ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_invoice_parts (
  report_id text PRIMARY KEY REFERENCES public.service_reports(id) ON DELETE RESTRICT,
  order_id text NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  group_id text NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  invoice_payload jsonb NOT NULL,
  units integer NOT NULL DEFAULT 0 CHECK (units >= 0),
  labor numeric NOT NULL DEFAULT 0,
  material numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  trade_in_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, order_id)
);

ALTER TABLE public.team_invoice_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_invoice_parts_manager_read ON public.team_invoice_parts;
CREATE POLICY team_invoice_parts_manager_read ON public.team_invoice_parts
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('Owner','Admin','Finance'));

REVOKE INSERT, UPDATE, DELETE ON public.team_invoice_parts FROM anon, authenticated;
GRANT SELECT ON public.team_invoice_parts TO authenticated;
GRANT ALL ON public.team_invoice_parts TO service_role;

CREATE INDEX IF NOT EXISTS idx_team_invoice_parts_group
  ON public.team_invoice_parts(group_id, updated_at DESC);

-- Finalisasi laporan atomik v2. Jalur job biasa dipertahankan; team split memakai
-- billing part dan completeness gate sebelum satu invoice grup dibuat.
CREATE OR REPLACE FUNCTION public.finalize_service_report_atomic(
  p_report_id text,
  p_invoice jsonb DEFAULT NULL,
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
  report_row public.service_reports%ROWTYPE;
  ord public.orders%ROWTYPE;
  inv public.invoices%ROWTYPE;
  result_value jsonb;
  claimed integer;
  mkey text;
  invoice_status text;
  group_mode boolean := false;
  group_key text;
  team_count integer := 0;
  verified_count integer := 0;
  part_count integer := 0;
  group_units integer := 0;
  group_labor numeric := 0;
  group_material numeric := 0;
  group_discount numeric := 0;
  group_trade_in numeric := 0;
  group_total numeric := 0;
  group_lines jsonb := '[]'::jsonb;
  group_orders jsonb := '[]'::jsonb;
BEGIN
  role_name := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin dapat memfinalisasi laporan' USING ERRCODE = '42501';
  END IF;
  SELECT name INTO actor FROM public.user_profiles WHERE id = auth.uid();
  actor := coalesce(actor, nullif(trim(p_actor_name), ''), role_name);
  IF nullif(trim(p_report_id), '') IS NULL THEN RAISE EXCEPTION 'Report ID wajib diisi'; END IF;

  mkey := coalesce(nullif(trim(p_mutation_key), ''), 'report-finalize:' || p_report_id);
  INSERT INTO public.operational_mutations(mutation_key, operation, actor_id, actor_name)
  VALUES (mkey, 'FINALIZE_REPORT', auth.uid(), actor)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS claimed = ROW_COUNT;
  IF claimed = 0 THEN
    SELECT om.result INTO result_value FROM public.operational_mutations om WHERE om.mutation_key = mkey;
    RETURN coalesce(result_value, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO report_row FROM public.service_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Laporan tidak ditemukan'; END IF;
  IF report_row.status NOT IN ('SUBMITTED','REVISION','VERIFIED') THEN
    RAISE EXCEPTION 'Status laporan % tidak dapat diverifikasi', report_row.status;
  END IF;
  -- Baca identitas grup lebih dulu tanpa lock. Untuk team split, seluruh order
  -- dikunci kemudian dalam urutan ID yang konsisten agar dua finalisasi paralel
  -- tidak saling deadlock (masing-masing memegang child order berbeda).
  SELECT * INTO ord FROM public.orders WHERE id = report_row.job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order laporan tidak ditemukan'; END IF;

  group_mode := coalesce(ord.is_team_split, false) AND nullif(ord.job_group_id, '') IS NOT NULL;
  group_key := CASE WHEN group_mode THEN ord.job_group_id ELSE ord.id END;

  IF group_mode THEN
    -- Serialisasi seluruh finalisasi dalam satu grup agar dua Admin tidak dapat
    -- membuat invoice grup bersamaan.
    PERFORM o.id FROM public.orders o
      WHERE o.job_group_id = group_key AND coalesce(o.is_team_split, false)
      ORDER BY o.id FOR UPDATE;
    SELECT * INTO ord FROM public.orders WHERE id = report_row.job_id;

    SELECT * INTO inv FROM public.invoices
      WHERE job_id = group_key AND status <> 'CANCELLED'
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

    UPDATE public.service_reports
       SET status = 'VERIFIED', last_changed_by = actor, updated_at = now()
     WHERE id = report_row.id
     RETURNING * INTO report_row;

    -- Survey tidak mempunyai bagian invoice. Team split service biasa wajib
    -- membawa payload invoice per laporan agar agregat berasal dari laporan aktual.
    IF report_row.service <> 'Survey' AND inv.id IS NULL THEN
      IF p_invoice IS NULL OR jsonb_typeof(p_invoice) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Bagian invoice laporan tim wajib diisi sebelum finalisasi';
      END IF;
      INSERT INTO public.team_invoice_parts(
        report_id, order_id, group_id, invoice_payload, units, labor, material,
        discount, trade_in_amount, total, updated_at
      ) VALUES (
        report_row.id, ord.id, group_key, p_invoice,
        greatest(coalesce((p_invoice->>'units')::integer, 0), 0),
        coalesce((p_invoice->>'labor')::numeric, 0),
        coalesce((p_invoice->>'material')::numeric, 0),
        coalesce((p_invoice->>'discount')::numeric, 0),
        coalesce((p_invoice->>'trade_in_amount')::numeric, 0),
        coalesce((p_invoice->>'total')::numeric, 0), now()
      )
      ON CONFLICT (report_id) DO UPDATE SET
        order_id = excluded.order_id,
        group_id = excluded.group_id,
        invoice_payload = excluded.invoice_payload,
        units = excluded.units,
        labor = excluded.labor,
        material = excluded.material,
        discount = excluded.discount,
        trade_in_amount = excluded.trade_in_amount,
        total = excluded.total,
        updated_at = now();
    END IF;

    SELECT count(*) INTO team_count
      FROM public.orders o
     WHERE o.job_group_id = group_key AND coalesce(o.is_team_split, false);

    SELECT count(DISTINCT r.job_id) INTO verified_count
      FROM public.service_reports r
      JOIN public.orders o ON o.id = r.job_id
     WHERE o.job_group_id = group_key
       AND coalesce(o.is_team_split, false)
       AND r.status = 'VERIFIED';

    UPDATE public.orders
       SET status = CASE WHEN inv.id IS NOT NULL AND inv.status = 'PAID' THEN 'PAID' ELSE 'COMPLETED' END,
           invoice_id = coalesce(inv.id, invoice_id),
           last_changed_by = actor
     WHERE id = ord.id
     RETURNING * INTO ord;

    IF verified_count < team_count THEN
      result_value := jsonb_build_object(
        'report', to_jsonb(report_row),
        'order', to_jsonb(ord),
        'invoice', NULL,
        'group', jsonb_build_object(
          'id', group_key,
          'team_count', team_count,
          'verified_count', verified_count,
          'ready', false
        ),
        'replayed', false
      );
      UPDATE public.operational_mutations SET result = result_value, completed_at = now() WHERE mutation_key = mkey;
      RETURN result_value;
    END IF;

    IF report_row.service <> 'Survey' AND inv.id IS NULL THEN
      SELECT count(*), coalesce(sum(units), 0), coalesce(sum(labor), 0),
             coalesce(sum(material), 0), coalesce(sum(discount), 0),
             coalesce(sum(trade_in_amount), 0), coalesce(sum(total), 0)
        INTO part_count, group_units, group_labor, group_material,
             group_discount, group_trade_in, group_total
        FROM public.team_invoice_parts
       WHERE group_id = group_key;

      IF part_count <> team_count THEN
        RAISE EXCEPTION 'Billing part grup belum lengkap: % dari % tim', part_count, team_count;
      END IF;

      SELECT coalesce(jsonb_agg(x.line ORDER BY x.part_updated, x.line_no), '[]'::jsonb)
        INTO group_lines
        FROM (
          SELECT p.updated_at AS part_updated, line.ordinality AS line_no, line.value AS line
          FROM public.team_invoice_parts p
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(p.invoice_payload->'materials_detail') = 'array'
                THEN p.invoice_payload->'materials_detail'
              WHEN jsonb_typeof(p.invoice_payload->'materials_detail') = 'string'
                THEN coalesce(nullif(p.invoice_payload->>'materials_detail', '')::jsonb, '[]'::jsonb)
              ELSE '[]'::jsonb
            END
          ) WITH ORDINALITY AS line(value, ordinality)
          WHERE p.group_id = group_key
        ) x;

      IF nullif(p_invoice->>'id', '') IS NULL THEN RAISE EXCEPTION 'Invoice ID grup wajib diisi'; END IF;
      invoice_status := CASE WHEN group_total = 0 THEN 'PAID' ELSE 'PENDING_APPROVAL' END;

      INSERT INTO public.invoices(
        id, job_id, laporan_id, customer, phone, address, service, units, teknisi,
        labor, material, materials_detail, discount, trade_in, trade_in_amount,
        total, status, garansi_days, garansi_expires, due, maintenance_client_id,
        sent, created_at, paid_at, paid_amount, remaining_amount, last_changed_by
      ) VALUES (
        p_invoice->>'id', group_key, report_row.id,
        coalesce(p_invoice->>'customer', ord.customer),
        coalesce(p_invoice->>'phone', ord.phone),
        p_invoice->>'address', p_invoice->>'service', group_units,
        coalesce(p_invoice->>'teknisi', report_row.teknisi),
        group_labor, group_material, group_lines::text, group_discount,
        group_trade_in > 0, group_trade_in, group_total, invoice_status,
        coalesce((p_invoice->>'garansi_days')::integer, 30),
        nullif(p_invoice->>'garansi_expires', '')::date,
        nullif(p_invoice->>'due', '')::date,
        nullif(p_invoice->>'maintenance_client_id', '')::uuid,
        false, coalesce(nullif(p_invoice->>'created_at', '')::timestamptz, now()),
        CASE WHEN invoice_status = 'PAID' THEN current_date ELSE NULL END,
        CASE WHEN invoice_status = 'PAID' THEN group_total ELSE 0 END,
        CASE WHEN invoice_status = 'PAID' THEN 0 ELSE group_total END,
        actor
      ) RETURNING * INTO inv;
    END IF;

    UPDATE public.orders
       SET status = CASE WHEN inv.id IS NOT NULL AND inv.status = 'PAID' THEN 'PAID' ELSE 'COMPLETED' END,
           invoice_id = coalesce(inv.id, invoice_id),
           last_changed_by = actor
     WHERE job_group_id = group_key AND coalesce(is_team_split, false);

    SELECT * INTO ord FROM public.orders WHERE id = report_row.job_id;
    SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id), '[]'::jsonb)
      INTO group_orders
      FROM public.orders o
     WHERE o.job_group_id = group_key AND coalesce(o.is_team_split, false);
    result_value := jsonb_build_object(
      'report', to_jsonb(report_row),
      'order', to_jsonb(ord),
      'orders', group_orders,
      'invoice', CASE WHEN inv.id IS NULL THEN NULL ELSE to_jsonb(inv) END,
      'group', jsonb_build_object(
        'id', group_key,
        'team_count', team_count,
        'verified_count', verified_count,
        'ready', true
      ),
      'replayed', false
    );
    UPDATE public.operational_mutations SET result = result_value, completed_at = now() WHERE mutation_key = mkey;
    RETURN result_value;
  END IF;

  -- Jalur job biasa: perilaku migration 177 dipertahankan.
  SELECT * INTO ord FROM public.orders WHERE id = report_row.job_id FOR UPDATE;
  SELECT * INTO inv FROM public.invoices
    WHERE job_id = report_row.job_id AND status <> 'CANCELLED'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND AND report_row.service <> 'Survey' AND p_invoice IS NOT NULL THEN
    IF nullif(p_invoice->>'id', '') IS NULL THEN RAISE EXCEPTION 'Invoice ID wajib diisi'; END IF;
    invoice_status := coalesce(nullif(p_invoice->>'status', ''), 'PENDING_APPROVAL');
    INSERT INTO public.invoices(
      id,job_id,laporan_id,customer,phone,address,service,units,teknisi,labor,material,materials_detail,
      discount,trade_in,trade_in_amount,total,status,garansi_days,garansi_expires,due,
      maintenance_client_id,sent,created_at,paid_at,paid_amount,remaining_amount,last_changed_by
    ) VALUES (
      p_invoice->>'id',report_row.job_id,report_row.id,p_invoice->>'customer',p_invoice->>'phone',p_invoice->>'address',
      p_invoice->>'service',coalesce((p_invoice->>'units')::integer,1),p_invoice->>'teknisi',
      coalesce((p_invoice->>'labor')::numeric,0),coalesce((p_invoice->>'material')::numeric,0),p_invoice->>'materials_detail',
      coalesce((p_invoice->>'discount')::numeric,0),coalesce((p_invoice->>'trade_in')::boolean,false),
      coalesce((p_invoice->>'trade_in_amount')::numeric,0),coalesce((p_invoice->>'total')::numeric,0),invoice_status,
      coalesce((p_invoice->>'garansi_days')::integer,30),nullif(p_invoice->>'garansi_expires','')::date,
      nullif(p_invoice->>'due','')::date,nullif(p_invoice->>'maintenance_client_id','')::uuid,
      false,coalesce(nullif(p_invoice->>'created_at','')::timestamptz,now()),
      CASE WHEN invoice_status='PAID' THEN current_date ELSE NULL END,
      CASE WHEN invoice_status='PAID' THEN coalesce((p_invoice->>'total')::numeric,0) ELSE 0 END,
      CASE WHEN invoice_status='PAID' THEN 0 ELSE coalesce((p_invoice->>'total')::numeric,0) END,actor
    ) RETURNING * INTO inv;
  END IF;

  UPDATE public.service_reports SET status='VERIFIED',last_changed_by=actor,updated_at=now()
    WHERE id=report_row.id RETURNING * INTO report_row;
  UPDATE public.orders SET status=CASE WHEN inv.id IS NOT NULL AND inv.status='PAID' THEN 'PAID' ELSE 'COMPLETED' END,
    invoice_id=coalesce(inv.id,invoice_id),last_changed_by=actor
    WHERE id=ord.id RETURNING * INTO ord;
  result_value:=jsonb_build_object('report',to_jsonb(report_row),'order',to_jsonb(ord),
    'invoice',CASE WHEN inv.id IS NULL THEN NULL ELSE to_jsonb(inv) END,'group',NULL,'replayed',false);
  UPDATE public.operational_mutations SET result=result_value,completed_at=now() WHERE mutation_key=mkey;
  RETURN result_value;
END $$;

REVOKE ALL ON FUNCTION public.finalize_service_report_atomic(text,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finalize_service_report_atomic(text,jsonb,text,text) TO authenticated,service_role;

-- ── B. Rekonsiliasi order ↔ invoice tanpa penghapusan ─────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_order_invoice_links(
  p_apply boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  role_name text;
  candidate_count integer := 0;
  repaired_count integer := 0;
  samples jsonb := '[]'::jsonb;
BEGIN
  role_name := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Akses rekonsiliasi invoice ditolak' USING ERRCODE = '42501';
  END IF;

  WITH candidates AS (
    SELECT o.id AS order_id, o.invoice_id AS old_invoice_id, candidate.id AS new_invoice_id
    FROM public.orders o
    CROSS JOIN LATERAL (
      SELECT i.id
      FROM public.invoices i
      WHERE i.status <> 'CANCELLED'
        AND i.job_id = CASE
          WHEN coalesce(o.is_team_split,false) AND nullif(o.job_group_id,'') IS NOT NULL THEN o.job_group_id
          ELSE o.id
        END
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT 1
    ) candidate
    LEFT JOIN public.invoices linked ON linked.id = o.invoice_id
    WHERE o.invoice_id IS NULL OR linked.id IS NULL OR linked.status = 'CANCELLED'
  )
  SELECT count(*) INTO candidate_count FROM candidates;

  WITH candidates AS (
    SELECT o.id AS order_id, o.invoice_id AS old_invoice_id, candidate.id AS new_invoice_id
    FROM public.orders o
    CROSS JOIN LATERAL (
      SELECT i.id
      FROM public.invoices i
      WHERE i.status <> 'CANCELLED'
        AND i.job_id = CASE
          WHEN coalesce(o.is_team_split,false) AND nullif(o.job_group_id,'') IS NOT NULL THEN o.job_group_id
          ELSE o.id
        END
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT 1
    ) candidate
    LEFT JOIN public.invoices linked ON linked.id = o.invoice_id
    WHERE o.invoice_id IS NULL OR linked.id IS NULL OR linked.status = 'CANCELLED'
  )
  SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
    INTO samples
    FROM (SELECT * FROM candidates ORDER BY order_id LIMIT 50) s;

  IF p_apply THEN
    WITH candidates AS (
      SELECT o.id AS order_id, candidate.id AS new_invoice_id
      FROM public.orders o
      CROSS JOIN LATERAL (
        SELECT i.id
        FROM public.invoices i
        WHERE i.status <> 'CANCELLED'
          AND i.job_id = CASE
            WHEN coalesce(o.is_team_split,false) AND nullif(o.job_group_id,'') IS NOT NULL THEN o.job_group_id
            ELSE o.id
          END
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT 1
      ) candidate
      LEFT JOIN public.invoices linked ON linked.id = o.invoice_id
      WHERE o.invoice_id IS NULL OR linked.id IS NULL OR linked.status = 'CANCELLED'
    ), changed AS (
      UPDATE public.orders o
         SET invoice_id = c.new_invoice_id,
             last_changed_by = 'system::invoice-link-reconcile'
        FROM candidates c
       WHERE o.id = c.order_id
      RETURNING o.id
    )
    SELECT count(*) INTO repaired_count FROM changed;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', NOT p_apply,
    'candidate_count', candidate_count,
    'repaired_count', repaired_count,
    'samples', samples
  );
END $$;

REVOKE ALL ON FUNCTION public.reconcile_order_invoice_links(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_order_invoice_links(boolean) TO authenticated,service_role;

-- Satu kali repair saat migration diterapkan. Hanya isi link yang punya pasangan
-- invoice aktif jelas. Record yatim tanpa pasangan dibiarkan apa adanya.
WITH candidates AS (
  SELECT o.id AS order_id, candidate.id AS new_invoice_id
  FROM public.orders o
  CROSS JOIN LATERAL (
    SELECT i.id
    FROM public.invoices i
    WHERE i.status <> 'CANCELLED'
      AND i.job_id = CASE
        WHEN coalesce(o.is_team_split,false) AND nullif(o.job_group_id,'') IS NOT NULL THEN o.job_group_id
        ELSE o.id
      END
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT 1
  ) candidate
  LEFT JOIN public.invoices linked ON linked.id = o.invoice_id
  WHERE o.invoice_id IS NULL OR linked.id IS NULL OR linked.status = 'CANCELLED'
)
UPDATE public.orders o
   SET invoice_id = c.new_invoice_id,
       last_changed_by = 'migration-179::invoice-link-reconcile'
  FROM candidates c
 WHERE o.id = c.order_id;

-- ── C. Retensi log teknis terpusat dan bounded ────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_operational_logs(
  p_apply boolean DEFAULT false,
  p_batch_size integer DEFAULT 2000
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  role_name text;
  safe_batch integer := least(greatest(coalesce(p_batch_size,2000),100),5000);
  preview jsonb;
  deleted jsonb := '{}'::jsonb;
  n integer;
BEGIN
  role_name := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Akses retensi log ditolak' USING ERRCODE = '42501';
  END IF;
  IF p_apply AND role_name <> 'service_role' THEN
    RAISE EXCEPTION 'Eksekusi retensi hanya boleh dari service role/cron' USING ERRCODE = '42501';
  END IF;

  IF NOT p_apply THEN
    SELECT jsonb_build_object(
      'audit_log_90d', (SELECT count(*) FROM public.audit_log WHERE changed_at < now()-interval '90 days'),
      'agent_logs_90d', (SELECT count(*) FROM public.agent_logs WHERE created_at < now()-interval '90 days'),
      'cron_runs_90d', (SELECT count(*) FROM public.cron_runs WHERE started_at < now()-interval '90 days'),
      'ai_usage_180d', (SELECT count(*) FROM public.ai_usage WHERE created_at < now()-interval '180 days'),
      'wa_webhook_raw_14d', (SELECT count(*) FROM public.wa_webhook_raw WHERE created_at < now()-interval '14 days'),
      'wa_webhook_dedup_30d', (SELECT count(*) FROM public.wa_webhook_dedup WHERE created_at < now()-interval '30 days'),
      'operational_mutations_180d', (SELECT count(*) FROM public.operational_mutations WHERE created_at < now()-interval '180 days')
    ) INTO preview;
    RETURN jsonb_build_object('dry_run',true,'batch_size',safe_batch,'candidates',preview,'deleted',deleted);
  END IF;

  WITH doomed AS (SELECT ctid FROM public.audit_log WHERE changed_at < now()-interval '90 days' LIMIT safe_batch)
  DELETE FROM public.audit_log t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('audit_log',n);

  WITH doomed AS (SELECT ctid FROM public.agent_logs WHERE created_at < now()-interval '90 days' LIMIT safe_batch)
  DELETE FROM public.agent_logs t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('agent_logs',n);

  WITH doomed AS (SELECT ctid FROM public.cron_runs WHERE started_at < now()-interval '90 days' LIMIT safe_batch)
  DELETE FROM public.cron_runs t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('cron_runs',n);

  WITH doomed AS (SELECT ctid FROM public.ai_usage WHERE created_at < now()-interval '180 days' LIMIT safe_batch)
  DELETE FROM public.ai_usage t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('ai_usage',n);

  WITH doomed AS (SELECT ctid FROM public.wa_webhook_raw WHERE created_at < now()-interval '14 days' LIMIT safe_batch)
  DELETE FROM public.wa_webhook_raw t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('wa_webhook_raw',n);

  WITH doomed AS (SELECT ctid FROM public.wa_webhook_dedup WHERE created_at < now()-interval '30 days' LIMIT safe_batch)
  DELETE FROM public.wa_webhook_dedup t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('wa_webhook_dedup',n);

  WITH doomed AS (SELECT ctid FROM public.operational_mutations WHERE created_at < now()-interval '180 days' LIMIT safe_batch)
  DELETE FROM public.operational_mutations t USING doomed d WHERE t.ctid=d.ctid;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted||jsonb_build_object('operational_mutations',n);

  RETURN jsonb_build_object('dry_run',false,'batch_size',safe_batch,'deleted',deleted);
END $$;

REVOKE ALL ON FUNCTION public.cleanup_operational_logs(boolean,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cleanup_operational_logs(boolean,integer) TO authenticated,service_role;

-- ── D. Query health observasional ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_query_health_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  role_name text;
  result jsonb;
BEGIN
  role_name := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Akses query health ditolak' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'measured_at', now(),
    'database_bytes', pg_database_size(current_database()),
    'team_invoice_health', jsonb_build_object(
      'groups_without_invoice', (
        SELECT count(DISTINCT o.job_group_id)
        FROM public.orders o
        WHERE coalesce(o.is_team_split,false)
          AND nullif(o.job_group_id,'') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.invoices i
            WHERE i.job_id=o.job_group_id AND i.status<>'CANCELLED'
          )
      ),
      'legacy_verified_without_part', (
        SELECT count(*)
        FROM public.service_reports r
        JOIN public.orders o ON o.id=r.job_id
        WHERE coalesce(o.is_team_split,false)
          AND r.status='VERIFIED'
          AND r.service<>'Survey'
          AND NOT EXISTS (SELECT 1 FROM public.team_invoice_parts p WHERE p.report_id=r.id)
          AND NOT EXISTS (
            SELECT 1 FROM public.invoices i
            WHERE i.job_id=o.job_group_id AND i.status<>'CANCELLED'
          )
      )
    ),
    'tables', coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.total_bytes DESC), '[]'::jsonb),
    'recommendation', 'Observasi dahulu. Tambah index hanya setelah pola query lambat terbukti berulang.'
  ) INTO result
  FROM (
    SELECT s.relname AS table_name,
      s.n_live_tup::bigint AS live_rows,
      s.n_dead_tup::bigint AS dead_rows,
      s.seq_scan::bigint,
      s.idx_scan::bigint,
      pg_total_relation_size(s.relid)::bigint AS total_bytes,
      CASE
        WHEN s.n_live_tup > 1000 AND s.seq_scan > greatest(s.idx_scan,1) * 3 THEN 'WATCH_SEQ_SCAN'
        WHEN s.n_live_tup > 0 AND s.n_dead_tup > s.n_live_tup * 0.25 THEN 'WATCH_DEAD_ROWS'
        ELSE 'OK'
      END AS health
    FROM pg_stat_user_tables s
    WHERE s.schemaname='public'
      AND s.relname IN ('orders','service_reports','invoices','expenses','customers',
        'inventory_transactions','audit_log','agent_logs','wa_webhook_raw','wa_group_logs')
  ) q;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_query_health_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_query_health_snapshot() TO authenticated,service_role;

COMMIT;
