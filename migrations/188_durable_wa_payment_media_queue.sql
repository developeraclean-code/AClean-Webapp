-- 188 — Durable inbox + retry queue untuk bukti bayar WA personal.
-- Media diamankan ke R2 sebelum AI dipanggil. Jika AI/provider timeout, job tetap
-- dapat diulang dan admin tetap memperoleh kandidat review tanpa auto-melunasi.

BEGIN;

CREATE TABLE IF NOT EXISTS public.wa_payment_media_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url text NOT NULL UNIQUE,
  phone text NOT NULL,
  sender_name text,
  mime_type text,
  r2_key text,
  r2_url text,
  status text NOT NULL DEFAULT 'RECEIVED'
    CHECK (status IN ('RECEIVED','STORED','PROCESSING','PENDING_REVIEW','DONE','IGNORED','FAILED_RETRYABLE','FAILED_PERMANENT')),
  category text,
  transfer_amount numeric,
  fee_amount numeric,
  total_debit numeric,
  bank text,
  transfer_date date,
  invoice_id text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  next_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_payment_media_retry
  ON public.wa_payment_media_jobs(status, next_retry_at, created_at)
  WHERE status IN ('RECEIVED','STORED','FAILED_RETRYABLE');
CREATE INDEX IF NOT EXISTS idx_wa_payment_media_phone
  ON public.wa_payment_media_jobs(phone, created_at DESC);

ALTER TABLE public.wa_payment_media_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wa_payment_media_service_all ON public.wa_payment_media_jobs;
CREATE POLICY wa_payment_media_service_all
  ON public.wa_payment_media_jobs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.wa_payment_media_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.wa_payment_media_jobs TO service_role;

ALTER TABLE public.payment_suggestions
  ADD COLUMN IF NOT EXISTS media_job_id uuid
    REFERENCES public.wa_payment_media_jobs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_suggestions_media_job
  ON public.payment_suggestions(media_job_id)
  WHERE media_job_id IS NOT NULL;

COMMENT ON TABLE public.wa_payment_media_jobs IS
  'Durable queue bukti bayar WA: R2 lebih dulu, lalu AI; aman dari URL Fonnte kedaluwarsa dan retry idempoten.';
COMMENT ON COLUMN public.payment_suggestions.media_job_id IS
  'Idempotency link: satu media WA hanya boleh menghasilkan satu payment suggestion.';

COMMIT;
