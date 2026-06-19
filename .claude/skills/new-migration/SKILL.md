---
name: new-migration
description: Scaffold a new Supabase SQL migration with the correct sequential number, a documented header, and RLS template. Use when the user wants to "buat migrasi baru", add a DB schema change, create a migration file, or alter/add an RLS policy. Migrations live in migrations/ and are run manually in the Supabase SQL Editor.
---

# New Migration Scaffold

Create a new SQL migration file in `migrations/` for this project. Migrations are
plain SQL, run **manually** in the Supabase SQL Editor (no automated runner), and
numbered sequentially with a zero-padded 3-digit prefix.

## Steps

1. **Compute the next number.** List `migrations/` and find the highest existing
   numeric prefix, then add 1. Do NOT trust CLAUDE.md's "Migrations Status" list —
   it lags behind. Source of truth is the actual files.
   ```bash
   ls migrations/ | grep -E '^[0-9]{3}_' | sort | tail -1
   ```
   Zero-pad to 3 digits (e.g. `101` → `102`).

2. **Name the file** `NNN_short_snake_case_desc.sql` matching the existing style
   (e.g. `096_expenses_finance_role_access.sql`).

3. **Write a header comment** following the repo convention — every migration starts
   with `-- Migration NNN: <one-line goal>` then 2-5 lines explaining the *why*
   (the gap/bug/feature being addressed), not just the what. Look at
   `migrations/096_expenses_finance_role_access.sql` for the canonical style.

4. **Write idempotent SQL where possible** — prefer `CREATE TABLE IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ON CONFLICT DO NOTHING`.
   Migrations are hand-run, so a re-run should not error.

5. **If adding/altering RLS**, follow these project rules:
   - Policies target the **`authenticated`** role (users log in via
     `signInWithPassword`), NOT `anon`. See the RLS-authenticated gotcha in memory.
   - Wrap `auth.uid()` as `(select auth.uid())` to avoid the
     `auth_rls_initplan` performance lint (per migration 095).
   - Role checks use `EXISTS (SELECT 1 FROM user_profiles WHERE id = (select auth.uid()) AND role = ANY(ARRAY['Owner','Admin',...]))`.
   - Respect the Role Access table in CLAUDE.md — do not silently widen Admin access
     to pricelist/settings/finance/monitoring/statistik. If the change widens a
     role's access, call it out and confirm with the user first.

6. **After writing**, update the "Migrations Status" block in **both** CLAUDE.md files
   (`/Users/dedyrinaldi/CLAUDE.md` and the workspace `CLAUDE.md`) — append the new
   number with `# Applied` status only AFTER the user confirms they ran it; otherwise
   mark it `# Pending (run manually in Supabase SQL Editor)`.

7. **Remind the user** the file is NOT auto-applied — they must paste it into the
   Supabase SQL Editor and run it. Offer to walk through it.

## RLS policy starter template

```sql
-- Migration NNN: <goal>
-- <why: the gap/bug/feature>

ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY <table>_select_<scope> ON <table>
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Owner'::text, 'Admin'::text])
  ));
-- repeat FOR INSERT (WITH CHECK), UPDATE (USING + WITH CHECK), DELETE (USING)
```
