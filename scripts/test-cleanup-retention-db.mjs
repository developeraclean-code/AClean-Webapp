// Isolated PostgreSQL/WASM checks; no production credentials or network.
// WA_PGLITE_MODULE=/private/tmp/aclean-wa-dbcheck/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-cleanup-retention-db.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.jwt_role',true) $$;
    CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.app_role',true) $$;
    CREATE TABLE agent_logs (id serial, action text, created_at timestamptz);
    CREATE TABLE audit_log (id serial, changed_at timestamptz);
    CREATE TABLE cron_runs (id serial, started_at timestamptz);
    CREATE TABLE ai_usage (id serial, created_at timestamptz);
    CREATE TABLE wa_webhook_raw (id serial, created_at timestamptz);
    CREATE TABLE wa_webhook_dedup (id serial, created_at timestamptz);
    CREATE TABLE operational_mutations (id serial, created_at timestamptz);`);
  const sql = fs.readFileSync(new URL('../migrations/195_cleanup_retention_hardening.sql', import.meta.url), 'utf8');
  await db.exec(sql); await db.exec(sql);
  console.log('PASS migration applies twice without deleting data');
  await db.exec(`INSERT INTO agent_logs(action,created_at) VALUES
    ('PAYMENT_CONFIRMED',now()-interval '200 days'),('ORDER_CREATED',now()-interval '200 days'),
    ('INVOICE_APPROVED',now()-interval '200 days'),('TECHNICAL',now()-interval '45 days');
    INSERT INTO agent_logs(action,created_at) SELECT 'TECHNICAL',now()-interval '100 days' FROM generate_series(1,250);
    INSERT INTO wa_webhook_raw(created_at) VALUES(now()-interval '15 days'),(now()-interval '1 day');
    SET test.jwt_role='authenticated'; SET test.app_role='Owner';`);
  const preview = (await db.query('select cleanup_operational_logs(false,100) r')).rows[0].r;
  assert.equal(preview.candidates.agent_logs_90d, 250);
  await assert.rejects(() => db.query('select cleanup_operational_logs(true,100)'), /service role/);
  await db.exec(`SET test.app_role='Teknisi';`);
  await assert.rejects(() => db.query('select cleanup_operational_logs(false,100)'), /ditolak/);
  console.log('PASS Owner preview and denial of manual apply/unauthorized preview');
  await db.exec(`SET test.jwt_role='service_role';`);
  const first = (await db.query('select cleanup_operational_logs(true,100) r')).rows[0].r;
  assert.equal(first.deleted.agent_logs, 100); assert.equal(first.deleted.wa_webhook_raw, 1);
  await db.exec('SELECT cleanup_old_logs(); SELECT cleanup_agent_logs_stratified(); SELECT * FROM cleanup_observability_logs(1);');
  const left = (await db.query('select action from agent_logs')).rows;
  assert.equal(left.length, 4);
  assert.equal(left.filter(r => r.action === 'TECHNICAL').length, 1);
  assert.equal((await db.query('select count(*)::int n from wa_webhook_raw')).rows[0].n, 1);
  console.log('PASS bounded deletion, business audit preservation, 45-day operational logs retained, all legacy entrypoints consistent');
  const grants = (await db.query(`select has_function_privilege('anon','cleanup_operational_logs(boolean,integer)','execute') anon,
    has_function_privilege('authenticated','cleanup_old_logs()','execute') old_auth`)).rows[0];
  assert.equal(grants.anon, false); assert.equal(grants.old_auth, false);
  console.log('PASS cleanup permissions');
} finally { await db.close(); }
