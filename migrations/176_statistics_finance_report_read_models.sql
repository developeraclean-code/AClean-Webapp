-- 176 — Read model ringan untuk Statistik, Finance, dan daftar Laporan Tim.
--
-- Tujuan:
-- 1. Browser tidak lagi mengunduh ribuan order/invoice/expense untuk membuat agregat.
-- 2. Daftar laporan tidak terkena hard-cap 1000 baris PostgREST.
-- 3. Semua fungsi memeriksa role aktif, membatasi page size, dan memakai search_path tetap.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_invoices_status_paid_at_stats
  ON public.invoices(status, paid_at);
CREATE INDEX IF NOT EXISTS idx_service_reports_date_status_page
  ON public.service_reports(date DESC, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_feedback_created_stats
  ON public.customer_feedback(created_at DESC);

CREATE OR REPLACE FUNCTION public.get_statistics_snapshot(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  caller_role text;
  result jsonb;
BEGIN
  SELECT role INTO caller_role
  FROM public.user_profiles
  WHERE id = auth.uid() AND active IS DISTINCT FROM false;

  IF caller_role NOT IN ('Owner','Admin','Finance') THEN
    RAISE EXCEPTION 'Akses Statistik ditolak' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'Rentang tanggal Statistik tidak valid';
  END IF;

  WITH invoice_basis AS (
    SELECT i.*,
           coalesce(o.date, i.created_at::date) AS basis_date,
           greatest(0::numeric,
             coalesce(i.total,0)::numeric -
             CASE WHEN i.invoice_type IN ('ac_unit_sale','quotation_converted')
                  THEN coalesce(i.unit_ac_amount,0)::numeric ELSE 0 END
           ) AS effective_revenue
    FROM public.invoices i
    LEFT JOIN public.orders o ON o.id = i.job_id
  ), period_invoices AS (
    SELECT * FROM invoice_basis
    WHERE (p_from IS NULL OR basis_date >= p_from)
      AND (p_to IS NULL OR basis_date <= p_to)
  ), paid_period AS (
    SELECT * FROM period_invoices WHERE status = 'PAID'
  ), period_orders AS (
    SELECT o.* FROM public.orders o
    WHERE (p_from IS NULL OR o.date >= p_from)
      AND (p_to IS NULL OR o.date <= p_to)
  ), unique_orders AS (
    SELECT * FROM period_orders
    WHERE NOT (parent_job_id IS NOT NULL AND coalesce(is_multi_day,false))
  ), valid_expenses AS (
    SELECT e.* FROM public.expenses e
    WHERE e.deleted_at IS NULL
      AND coalesce(e.approval_status,'') <> 'PENDING_APPROVAL'
      AND coalesce(e.validation_status,'') <> 'PENDING_AI'
      AND (p_from IS NULL OR e.date >= p_from)
      AND (p_to IS NULL OR e.date <= p_to)
  ), service_revenue AS (
    SELECT CASE
             WHEN lower(coalesce(service,'')) LIKE '%cleaning%' THEN 'Cleaning'
             WHEN lower(coalesce(service,'')) LIKE '%install%' THEN 'Install'
             WHEN lower(coalesce(service,'')) LIKE '%repair%' THEN 'Repair'
             WHEN lower(coalesce(service,'')) LIKE '%complain%' THEN 'Complain'
             ELSE 'Lainnya'
           END AS service,
           count(*)::int AS transactions,
           coalesce(sum(effective_revenue),0) AS revenue
    FROM paid_period
    GROUP BY 1
  ), team_jobs AS (
    SELECT teknisi AS name, false AS is_helper, id, status
    FROM period_orders WHERE nullif(trim(teknisi),'') IS NOT NULL
    UNION ALL
    SELECT helper AS name, true AS is_helper, id, status
    FROM period_orders WHERE nullif(trim(helper),'') IS NOT NULL
  ), technician_names AS (
    SELECT DISTINCT name FROM team_jobs WHERE is_helper = false
  ), team_summary AS (
    SELECT t.name,
           CASE WHEN bool_or(t.is_helper = false) THEN false ELSE true END AS is_helper,
           count(*)::int AS total,
           count(*) FILTER (WHERE t.status IN ('COMPLETED','REPORT_SUBMITTED','INVOICE_APPROVED','PAID','CONTINUED'))::int AS done,
           coalesce(sum(CASE WHEN t.is_helper = false THEN p.effective_revenue ELSE 0 END),0) AS revenue
    FROM team_jobs t
    LEFT JOIN paid_period p ON p.job_id = t.id
    WHERE t.is_helper = false OR NOT EXISTS (SELECT 1 FROM technician_names n WHERE n.name = t.name)
    GROUP BY t.name
  ), report_status AS (
    SELECT status, count(*)::int AS count
    FROM public.service_reports
    WHERE (p_from IS NULL OR coalesce(date, submitted_at::date) >= p_from)
      AND (p_to IS NULL OR coalesce(date, submitted_at::date) <= p_to)
    GROUP BY status
  ), invoice_status AS (
    SELECT status, count(*)::int AS count, coalesce(sum(total),0) AS total
    FROM invoice_basis GROUP BY status
  ), rating_by_tech AS (
    SELECT coalesce(teknisi,'Tidak Diketahui') AS teknisi,
           count(*)::int AS count,
           round(avg(rating)::numeric,2) AS average
    FROM public.customer_feedback GROUP BY coalesce(teknisi,'Tidak Diketahui')
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'range', jsonb_build_object('from',p_from,'to',p_to),
    'financial', jsonb_build_object(
      'revenue', coalesce((SELECT sum(effective_revenue) FROM paid_period),0),
      'labor', coalesce((SELECT sum(labor) FROM paid_period),0),
      'material', coalesce((SELECT sum(material) FROM paid_period),0),
      'discount', coalesce((SELECT sum(coalesce(discount,0) + CASE WHEN trade_in THEN coalesce(trade_in_amount,0) ELSE 0 END) FROM paid_period),0),
      'expenses', coalesce((SELECT sum(amount) FROM valid_expenses),0),
      'paid_count', (SELECT count(*) FROM paid_period),
      'billable_paid_count', (SELECT count(*) FROM paid_period WHERE total > 0),
      'ar', coalesce((SELECT sum(total) FROM invoice_basis WHERE status IN ('UNPAID','OVERDUE')),0),
      'overdue', coalesce((SELECT sum(total) FROM invoice_basis WHERE status='OVERDUE'),0),
      'pending', coalesce((SELECT sum(total) FROM invoice_basis WHERE status='PENDING_APPROVAL'),0)
    ),
    'operations', jsonb_build_object(
      'orders_total', (SELECT count(*) FROM unique_orders),
      'orders_done', (SELECT count(*) FROM unique_orders WHERE status IN ('COMPLETED','REPORT_SUBMITTED','INVOICE_APPROVED','PAID','CONTINUED')),
      'customers_total', (SELECT count(*) FROM public.customers),
      'customers_vip', (SELECT count(*) FROM public.customers WHERE is_vip),
      'customers_new', (SELECT count(*) FROM public.customers c
        WHERE (p_from IS NULL OR c.joined_date >= p_from)
          AND (p_to IS NULL OR c.joined_date <= p_to))
    ),
    'service_revenue', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.revenue DESC) FROM service_revenue x),'[]'::jsonb),
    'team', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.done DESC,x.name) FROM team_summary x),'[]'::jsonb),
    'report_status', coalesce((SELECT jsonb_object_agg(status,count) FROM report_status),'{}'::jsonb),
    'invoice_status', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.status) FROM invoice_status x),'[]'::jsonb),
    'overdue_rows', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.due NULLS LAST,x.id) FROM (
      SELECT id,customer,phone,total,due,job_id FROM invoice_basis WHERE status='OVERDUE' ORDER BY due NULLS LAST LIMIT 50
    ) x),'[]'::jsonb),
    'ratings', jsonb_build_object(
      'count', (SELECT count(*) FROM public.customer_feedback),
      'average', (SELECT round(avg(rating)::numeric,2) FROM public.customer_feedback),
      'positive', (SELECT count(*) FROM public.customer_feedback WHERE rating >= 4),
      'low', (SELECT count(*) FROM public.customer_feedback WHERE rating <= 2),
      'distribution', coalesce((SELECT jsonb_object_agg(rating,cnt) FROM (
        SELECT rating,count(*)::int cnt FROM public.customer_feedback GROUP BY rating
      ) d),'{}'::jsonb),
      'by_technician', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.average DESC) FROM rating_by_tech x),'[]'::jsonb),
      'recent', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
        SELECT id,order_id,phone,customer,teknisi,rating,comment,service,created_at
        FROM public.customer_feedback ORDER BY created_at DESC LIMIT 20
      ) x),'[]'::jsonb)
    )
  ) INTO result;

  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_statistics_snapshot(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_statistics_snapshot(date,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_finance_snapshot(
  p_day date DEFAULT current_date,
  p_month_start date DEFAULT date_trunc('month',current_date)::date,
  p_month_end date DEFAULT (date_trunc('month',current_date) + interval '1 month - 1 day')::date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  caller_role text;
  result jsonb;
BEGIN
  SELECT role INTO caller_role FROM public.user_profiles
  WHERE id=auth.uid() AND active IS DISTINCT FROM false;
  IF caller_role NOT IN ('Owner','Admin','Finance') THEN
    RAISE EXCEPTION 'Akses Finance ditolak' USING ERRCODE='42501';
  END IF;
  IF p_month_start > p_month_end THEN RAISE EXCEPTION 'Rentang bulan Finance tidak valid'; END IF;

  WITH valid_expenses AS (
    SELECT * FROM public.expenses
    WHERE deleted_at IS NULL
      AND coalesce(approval_status,'') <> 'PENDING_APPROVAL'
      AND coalesce(validation_status,'') <> 'PENDING_AI'
  ), cash_events AS (
    -- Ledger adalah sumber utama. Satu invoice boleh punya beberapa pembayaran
    -- pada hari/bulan berbeda dan masing-masing harus masuk ke periode sebenarnya.
    SELECT i.id,i.job_id,i.customer,i.service,i.status,i.total,
           ip.amount AS cash_amount,ip.amount AS paid_amount,
           ip.paid_at AS cash_date,ip.paid_at,i.created_at
    FROM public.invoice_payments ip
    JOIN public.invoices i ON i.id=ip.invoice_id
    UNION ALL
    -- Data legacy sebelum ledger hanya dihitung jika invoice sama sekali belum
    -- memiliki invoice_payments. Ini mencegah double-count saat transisi.
    SELECT i.id,i.job_id,i.customer,i.service,i.status,i.total,
           CASE WHEN i.status='PAID' THEN coalesce(i.total,0) ELSE coalesce(i.paid_amount,0) END AS cash_amount,
           CASE WHEN i.status='PAID' THEN coalesce(i.total,0) ELSE coalesce(i.paid_amount,0) END AS paid_amount,
           i.paid_at::date AS cash_date,i.paid_at,i.created_at
    FROM public.invoices i
    WHERE i.status IN ('PAID','PARTIAL_PAID') AND i.paid_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id=i.id)
  ), month_invoices AS (
    SELECT id,job_id,customer,service,max(status) status,max(total) total,
           sum(cash_amount) AS cash_amount,sum(cash_amount) AS paid_amount,
           cash_date AS paid_at,max(created_at) created_at
    FROM cash_events WHERE cash_date BETWEEN p_month_start AND p_month_end
    GROUP BY id,job_id,customer,service,cash_date
  ), month_expenses AS (
    SELECT id,date,category,subcategory,description,item_name,amount
    FROM valid_expenses WHERE date BETWEEN p_month_start AND p_month_end
  ), day_cash AS (
    SELECT id,job_id,customer,service,max(status) status,max(total) total,
           sum(cash_amount) AS cash_amount,sum(cash_amount) AS paid_amount,
           cash_date AS paid_at
    FROM cash_events WHERE cash_date=p_day
    GROUP BY id,job_id,customer,service,cash_date
  )
  SELECT jsonb_build_object(
    'generated_at',now(),'day',p_day,'month_start',p_month_start,'month_end',p_month_end,
    'summary',jsonb_build_object(
      'cash_all_time',coalesce((SELECT sum(cash_amount) FROM cash_events),0),
      'expenses_all_time',coalesce((SELECT sum(amount) FROM valid_expenses),0),
      'paid_count',(SELECT count(*) FROM public.invoices WHERE status='PAID'),
      'unpaid_count',(SELECT count(*) FROM public.invoices WHERE status IN ('UNPAID','OVERDUE')),
      'overdue_count',(SELECT count(*) FROM public.invoices WHERE status='OVERDUE'),
      'month_cash',coalesce((SELECT sum(cash_amount) FROM month_invoices),0),
      'month_expenses',coalesce((SELECT sum(amount) FROM month_expenses),0),
      'day_cash',coalesce((SELECT sum(cash_amount) FROM day_cash),0),
      'day_paid_count',(SELECT count(*) FROM day_cash)
    ),
    'month_invoices',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY coalesce(x.paid_at::date,x.created_at::date) DESC) FROM month_invoices x),'[]'::jsonb),
    'month_expenses',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.date DESC,x.id) FROM month_expenses x),'[]'::jsonb),
    'day_cash_rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM day_cash x),'[]'::jsonb),
    'top_expenses',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.total DESC) FROM (
      SELECT coalesce(subcategory,category,'Lain-lain') name,sum(amount) total
      FROM month_expenses GROUP BY coalesce(subcategory,category,'Lain-lain')
      ORDER BY sum(amount) DESC LIMIT 10
    ) x),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_finance_snapshot(date,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_snapshot(date,date,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_service_reports_page(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_service text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_team text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  caller_role text;
  caller_name text;
  safe_page integer := greatest(coalesce(p_page,1),1);
  safe_size integer := least(greatest(coalesce(p_page_size,20),1),100);
  result jsonb;
BEGIN
  SELECT role,name INTO caller_role,caller_name FROM public.user_profiles
  WHERE id=auth.uid() AND active IS DISTINCT FROM false;
  IF caller_role IS NULL THEN RAISE EXCEPTION 'Profil aktif tidak ditemukan' USING ERRCODE='42501'; END IF;

  WITH base_filtered AS (
    SELECT r.* FROM public.service_reports r
    WHERE (caller_role IN ('Owner','Admin','Finance') OR caller_name IN (r.teknisi,r.helper))
      AND (p_date_from IS NULL OR coalesce(r.date,r.submitted_at::date)>=p_date_from)
      AND (p_date_to IS NULL OR coalesce(r.date,r.submitted_at::date)<=p_date_to)
      AND (nullif(p_service,'') IS NULL OR p_service='Semua' OR r.service=p_service)
      AND (nullif(p_team,'') IS NULL OR p_team='Semua Tim' OR p_team IN (r.teknisi,r.helper))
      AND (nullif(trim(p_search),'') IS NULL OR
        r.customer ILIKE '%'||trim(p_search)||'%' OR r.id ILIKE '%'||trim(p_search)||'%' OR
        r.job_id ILIKE '%'||trim(p_search)||'%' OR r.teknisi ILIKE '%'||trim(p_search)||'%' OR
        coalesce(r.helper,'') ILIKE '%'||trim(p_search)||'%')
  ), filtered AS (
    SELECT * FROM base_filtered r
    WHERE nullif(p_status,'') IS NULL OR p_status='Semua'
       OR (p_status='BELUM_VERIFIED' AND r.status IN ('SUBMITTED','REVISION'))
       OR r.status=p_status
  ), page_rows AS (
    SELECT id,job_id,teknisi,helper,customer,service,type,date,total_units,total_freon,
           units,materials_used,foto_urls,rekomendasi,catatan_global,edit_log,status,
           submitted_at,updated_at,submitted,unit_mismatch,created_at,is_substitute,is_install,
           bap_number,bap_statement,bap_recommendation,ttd_customer_url,ttd_customer_name,
           bap_skipped_reason,bap_signed_at,hasil_survey,catatan_rekomendasi,survey_sent_at,
           report_card_sent_at,report_card_sent_by,report_card_sent_count,
           report_card_last_sent_mode,report_card_last_sent_method
    FROM filtered ORDER BY submitted_at DESC,status,id
    OFFSET (safe_page-1)*safe_size LIMIT safe_size
  ), counts AS (
    SELECT status,count(*)::int count FROM base_filtered GROUP BY status
  )
  SELECT jsonb_build_object(
    'page',safe_page,'page_size',safe_size,'total_count',(SELECT count(*) FROM filtered),
    'status_counts',coalesce((SELECT jsonb_object_agg(status,count) FROM counts),'{}'::jsonb),
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.submitted_at DESC,x.status,x.id) FROM page_rows x),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_service_reports_page(date,date,text,text,text,text,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_service_reports_page(date,date,text,text,text,text,integer,integer) TO authenticated, service_role;

COMMIT;
