-- 178 — Dashboard operasional per tanggal. Mengirim satu hari data ringkas, bukan
-- seluruh tabel order/invoice/laporan. Aman untuk free tier dan navigasi tanggal.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_orders_date_time_dashboard
  ON public.orders(date, time, id);
CREATE INDEX IF NOT EXISTS idx_invoices_job_active_dashboard
  ON public.invoices(job_id, created_at DESC) WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_service_reports_job_dashboard
  ON public.service_reports(job_id, submitted_at DESC);

CREATE OR REPLACE FUNCTION public.get_dashboard_snapshot_v2(
  p_date date DEFAULT current_date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  role_name text;
  payload jsonb;
BEGIN
  role_name := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF role_name NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Dashboard operasional hanya untuk Owner/Admin' USING ERRCODE='42501';
  END IF;

  WITH day_orders AS (
    SELECT o.*
    FROM public.orders o
    WHERE o.date = coalesce(p_date, current_date)
  ), joined AS (
    SELECT
      jsonb_build_object(
        'id',o.id,'date',o.date,'time',o.time,'time_end',o.time_end,
        'customer',o.customer,'phone',o.phone,'address',o.address,'area',o.area,
        'service',o.service,'type',o.type,'units',o.units,'status',o.status,
        'teknisi',o.teknisi,'helper',o.helper,'invoice_id',o.invoice_id
      ) AS order_data,
      CASE WHEN i.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id',i.id,'job_id',i.job_id,'total',i.total,'status',i.status,
        'repair_gratis',i.repair_gratis,'sent',i.sent,'sent_at',i.sent_at
      ) END AS invoice_data,
      CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id',r.id,'job_id',r.job_id,'status',r.status,
        'report_card_sent_at',r.report_card_sent_at,
        'report_card_sent_count',coalesce(r.report_card_sent_count,0)
      ) END AS report_data
    FROM day_orders o
    LEFT JOIN LATERAL (
      SELECT x.* FROM public.invoices x
      WHERE x.job_id=o.id AND x.status<>'CANCELLED'
      ORDER BY x.created_at DESC LIMIT 1
    ) i ON true
    LEFT JOIN LATERAL (
      SELECT x.* FROM public.service_reports x
      WHERE x.job_id=o.id ORDER BY x.submitted_at DESC LIMIT 1
    ) r ON true
  ), summary AS (
    SELECT
      count(*)::integer AS total_orders,
      count(*) FILTER (WHERE report_data IS NOT NULL)::integer AS reports_received,
      count(*) FILTER (WHERE invoice_data IS NULL)::integer AS invoices_missing,
      count(*) FILTER (WHERE report_data->>'report_card_sent_at' IS NOT NULL)::integer AS report_cards_sent,
      coalesce(sum(coalesce((invoice_data->>'total')::numeric,0)),0) AS invoice_total,
      count(*) FILTER (WHERE order_data->>'status' IN ('COMPLETED','REPORT_SUBMITTED','INVOICE_APPROVED','PAID'))::integer AS completed,
      count(*) FILTER (WHERE order_data->>'status'='IN_PROGRESS')::integer AS active,
      count(*) FILTER (WHERE order_data->>'status'='PENDING')::integer AS pending
    FROM joined
  )
  SELECT jsonb_build_object(
    'date',coalesce(p_date,current_date),
    'previous_date',(SELECT max(date) FROM public.orders WHERE date < coalesce(p_date,current_date)),
    'next_date',(SELECT min(date) FROM public.orders WHERE date > coalesce(p_date,current_date)),
    'summary',to_jsonb(summary),
    'rows',coalesce((SELECT jsonb_agg(
      jsonb_build_object('order',order_data,'invoice',invoice_data,'report',report_data)
      ORDER BY lower(order_data->>'teknisi'), order_data->>'time'
    ) FROM joined),'[]'::jsonb)
  ) INTO payload
  FROM summary;

  RETURN payload;
END $$;

REVOKE ALL ON FUNCTION public.get_dashboard_snapshot_v2(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_snapshot_v2(date) TO authenticated, service_role;

COMMIT;
