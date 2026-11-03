-- 228 — Finalize permanent customer links after the new portal code is live.
-- Migration 227 may have been followed by a temporary 30-day expiry to keep
-- the previous production application compatible during a staged rollout.
-- Preserve already expired or revoked links so they cannot become valid again.
BEGIN;

UPDATE public.customer_tokens
SET expires_at = NULL
WHERE expires_at > now()
  AND revoked_at IS NULL;

COMMIT;
