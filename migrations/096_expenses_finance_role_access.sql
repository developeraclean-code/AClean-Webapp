-- Migration 096: Grant Finance role full CRUD access to expenses (Biaya)
-- Pre-existing gap: Finance role (commit 5a07919) was given frontend access to
-- menu "biaya" (canAccess() in App.jsx) but expenses RLS policies only allowed
-- Owner/Admin. Finance users could open the page but got 0 rows silently.
-- Fix: add 'Finance' to the role array on all 4 expenses policies.

ALTER POLICY expenses_select_owner_admin ON expenses
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Owner'::text, 'Admin'::text, 'Finance'::text])
  ));

ALTER POLICY expenses_insert_owner_admin ON expenses
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Owner'::text, 'Admin'::text, 'Finance'::text])
  ));

ALTER POLICY expenses_update_owner_admin ON expenses
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Owner'::text, 'Admin'::text, 'Finance'::text])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Owner'::text, 'Admin'::text, 'Finance'::text])
  ));

ALTER POLICY expenses_delete_owner_admin ON expenses
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = (select auth.uid())
      AND user_profiles.role = ANY (ARRAY['Owner'::text, 'Admin'::text, 'Finance'::text])
  ));
