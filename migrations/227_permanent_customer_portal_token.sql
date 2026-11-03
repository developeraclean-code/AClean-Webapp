-- 227 — Keep one customer portal token per phone until explicitly revoked.
-- Preserve currently valid links. Previously expired links stay expired and
-- receive a new permanent token only when the next link is generated.
BEGIN;

ALTER TABLE public.customer_tokens
  ALTER COLUMN expires_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- A single row per normalized phone prevents concurrent invoice/dispatch calls
-- from creating two different permanent links for one customer.
CREATE UNIQUE INDEX IF NOT EXISTS customer_tokens_phone_unique_idx
  ON public.customer_tokens (phone);

UPDATE public.customer_tokens
SET expires_at = NULL
WHERE expires_at >= now()
  AND revoked_at IS NULL;

COMMENT ON COLUMN public.customer_tokens.expires_at IS
  'NULL means the customer portal link does not expire; non-NULL dates preserve legacy expired links.';
COMMENT ON COLUMN public.customer_tokens.revoked_at IS
  'When set, the token is unusable. The next authorized link generation rotates it.';

COMMIT;
