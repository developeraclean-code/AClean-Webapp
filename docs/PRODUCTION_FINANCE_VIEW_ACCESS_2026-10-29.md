# Production Finance view access — 29 October 2026

This is an operational security record. The permanent restore guard is
`migrations/225_restore_finance_view_access_guard.sql`.

## Finding

On the self-hosted production database, `public.finance_cash_events` had `SELECT` for `anon` and `authenticated`, contrary to `migrations/212_reviewed_payment_withholding.sql`. An unauthenticated `HEAD` request to `https://sb.aclean.id/rest/v1/finance_cash_events?select=id&limit=1` returned HTTP 200 before the change. A read-only database probe confirmed at least one row was visible as `anon`; no row contents were retrieved or recorded.

`public.lab_team_directory` was not changed. Its `anon` HTTP probe returned 401, and its definition exposes only the limited active-team projection to signed-in application roles. Switching it to `security_invoker` without a separate compatibility test could break the team directory.

## Production change

The following privilege change was applied on `aclean-live-db` in a single transaction with pre/post privilege guards:

```sql
REVOKE ALL PRIVILEGES ON TABLE public.finance_cash_events
  FROM PUBLIC, anon, authenticated;
```

No customer, order, payment, or profile rows were modified. The transaction committed successfully. Its in-transaction assertion confirmed `anon` and `authenticated` no longer had `SELECT`, while `service_role` retained `SELECT`.

## Verification

- An unauthenticated `HEAD` to the same REST view returned HTTP 401 after the change.
- In a `READ ONLY` transaction with an active Owner's Auth UID and the `authenticated` database role, `get_my_role()` returned `Owner` and `get_finance_summary_v2()` completed successfully. No finance payload was printed.
- `get_finance_summary_v2`, `get_finance_month_details`, and `get_finance_snapshot` were inspected before the change: all three are owned by `postgres`, run as `SECURITY DEFINER`, and remain executable by `authenticated` and `service_role`.

This confirms the narrow direct-view exposure is closed and the tested Owner Finance path remains functional. It does **not** prove every Finance screen or staff role works; browser smoke tests remain useful.

## Restore guard

The live ACL had drifted from the checked-in migration. The root cause of that drift is not yet proven. Any future restore of the same database dump must re-apply the revoke above **before** opening the REST gateway, then check that `has_table_privilege('anon','public.finance_cash_events','SELECT')` and `has_table_privilege('authenticated','public.finance_cash_events','SELECT')` are both false. Do not rely on the old migration having run once before the dump.

## Permanent guard

Migration 225 repeats the revoke idempotently, restores the explicit
`service_role` grant, and aborts if either application role still has
`SELECT`. It passed a production rollback test and was then applied
successfully. The post-apply REST probe returned 401 and the ACL remained
`anon=false`, `authenticated=false`, `service_role=true`. Historical
migration 212 remains unchanged.
