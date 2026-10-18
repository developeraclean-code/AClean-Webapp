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
  orders: 'id text PRIMARY KEY,customer_id text REFERENCES customers(id),maintenance_client_id uuid,maintenance_unit_ids jsonb,customer text,date date',
  invoices: 'id text PRIMARY KEY,job_id text REFERENCES orders(id),maintenance_client_id uuid,total numeric,customer text',
  invoice_payments: 'id uuid PRIMARY KEY,invoice_id text REFERENCES invoices(id),amount numeric',
  inventory: 'id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE,stock numeric,name text',
  inventory_units: 'id uuid PRIMARY KEY,inventory_code text REFERENCES inventory(code),stock numeric,unit_label text',
  quotation_payments: 'id uuid PRIMARY KEY,amount numeric,applied_amount numeric,quotation_id text',
  maintenance_clients: 'id uuid PRIMARY KEY,name text',
  maintenance_units: 'id uuid PRIMARY KEY,client_id uuid,unit_code text,status text,service_interval_months numeric,location text',
  maintenance_logs: 'id uuid PRIMARY KEY,unit_id uuid,client_id uuid,order_id text,service_date date',
  maintenance_followups: 'id uuid PRIMARY KEY,unit_id uuid,client_id uuid,log_id uuid,order_id text,found_date date',
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
    INSERT INTO orders(id,customer_id,maintenance_client_id,maintenance_unit_ids) SELECT 'JOB-'||i,'CUSTOMER-SIMULASI',NULL,NULL FROM generate_series(1,200) i;
    INSERT INTO invoices(id,job_id,maintenance_client_id,total) SELECT 'INV-'||i,'JOB-'||i,NULL,200000+i FROM generate_series(1,200) i;
    INSERT INTO invoice_payments SELECT gen_random_uuid(),'INV-'||i,100000+i FROM generate_series(1,200) i;
    INSERT INTO inventory(code,stock) VALUES('PIPA-SIMULASI',100);
    INSERT INTO inventory_units(id,inventory_code,stock) VALUES('00000000-0000-0000-0000-000000000001','PIPA-SIMULASI',30);`);
  const before = JSON.stringify((await db.query('SELECT jsonb_agg(to_jsonb(t)) rows FROM invoices t')).rows);
  const [base, optimized] = ['216_cron_reliability_and_recovery','217_backup_snapshot_aggregation_budget'].map(name => readFileSync(new URL('../migrations/' + name + '.sql', import.meta.url), 'utf8'));
  await check('migrations 216-217 compile, are idempotent, and preserve feature toggles', async () => {
    await sql(base); await sql(base); await sql(optimized); await sql(optimized);
    assert.equal((await row("SELECT pg_get_function_result('export_operational_backup_216()'::regprocedure) result")).result, 'json');
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
    await sql("INSERT INTO orders(id,customer_id,maintenance_client_id,maintenance_unit_ids) SELECT 'EXTRA-'||i,'CUSTOMER-SIMULASI',NULL,NULL FROM generate_series(1,1001) i");
    assert.equal((await row('SELECT json_array_length(export_operational_backup_216()->\'tables\'->\'orders\') n')).n, 1201);
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
  const detailsSql = readFileSync(new URL('../migrations/218_operational_integrity_details.sql',import.meta.url),'utf8');
  await check('218 details migration is idempotent; all 16 checks compile and match aggregate counts', async () => {
    await auth('service_role');await sql('RESET ROLE');await sql(detailsSql);await sql(detailsSql);
    await sql(`INSERT INTO maintenance_clients VALUES('10000000-0000-0000-0000-000000000001','SIMULASI A'),('10000000-0000-0000-0000-000000000002','SIMULASI B');
      INSERT INTO maintenance_units(id,client_id,unit_code,status) VALUES
      ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','AC-1','active'),
      ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','AC-1','active'),
      ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','AC-3','active');
      UPDATE orders SET maintenance_client_id='10000000-0000-0000-0000-000000000001',maintenance_unit_ids='["20000000-0000-0000-0000-000000000003","invalid-uuid"]' WHERE id='JOB-1';
      UPDATE orders SET maintenance_unit_ids='{}' WHERE id='JOB-2';`);
    await auth('service_role');const findings=(await row('SELECT audit_operational_integrity_216() findings')).findings;
    const checks=['invoice_maint_yatim','unit_code_dup','unit_ids_missing','unit_ids_other_client','unit_ids_invalid_json','log_client_mismatch','log_unit_dangling','unit_client_dangling','followup_unit_dangling','followup_log_dangling','unit_active_no_interval','invoice_payment_orphan','inventory_unit_orphan','inventory_negative','inventory_unit_negative','quotation_payment_overapplied'];
    await sql('RESET ROLE');
    const beforeRead=JSON.stringify((await db.query('SELECT jsonb_agg(to_jsonb(t)) rows FROM invoices t')).rows);
    await auth('authenticated','Owner');
    for(const check of checks){const result=(await db.query('SELECT get_operational_integrity_details_218($1,0,25) result',[check])).rows[0].result;assert.equal(result.total,findings.find(f=>f.check===check)?.n||0,check);assert.equal(result.check,check);}
    await sql('RESET ROLE');assert.equal(JSON.stringify((await db.query('SELECT jsonb_agg(to_jsonb(t)) rows FROM invoices t')).rows),beforeRead);
  });
  await check('218 details deny anon/Admin/Finance/Teknisi/Helper and validate parameters', async () => {
    await auth('anon');await assert.rejects(()=>sql("SELECT get_operational_integrity_details_218('inventory_negative')"),/permission denied/);
    for(const role of ['Admin','Finance','Teknisi','Helper']){await auth('authenticated',role);await assert.rejects(()=>sql("SELECT get_operational_integrity_details_218('inventory_negative')"),/Owner only/);}
    await auth('authenticated','Owner');
    for(const text of ["SELECT get_operational_integrity_details_218('unknown')","SELECT get_operational_integrity_details_218('inventory_negative',-1,25)","SELECT get_operational_integrity_details_218('inventory_negative',0,51)"])await assert.rejects(()=>sql(text),/Unknown|Invalid/);
  });
  await check('218 details pagination includes rows beyond 1000 without changing stock', async () => {
    await sql('RESET ROLE');await sql("INSERT INTO inventory(code,stock) SELECT 'NEG-'||lpad(i::text,4,'0'),-1 FROM generate_series(1,1201) i");
    await auth('authenticated','Owner');const result=(await row("SELECT get_operational_integrity_details_218('inventory_negative',1000,50) result")).result;
    assert.equal(result.total,1201);assert.equal(result.rows.length,50);assert.equal(result.rows[0].id,'NEG-1001');
  });
  await check('218 scoped alert setting remains Owner-only even with legacy blanket app_settings grants', async () => {
    await sql(`RESET ROLE;GRANT ALL ON app_settings TO authenticated;
      INSERT INTO user_profiles(id,role,active,phone) VALUES('30000000-0000-0000-0000-000000000001','Owner',true,'628120000001');`);
    for(const role of ['Admin','Finance','Teknisi','Helper']){
      await auth('authenticated',role);
      await assert.rejects(()=>sql("INSERT INTO app_settings VALUES('ops_alert_owner_id','30000000-0000-0000-0000-000000000001')"),/Owner only/);
    }
    await auth('authenticated','Owner');await sql("INSERT INTO app_settings VALUES('ops_alert_owner_id','30000000-0000-0000-0000-000000000001')");
    await auth('authenticated','Admin');
    await assert.rejects(()=>sql("UPDATE app_settings SET value='wrong' WHERE key='ops_alert_owner_id'"),/Owner only/);
    await assert.rejects(()=>sql("UPDATE app_settings SET key='other_key' WHERE key='ops_alert_owner_id'"),/Owner only/);
    await assert.rejects(()=>sql("DELETE FROM app_settings WHERE key='ops_alert_owner_id'"),/Owner only/);
    await sql("INSERT INTO app_settings VALUES('unrelated_legacy_setting','unchanged behavior')");
    await auth('authenticated','Owner');await assert.rejects(()=>sql("UPDATE app_settings SET value='missing-owner' WHERE key='ops_alert_owner_id'"),/active Owner/);
  });
  await check('218 blocks lower roles retargeting an Owner profile but preserves non-Owner attendance updates', async () => {
    await sql(`RESET ROLE;GRANT ALL ON user_profiles TO authenticated;
      INSERT INTO user_profiles(id,role,active,phone) VALUES('30000000-0000-0000-0000-000000000002','Helper',true,'628120000002');`);
    for(const role of ['Admin','Finance','Teknisi','Helper']){
      await auth('authenticated',role);
      for(const change of ["phone='628120000099'","active=false","id='30000000-0000-0000-0000-000000000099'"])await assert.rejects(()=>sql("UPDATE user_profiles SET "+change+" WHERE role='Owner'"),/Owner only/);
    }
    await auth('authenticated','Teknisi');await sql("UPDATE user_profiles SET active=false WHERE role='Helper'");
    await auth('authenticated','Owner');await sql("UPDATE user_profiles SET phone='628120000003' WHERE role='Owner'");
  });
  console.log(`PASS ${checks} database contracts; 200 synthetic jobs, zero production mutations/WA/R2 requests`);
} finally { await db.close(); }
