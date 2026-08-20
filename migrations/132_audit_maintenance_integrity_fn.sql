-- 132 — Fungsi audit integritas data maintenance (dipakai cron mingguan
-- taskDataIntegrityAudit). Menjadikan audit manual (yang sebelumnya dijalankan
-- ad-hoc via SQL) sebagai pemeriksaan terjadwal → anomali senyap ke-alert Owner
-- sebelum jadi masalah. Read-only (stable), tak mengubah data.
--
-- Return: jsonb array [{check, n, severity, sample}] — hanya baris n>0.
-- severity: critical (data salah, wajib fix) | warn (perlu dilengkapi) | info (jinak).
--
-- APPLIED via MCP 2026-08-20 (fungsi CREATE OR REPLACE, idempotent).

create or replace function audit_maintenance_integrity()
returns jsonb language sql stable as $fn$
  with checks as (
    -- CRITICAL: invoice job maintenance tapi invoice.maintenance_client_id NULL
    -- (yatim → hilang dari panel tagihan klien). Akar bug 107ed19.
    select 'invoice_maint_yatim' as chk, count(*)::int n, 'critical' severity,
           string_agg(i.id, ', ' order by i.created_at desc) sample
    from invoices i join orders o on o.id=i.job_id
    where o.maintenance_client_id is not null and i.maintenance_client_id is null
    union all
    -- CRITICAL: client_id log beda dari client_id unit-nya (servis nyasar ke klien salah)
    select 'log_client_mismatch', count(*)::int, 'critical', string_agg(l.id::text, ', ')
    from maintenance_logs l join maintenance_units u on u.id=l.unit_id
    where l.client_id is not null and l.client_id<>u.client_id
    union all
    -- CRITICAL: FK dangling
    select 'log_unit_dangling', count(*)::int, 'critical', string_agg(l.id::text, ', ')
    from maintenance_logs l where l.unit_id is not null and not exists(select 1 from maintenance_units u where u.id=l.unit_id)
    union all
    select 'unit_client_dangling', count(*)::int, 'critical', string_agg(u.id::text, ', ')
    from maintenance_units u where u.client_id is not null and not exists(select 1 from maintenance_clients c where c.id=u.client_id)
    union all
    select 'followup_unit_dangling', count(*)::int, 'critical', string_agg(f.id::text, ', ')
    from maintenance_followups f where f.unit_id is not null and not exists(select 1 from maintenance_units u where u.id=f.unit_id)
    union all
    -- CRITICAL: unit_code dobel dalam 1 klien (identitas unit ambigu)
    select 'unit_code_dup', count(*)::int, 'critical', string_agg(d.unit_code, ', ')
    from (select client_id, unit_code from maintenance_units group by client_id, unit_code having count(*)>1) d
    union all
    -- CRITICAL: orders.maintenance_unit_ids menunjuk unit tak ada / beda klien
    select 'unit_ids_missing', count(*)::int, 'critical', string_agg(distinct e.order_id, ', ')
    from (select o.id order_id, (jsonb_array_elements_text(o.maintenance_unit_ids))::uuid uid
          from orders o where o.maintenance_client_id is not null and jsonb_typeof(o.maintenance_unit_ids)='array') e
    where not exists(select 1 from maintenance_units u where u.id=e.uid)
    union all
    select 'unit_ids_other_client', count(*)::int, 'critical', string_agg(distinct e.order_id, ', ')
    from (select o.id order_id, o.maintenance_client_id oc, (jsonb_array_elements_text(o.maintenance_unit_ids))::uuid uid
          from orders o where o.maintenance_client_id is not null and jsonb_typeof(o.maintenance_unit_ids)='array') e
    join maintenance_units u on u.id=e.uid where u.client_id<>e.oc
    union all
    -- WARN: unit aktif tanpa interval → jadwal PM tak pernah terhitung
    select 'unit_active_no_interval', count(*)::int, 'warn', string_agg(u.unit_code, ', ')
    from maintenance_units u where u.status='active' and (u.service_interval_months is null or u.service_interval_months<=0)
    union all
    select 'followup_log_dangling', count(*)::int, 'warn', string_agg(f.id::text, ', ')
    from maintenance_followups f where f.log_id is not null and not exists(select 1 from maintenance_logs l where l.id=f.log_id)
    union all
    -- INFO (jinak): log menunjuk order yang sudah dihapus; riwayat unit tetap utuh
    select 'log_order_dangling', count(*)::int, 'info', string_agg(l.id::text, ', ')
    from maintenance_logs l where l.order_id is not null and not exists(select 1 from orders o where o.id=l.order_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('check',chk,'n',n,'severity',severity,'sample',left(coalesce(sample,''),400)) order by severity, n desc), '[]'::jsonb)
  from checks where n>0;
$fn$;

grant execute on function audit_maintenance_integrity() to service_role;
