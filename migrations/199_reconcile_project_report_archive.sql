-- Dua laporan Bapak Rian sudah VERIFIED sebelum dipindah ke Project. Migrasi
-- manual 3 Oktober mengubah sumbernya ke REVISION walau arsip Project VERIFIED.
-- Pulihkan status sumber tanpa menyentuh invoice asal yang sudah CANCELLED.
BEGIN;

DO $$
DECLARE
  target record;
  source_status text;
  source_edit_log text;
  original_invoice_status text;
  archive_status text;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('LPR_WA-1790732610573_7PWT', 'WA-1790732610573', 'PDR-MIG-WA-1790732610573'),
      ('LPR_WA-1790648349063_R710', 'WA-1790648349063', 'PDR-MIG-WA-1790648349063')
    ) AS v(report_id, job_id, archive_id)
  LOOP
    SELECT sr.status, sr.edit_log, inv.status, pdr.status
      INTO source_status, source_edit_log, original_invoice_status, archive_status
      FROM public.service_reports sr
      JOIN public.orders ord ON ord.id = sr.job_id
      JOIN public.invoices inv ON inv.id = ord.invoice_id
      JOIN public.project_daily_reports pdr
        ON pdr.id = target.archive_id
       AND pdr.order_id = sr.job_id
       AND pdr.project_id = ord.project_id
     WHERE sr.id = target.report_id
       AND sr.job_id = target.job_id
       AND ord.project_id = 'p1790994139609'
     FOR UPDATE OF sr;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Project report reconciliation missing linked data: %', target.report_id;
    END IF;
    IF original_invoice_status IS DISTINCT FROM 'CANCELLED'
       OR archive_status IS DISTINCT FROM 'VERIFIED' THEN
      RAISE EXCEPTION 'Project report reconciliation unsafe state: %', target.report_id;
    END IF;
    IF source_status = 'VERIFIED' THEN CONTINUE; END IF;
    IF source_status IS DISTINCT FROM 'REVISION'
       OR (source_edit_log::jsonb -> -1) ->> 'field' IS DISTINCT FROM 'project_migration'
       OR (source_edit_log::jsonb -> -1) ->> 'old' IS DISTINCT FROM 'VERIFIED' THEN
      RAISE EXCEPTION 'Project report reconciliation unexpected status/history: %', target.report_id;
    END IF;

    UPDATE public.service_reports
       SET status = 'VERIFIED',
           edit_log = (source_edit_log::jsonb || jsonb_build_array(jsonb_build_object(
             'by', 'system',
             'at', now(),
             'field', 'project_archive_reconciliation',
             'old', 'REVISION',
             'new', 'VERIFIED',
             'note', 'Status awal dipulihkan; laporan kerja dilanjutkan di Project.'
           )))::text,
           last_changed_by = 'migration-199::project-report-reconcile',
           updated_at = now()
     WHERE id = target.report_id;
  END LOOP;
END $$;

COMMIT;
