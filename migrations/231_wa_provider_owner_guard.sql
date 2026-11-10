-- Restrict the global WhatsApp provider selector to Owner sessions.
-- Provider selection is read by server-only code; provider credentials remain in
-- server environment variables and are not stored in app_settings.
BEGIN;

DROP POLICY IF EXISTS app_settings_wa_provider_owner_insert ON public.app_settings;
DROP POLICY IF EXISTS app_settings_wa_provider_owner_update ON public.app_settings;
DROP POLICY IF EXISTS app_settings_wa_provider_owner_delete ON public.app_settings;
DROP POLICY IF EXISTS app_settings_wa_provider_anon_block ON public.app_settings;
DROP POLICY IF EXISTS app_settings_wa_provider_owner_guard ON public.app_settings;

-- The broad legacy write policy targets PUBLIC. Block anonymous writes to the
-- selector directly, without calling an authenticated-only role helper.
CREATE POLICY app_settings_wa_provider_anon_block
  ON public.app_settings AS RESTRICTIVE
  FOR ALL TO anon
  USING (key <> 'wa_provider')
  WITH CHECK (key <> 'wa_provider');

CREATE POLICY app_settings_wa_provider_owner_guard
  ON public.app_settings AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    key <> 'wa_provider'
    OR (auth.uid() IS NOT NULL AND (SELECT public.get_my_role()) = 'Owner')
  )
  WITH CHECK (
    key <> 'wa_provider'
    OR (auth.uid() IS NOT NULL AND (SELECT public.get_my_role()) = 'Owner')
  );

COMMIT;
