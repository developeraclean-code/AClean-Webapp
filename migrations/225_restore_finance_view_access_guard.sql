-- Restore/cutover guard for ACL drift observed on production 29 October 2026.
-- This migration changes privileges only; it does not modify finance rows.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.finance_cash_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.finance_cash_events TO service_role;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.finance_cash_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.finance_cash_events', 'SELECT') THEN
    RAISE EXCEPTION 'finance_cash_events remains readable by application roles';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.finance_cash_events', 'SELECT') THEN
    RAISE EXCEPTION 'finance_cash_events is unavailable to service_role';
  END IF;
END
$$;

COMMIT;
