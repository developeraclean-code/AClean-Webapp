-- Quick Win 7 — REVOKE EXECUTE pada SECURITY DEFINER functions dari anon
-- Functions yg owner=postgres + SECURITY DEFINER bisa di-execute oleh siapa pun
-- yg dapat call (default: PUBLIC). Anon dapat trigger admin operations
-- (vacuum, cleanup, delete_ac_unit, dll) → privilege escalation.
--
-- Strategy:
--   1. REVOKE ALL FROM PUBLIC dulu (semua function ini)
--   2. GRANT EXECUTE ke authenticated HANYA utk yg dipakai frontend webapp
--   3. service_role tetap bisa execute semua (Supabase bypass)

BEGIN;

-- ═══ REVOKE FROM PUBLIC (semua SECURITY DEFINER pemilik postgres) ═══
REVOKE EXECUTE ON FUNCTION public.admin_list_ac_units(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_agent_logs_stratified() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_observability_logs(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_wa_messages_ttl() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_ac_unit(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_date_availability(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_month_availability(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_website_order_stats(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_website_orders(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_website_pricing() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_website_settings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_audit_trail() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_audit_log_older_than(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rl_hit(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.save_ac_unit(integer, text, text, text, text, text, integer, integer, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.save_website_setting(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_fix_invoice_on_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_website_order_status(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.vacuum_all_tables() FROM PUBLIC, anon, authenticated;

-- ═══ KEEP authenticated EXECUTE — frontend webapp masih pakai ═══
-- (Monitoring view utk Owner — UI sudah role-guard)
GRANT EXECUTE ON FUNCTION public.get_dead_rows_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.manual_vacuum_table(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_current_user(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_inventory(text, numeric) TO authenticated;

-- Note: service_role tetap bisa execute semua (Supabase default behavior).
-- Trigger functions (log_audit_trail, trigger_fix_invoice_on_insert) tetap jalan via trigger
-- meskipun REVOKED — trigger di-invoke oleh Postgres engine, bukan user.

COMMIT;
