-- 191 — Statistik memakai satu rumus net profit yang lengkap dan konsisten.
--
-- Sebelumnya kartu UI menghitung jasa - expenses, sedangkan CSV/PDF menghitung
-- revenue - expenses. Keduanya juga belum memasukkan weekly_payroll dan bonus
-- yang sudah dibayar. Migrasi ini menjadikan RPC sebagai satu sumber kebenaran:
--
--   net profit = revenue efektif - expenses final - payroll mingguan - bonus dibayar
--
-- `gross_salary` sudah merupakan take-home pay (termasuk bonus manual dan potongan
-- kasbon), sehingga tidak boleh ditambah/dikurangi lagi. Expenses tetap mencakup
-- material_purchase agar pembelian material yang benar-benar dicatat tidak hilang.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_weekly_payroll_period_end_stats
  ON public.weekly_payroll(period_end);
CREATE INDEX IF NOT EXISTS idx_order_bonuses_paid_at_stats
  ON public.order_bonuses(paid_at)
  WHERE status='PAID' AND paid_at IS NOT NULL;

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
  caller_role := CASE
    WHEN auth.role()='service_role' THEN 'service_role'
    ELSE public.get_my_role()
  END;

  IF caller_role NOT IN ('Owner','Admin','Finance','service_role') THEN
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
    LEFT JOIN public.orders o ON o.id=i.job_id
  ), period_invoices AS (
    SELECT * FROM invoice_basis
    WHERE (p_from IS NULL OR basis_date>=p_from)
      AND (p_to IS NULL OR basis_date<=p_to)
  ), paid_period AS (
    SELECT * FROM period_invoices WHERE status='PAID'
  ), period_orders AS (
    SELECT o.* FROM public.orders o
    WHERE (p_from IS NULL OR o.date>=p_from)
      AND (p_to IS NULL OR o.date<=p_to)
  ), unique_orders AS (
    SELECT * FROM period_orders
    WHERE NOT (parent_job_id IS NOT NULL AND coalesce(is_multi_day,false))
  ), valid_expenses AS (
    SELECT e.* FROM public.expenses e
    WHERE e.deleted_at IS NULL
      AND coalesce(e.approval_status,'')<>'PENDING_APPROVAL'
      AND coalesce(e.validation_status,'')<>'PENDING_AI'
      AND (p_from IS NULL OR e.date>=p_from)
      AND (p_to IS NULL OR e.date<=p_to)
  ), expense_totals AS (
    SELECT
      coalesce(sum(amount),0)::numeric AS expenses,
      coalesce(sum(amount) FILTER (WHERE lower(coalesce(category,''))='material_purchase'),0)::numeric AS material_purchases,
      coalesce(sum(amount) FILTER (WHERE lower(coalesce(category,''))<>'material_purchase'),0)::numeric AS operating_expenses
    FROM valid_expenses
  ), payroll_totals AS (
    -- period_end menempatkan biaya gaji pada minggu saat pekerjaan dilakukan,
    -- bukan pada saat tombol bayar ditekan. gross_salary sudah nilai take-home final.
    SELECT coalesce(sum(gross_salary),0)::numeric AS payroll,
           count(*)::int AS payroll_count
    FROM public.weekly_payroll
    WHERE (p_from IS NULL OR period_end>=p_from)
      AND (p_to IS NULL OR period_end<=p_to)
  ), bonus_totals AS (
    SELECT coalesce(sum(total_amount),0)::numeric AS bonuses,
           count(*)::int AS bonus_count
    FROM public.order_bonuses
    WHERE status='PAID' AND paid_at IS NOT NULL
      AND (p_from IS NULL OR paid_at::date>=p_from)
      AND (p_to IS NULL OR paid_at::date<=p_to)
  ), financial_totals AS (
    SELECT
      coalesce((SELECT sum(effective_revenue) FROM paid_period),0)::numeric AS revenue,
      e.expenses,e.material_purchases,e.operating_expenses,
      p.payroll,p.payroll_count,b.bonuses,b.bonus_count,
      (e.expenses+p.payroll+b.bonuses)::numeric AS total_costs
    FROM expense_totals e CROSS JOIN payroll_totals p CROSS JOIN bonus_totals b
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
    FROM paid_period GROUP BY 1
  ), team_jobs AS (
    SELECT teknisi AS name,false AS is_helper,id,status
    FROM period_orders WHERE nullif(trim(teknisi),'') IS NOT NULL
    UNION ALL
    SELECT helper AS name,true AS is_helper,id,status
    FROM period_orders WHERE nullif(trim(helper),'') IS NOT NULL
  ), technician_names AS (
    SELECT DISTINCT name FROM team_jobs WHERE is_helper=false
  ), team_summary AS (
    SELECT t.name,
           CASE WHEN bool_or(t.is_helper=false) THEN false ELSE true END AS is_helper,
           count(*)::int AS total,
           count(*) FILTER (WHERE t.status IN ('COMPLETED','REPORT_SUBMITTED','INVOICE_APPROVED','PAID','CONTINUED'))::int AS done,
           coalesce(sum(CASE WHEN t.is_helper=false THEN p.effective_revenue ELSE 0 END),0) AS revenue
    FROM team_jobs t
    LEFT JOIN paid_period p ON p.job_id=t.id
    WHERE t.is_helper=false OR NOT EXISTS (SELECT 1 FROM technician_names n WHERE n.name=t.name)
    GROUP BY t.name
  ), report_status AS (
    SELECT status,count(*)::int AS count
    FROM public.service_reports
    WHERE (p_from IS NULL OR coalesce(date,submitted_at::date)>=p_from)
      AND (p_to IS NULL OR coalesce(date,submitted_at::date)<=p_to)
    GROUP BY status
  ), invoice_status AS (
    SELECT status,count(*)::int AS count,coalesce(sum(total),0) AS total
    FROM invoice_basis GROUP BY status
  ), rating_by_tech AS (
    SELECT coalesce(teknisi,'Tidak Diketahui') AS teknisi,
           count(*)::int AS count,round(avg(rating)::numeric,2) AS average
    FROM public.customer_feedback GROUP BY coalesce(teknisi,'Tidak Diketahui')
  )
  SELECT jsonb_build_object(
    'generated_at',now(),
    'range',jsonb_build_object('from',p_from,'to',p_to),
    'financial',jsonb_build_object(
      'calculation_version',2,
      'revenue',(SELECT revenue FROM financial_totals),
      'labor',coalesce((SELECT sum(labor) FROM paid_period),0),
      'material',coalesce((SELECT sum(material) FROM paid_period),0),
      'discount',coalesce((SELECT sum(coalesce(discount,0)+CASE WHEN trade_in THEN coalesce(trade_in_amount,0) ELSE 0 END) FROM paid_period),0),
      'expenses',(SELECT expenses FROM financial_totals),
      'material_purchases',(SELECT material_purchases FROM financial_totals),
      'operating_expenses',(SELECT operating_expenses FROM financial_totals),
      'payroll',(SELECT payroll FROM financial_totals),
      'payroll_count',(SELECT payroll_count FROM financial_totals),
      'bonuses',(SELECT bonuses FROM financial_totals),
      'bonus_count',(SELECT bonus_count FROM financial_totals),
      'total_costs',(SELECT total_costs FROM financial_totals),
      'net_profit',(SELECT revenue-total_costs FROM financial_totals),
      'margin_pct',coalesce((SELECT round(((revenue-total_costs)/nullif(revenue,0))*100,2) FROM financial_totals),0),
      'paid_count',(SELECT count(*) FROM paid_period),
      'billable_paid_count',(SELECT count(*) FROM paid_period WHERE total>0),
      'ar',coalesce((SELECT sum(total) FROM invoice_basis WHERE status IN ('UNPAID','OVERDUE')),0),
      'overdue',coalesce((SELECT sum(total) FROM invoice_basis WHERE status='OVERDUE'),0),
      'pending',coalesce((SELECT sum(total) FROM invoice_basis WHERE status='PENDING_APPROVAL'),0)
    ),
    'operations',jsonb_build_object(
      'orders_total',(SELECT count(*) FROM unique_orders),
      'orders_done',(SELECT count(*) FROM unique_orders WHERE status IN ('COMPLETED','REPORT_SUBMITTED','INVOICE_APPROVED','PAID','CONTINUED')),
      'customers_total',(SELECT count(*) FROM public.customers),
      'customers_vip',(SELECT count(*) FROM public.customers WHERE is_vip),
      'customers_new',(SELECT count(*) FROM public.customers c
        WHERE (p_from IS NULL OR c.joined_date>=p_from)
          AND (p_to IS NULL OR c.joined_date<=p_to))
    ),
    'service_revenue',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.revenue DESC) FROM service_revenue x),'[]'::jsonb),
    'team',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.done DESC,x.name) FROM team_summary x),'[]'::jsonb),
    'report_status',coalesce((SELECT jsonb_object_agg(status,count) FROM report_status),'{}'::jsonb),
    'invoice_status',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.status) FROM invoice_status x),'[]'::jsonb),
    'overdue_rows',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.due NULLS LAST,x.id) FROM (
      SELECT id,customer,phone,total,due,job_id FROM invoice_basis
      WHERE status='OVERDUE' ORDER BY due NULLS LAST LIMIT 50
    ) x),'[]'::jsonb),
    'ratings',jsonb_build_object(
      'count',(SELECT count(*) FROM public.customer_feedback),
      'average',(SELECT round(avg(rating)::numeric,2) FROM public.customer_feedback),
      'positive',(SELECT count(*) FROM public.customer_feedback WHERE rating>=4),
      'low',(SELECT count(*) FROM public.customer_feedback WHERE rating<=2),
      'distribution',coalesce((SELECT jsonb_object_agg(rating,cnt) FROM (
        SELECT rating,count(*)::int cnt FROM public.customer_feedback GROUP BY rating
      ) d),'{}'::jsonb),
      'by_technician',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.average DESC) FROM rating_by_tech x),'[]'::jsonb),
      'recent',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
        SELECT id,order_id,phone,customer,teknisi,rating,comment,service,created_at
        FROM public.customer_feedback ORDER BY created_at DESC LIMIT 20
      ) x),'[]'::jsonb)
    )
  ) INTO result;

  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.get_statistics_snapshot(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_statistics_snapshot(date,date) TO authenticated,service_role;

COMMIT;
