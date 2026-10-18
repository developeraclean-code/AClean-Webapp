// Real PostgreSQL/WASM, isolated synthetic jobs. No .env, remote DB, R2 or WA.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BACKUP_TABLES, packBackup, unpackBackup } from '../api/_backup.js';
import { drillBackupInMemory } from './lib/backup-drill.mjs';
const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite(); let checks = 0;
const sql = text => db.exec(text), row = async text => (await db.query(text)).rows[0];
const check = async (label, fn) => { await fn(); console.log('PASS ' + label); checks++; };
const auth = async (role, app = '') => sql(`RESET ROLE;SELECT set_config('test.auth_role','${role}',false),set_config('test.app_role','${app}',false);SET ROLE ${role === 'service_role' ? 'service_role' : role === 'anon' ? 'anon' : 'authenticated'};`);
const overrides = {
  user_profiles: 'id uuid PRIMARY KEY,role text,active boolean,phone text',
  customers: 'id text PRIMARY KEY',
  orders: 'id text PRIMARY KEY,customer_id text REFERENCES customers(id),maintenance_client_id uuid,maintenance_unit_ids jsonb',
  invoices: 'id text PRIMARY KEY,job_id text REFERENCES orders(id),maintenance_client_id uuid,total numeric',
  invoice_payments: 'id uuid PRIMARY KEY,invoice_id text REFERENCES invoices(id),amount numeric',
  inventory: 'id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE,stock numeric',
  inventory_units: 'id uuid PRIMARY KEY,inventory_code text REFERENCES inventory(code),stock numeric',
  quotation_payments: 'id uuid PRIMARY KEY,amount numeric,applied_amount numeric',
  maintenance_clients: 'id uuid PRIMARY KEY',
  maintenance_units: 'id uuid PRIMARY KEY,client_id uuid,unit_code text,status text,service_interval_months numeric',
  maintenance_logs: 'id uuid PRIMARY KEY,unit_id uuid,client_id uuid',
  maintenance_followups: 'id uuid PRIMARY KEY,unit_id uuid,log_id uuid',
};
try {
  await sql(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.auth_role',true) $$;
    CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.app_role',true) $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    CREATE TABLE app_settings(key text PRIMARY KEY,value text);
    CREATE TABLE backup_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),type text,tables text[],row_counts jsonb,created_at timestamptz DEFAULT now());
    INSERT INTO app_settings VALUES('cron_jobs','[{"backendKey":"data_integrity_audit_enabled","active":true}]'),('data_integrity_audit_enabled','true');`);
  for (const t of BACKUP_TABLES) await sql(`CREATE TABLE ${t} (${overrides[t] || 'id text PRIMARY KEY'})`);
  await sql(`GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    INSERT INTO customers VALUES('CUSTOMER-SIMULASI');
    INSERT INTO orders SELECT 'JOB-'||i,'CUSTOMER-SIMULASI',NULL,NULL FROM generate_series(1,200) i;
    INSERT INTO invoices SELECT 'INV-'||i,'JOB-'||i,NULL,200000+i FROM generate_series(1,200) i;
    INSERT INTO invoice_payments SELECT gen_random_uuid(),'INV-'||i,100000+i FROM generate_series(1,200) i;
    INSERT INTO inventory(code,stock) VALUES('PIPA-SIMULASI',100);
    INSERT INTO inventory_units VALUES('00000000-0000-0000-0000-000000000001','PIPA-SIMULASI',30);`);
  const before = JSON.stringify((await db.query('SELECT jsonb_agg(to_jsonb(t)) rows FROM invoices t')).rows);
  const source = readFileSync(new URL('../migrations/216_cron_reliability_and_recovery.sql', import.meta.url), 'utf8');
  await check('migration 216 compiles, is idempotent, and preserves feature toggles', async () => {
    await sql(source); await sql(source);
    assert.equal((await row("SELECT value FROM app_settings WHERE key='data_integrity_audit_enabled'")).value, 'true');
    assert.equal(JSON.stringify((await db.query('SELECT jsonb_agg(to_jsonb(t)) rows FROM invoices t')).rows), before);
  });
  await check('anon and all browser roles cannot export, claim or inspect worker state', async () => {
    for (const role of ['anon','authenticated']) {
      await auth(role, 'Owner');
      for (const query of ["SELECT export_operational_backup_216()", "SELECT audit_operational_integrity_216()", "SELECT claim_cron_worker_216('dispatcher',gen_random_uuid(),180)", 'SELECT * FROM cron_worker_leases']) await assert.rejects(() => sql(query), /permission denied/);
    }
  });
  await check('recovery status RPC is Owner-only, not Admin/Finance/Teknisi/Helper', async () => {
    for (const role of ['Admin','Finance','Teknisi','Helper']) { await auth('authenticated', role); await assert.rejects(() => sql('SELECT get_operational_recovery_status_216()'), /Owner only/); }
    await auth('authenticated', 'Owner'); await sql('SELECT get_operational_recovery_status_216()');
  });
  await check('200 overlapping SQL claims acquire exactly one lease; stale tokens cannot release it', async () => {
    await auth('service_role');
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => db.query("SELECT claim_cron_worker_216('dispatcher',$1::uuid,180) acquired", [`00000000-0000-0000-0000-${String(i + 1).padStart(12,'0')}`])));
    assert.equal(results.filter(r => r.rows[0].acquired).length, 1);
    await sql("SELECT release_cron_worker_216('dispatcher','00000000-0000-0000-0000-000000000999')");
    assert.equal((await row('SELECT count(*)::int n FROM cron_worker_leases')).n, 1);
    await sql("SELECT release_cron_worker_216('dispatcher','00000000-0000-0000-0000-000000000001')");
    assert.equal((await row('SELECT count(*)::int n FROM cron_worker_leases')).n, 0);
  });
  await check('expired leases can be acquired; old worker still cannot release replacement', async () => {
    await sql("INSERT INTO cron_worker_leases VALUES('dispatcher','00000000-0000-0000-0000-000000000001',now()-interval '1 minute')");
    assert.equal((await row("SELECT claim_cron_worker_216('dispatcher','00000000-0000-0000-0000-000000000002',180) acquired")).acquired, true);
    await sql("SELECT release_cron_worker_216('dispatcher','00000000-0000-0000-0000-000000000001')");
    assert.equal((await row('SELECT token::text FROM cron_worker_leases')).token.endsWith('2'), true);
  });
  await check('read-only audit is clean for valid financial/stock relations and detects corrupt non-UUID maintenance references', async () => {
    assert.deepEqual((await row('SELECT audit_operational_integrity_216() findings')).findings, []);
    await sql(`UPDATE orders SET maintenance_client_id='00000000-0000-0000-0000-000000000099',maintenance_unit_ids='["invalid-uuid"]' WHERE id='JOB-1';
      UPDATE inventory SET stock=-1;`);
    const findings = (await row('SELECT audit_operational_integrity_216() findings')).findings;
    assert.ok(findings.some(f => f.check === 'unit_ids_missing' && f.n === 1));
    assert.ok(findings.some(f => f.check === 'inventory_negative' && f.n === 1));
    assert.equal((await row("SELECT stock FROM inventory WHERE code='PIPA-SIMULASI'")).stock, '-1');
    await sql("UPDATE orders SET maintenance_client_id=NULL,maintenance_unit_ids=NULL;UPDATE inventory SET stock=100");
  });
  await check('snapshot includes all configured tables and 200 jobs/payment rows without 1000-row truncation', async () => {
    const bundle = (await row('SELECT export_operational_backup_216() bundle')).bundle;
    assert.deepEqual(Object.keys(bundle.tables).sort(), [...BACKUP_TABLES].sort());
    assert.equal(bundle.tables.orders.length, 200); assert.equal(bundle.tables.invoice_payments.length, 200);
    assert.ok(bundle.schema.orders.foreign_keys.some(f => f.target === 'customers'));
    assert.deepEqual(bundle.schema.inventory.unique_keys, [['code']]);
    await sql("INSERT INTO orders SELECT 'EXTRA-'||i,'CUSTOMER-SIMULASI',NULL,NULL FROM generate_series(1,1001) i");
    assert.equal((await row('SELECT jsonb_array_length(export_operational_backup_216()->\'tables\'->\'orders\') n')).n, 1201);
    await sql("DELETE FROM orders WHERE id LIKE 'EXTRA-%'");
  });
  await check('encrypted gzip snapshot restores 200 jobs into isolated typed PostgreSQL with PK/FK checks', async () => {
    const bundle = (await row('SELECT export_operational_backup_216() bundle')).bundle;
    const key = Buffer.alloc(32, 7), archive = packBackup(bundle, key);
    const decoded = unpackBackup(archive.buffer, { encryptionKey: key, manifest: archive.manifest });
    const scratch = new PGlite();
    try {
      const result = await drillBackupInMemory(scratch, decoded);
      assert.equal(result.tables, BACKUP_TABLES.length);
      assert.equal((await scratch.query('SELECT count(*)::int n FROM invoice_payments')).rows[0].n, 200);
      assert.deepEqual((await scratch.query("SELECT to_jsonb(t) row FROM invoices t WHERE id='INV-200'")).rows[0].row, bundle.tables.invoices.find(i => i.id === 'INV-200'));
    } finally { await scratch.close(); }
  });
  console.log(`PASS ${checks} database contracts; 200 synthetic jobs, zero production mutations/WA/R2 requests`);
} finally { await db.close(); }
