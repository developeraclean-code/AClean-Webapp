-- Run after applying 246–249. Catalog inspection only; no payment/order writes.
BEGIN READ ONLY;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='1s';

SELECT p.oid::regprocedure AS signature,p.prosecdef AS security_definer,
  pg_get_userbyid(p.proowner) AS owner,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
  md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
 'settle_invoice_atomic','record_invoice_partial_payment_atomic','update_order_workflow_atomic',
 'revert_invoice_unpaid_atomic','delete_invoice_atomic','approve_invoice_atomic',
 'create_team_split_atomic','update_inventory_stock','restore_inventory_stock','sync_inventory_from_units',
 'confirm_material_checkout_atomic','reopen_material_checkout_atomic','adjust_inventory_usage_actual_atomic',
 'restock_inventory_atomic','adjust_inventory_item_atomic','link_expense_to_stock')
ORDER BY p.proname;

SELECT t.tgrelid::regclass AS table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_namespace n ON n.oid=(SELECT relnamespace FROM pg_class WHERE oid=t.tgrelid)
WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname IN (
 'trg_guard_fsm_posted_invoice_239','trg_guard_fsm_evidence_delete_239','trg_guard_fsm_paid_order_link_239',
 'trg_fsm_stock_serialize_240','trg_guard_atomic_team_split_insert_241')
ORDER BY 1,2;

-- convalidated=false is expected until historical dangling links are reviewed.
SELECT conname,convalidated,pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='orders_invoice_fsm_239_fkey';
ROLLBACK;
