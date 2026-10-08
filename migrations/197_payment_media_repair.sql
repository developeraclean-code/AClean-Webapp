-- PostgREST ON CONFLICT(media_job_id) cannot infer the partial index in 188.
-- A normal UNIQUE index still allows multiple NULL media_job_id values.
BEGIN;
DROP INDEX IF EXISTS public.uq_payment_suggestions_media_job;
CREATE UNIQUE INDEX uq_payment_suggestions_media_job
  ON public.payment_suggestions(media_job_id);
NOTIFY pgrst, 'reload schema';
COMMIT;
