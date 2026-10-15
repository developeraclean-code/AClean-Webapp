// Isolated PostgreSQL/WASM tests. Never reads .env, connects to Supabase or sends WA.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { dupoin, dupoinUnits, dupoinPrices } from './data/dupoin-maintenance-20261015.mjs';
import { buildMaintenanceInvoiceQuote } from '../src/lib/maintenanceInvoice.js';
const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite(); let passed = 0;
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const units = dupoinUnits.map((u, i) => ({ ...u, id: id(i + 1), client_id: dupoin.client_id }));
const prices = dupoinPrices.map((p, i) => ({ ...p, id: id(i + 201), client_id: dupoin.client_id }));
let seq = 1000;
const scalar = async sql => (await db.query(sql)).rows[0];
const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
async function batch(n = 52, order_id = null) {
  const logs = Array.from({ length: n }, (_, i) => ({ id: id(++seq), client_id: dupoin.client_id,
    unit_id: units[i % 52].id, service_type: 'Cuci Rutin', service_category: 'cuci_rutin',
    service_date: '2026-10-15', cost: null, order_id, invoiced: false }));
  for (const l of logs) await db.query(`INSERT INTO maintenance_logs(id,client_id,unit_id,service_type,service_category,service_date,cost,order_id,invoiced)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, Object.values(l));
  return logs;
}
function request(logs, changes = {}) {
  const q = buildMaintenanceInvoiceQuote({ clientId: dupoin.client_id, logs, units, clientPrices: prices });
  return { invoice: { id: `INV-20261015-TEST${++seq}`, maintenance_client_id: dupoin.client_id, service: 'Maintenance test', units: q.count,
    labor: q.labor, material: 0, total: q.total, discount: 0, materials_detail: JSON.stringify(q.line_items), notes: null, ...changes },
    ids: logs.map(l => l.id), snapshot: { logs, units, prices } };
}
async function invoke(r) {
  return (await db.query('SELECT create_maintenance_invoice_atomic($1::jsonb,$2::uuid[],$3::jsonb,$4) result',
    [JSON.stringify(r.invoice), r.ids, JSON.stringify(r.snapshot), 'Owner fixture'])).rows[0].result;
}
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role',true) $$;
    SET test.role='service_role';
    CREATE TABLE maintenance_clients(id uuid PRIMARY KEY,name text,pic_phone text,address text);
    CREATE TABLE invoices(id text PRIMARY KEY,customer text,phone text,address text,service text,job_id text,invoice_type text,
      units integer,labor numeric,material numeric,discount numeric,total numeric,status text,maintenance_client_id uuid,
      materials_detail text,notes text,sent boolean,paid_amount numeric,remaining_amount numeric,last_changed_by text);
    CREATE TABLE orders(id text PRIMARY KEY,invoice_id text,status text,last_changed_by text);
    CREATE TABLE maintenance_units(id uuid PRIMARY KEY,client_id uuid,unit_code text,location text,brand text,ac_type text,capacity_pk numeric);
    CREATE TABLE maintenance_logs(id uuid PRIMARY KEY,client_id uuid,unit_id uuid,service_type text,service_category text,
      service_date date,cost bigint,order_id text,invoiced boolean DEFAULT false);
    CREATE TABLE invoice_payments(id uuid PRIMARY KEY,amount numeric);
    CREATE TABLE price_list(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,service text,type text,price numeric,is_active boolean DEFAULT true);
  `);
  await db.query('INSERT INTO maintenance_clients(id,name,pic_phone,address) VALUES($1,$2,$3,$4)', [dupoin.client_id, dupoin.name, dupoin.pic_phone, dupoin.address]);
  for (const u of units) await db.query('INSERT INTO maintenance_units(id,client_id,unit_code,location,brand,ac_type,capacity_pk) VALUES($1,$2,$3,$4,$5,$6,$7)', [u.id,u.client_id,u.unit_code,u.location,u.brand,u.ac_type,u.capacity_pk]);
  await db.exec(readFileSync(new URL('../migrations/108_maintenance_client_prices.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../migrations/207_maintenance_included_service_prices.sql', import.meta.url), 'utf8'));
  for (const p of prices) await db.query('INSERT INTO maintenance_client_prices(id,client_id,service_type,ac_type,capacity_pk,unit_price,included_in_service) VALUES($1,$2,$3,$4,$5,$6,$7)', [p.id,p.client_id,p.service_type,p.ac_type,p.capacity_pk,p.unit_price,p.included_in_service]);
  const migration = readFileSync(new URL('../migrations/208_maintenance_invoice_atomic.sql', import.meta.url), 'utf8');
  await check('migration applies twice; does not reprice data or grant browser writes', async () => {
    await db.exec(migration); await db.exec(migration);
    assert.equal((await scalar('SELECT count(*)::int n FROM maintenance_client_prices')).n, 7);
    assert.equal((await scalar("SELECT has_function_privilege('authenticated','create_maintenance_invoice_atomic(jsonb,uuid[],jsonb,text)','EXECUTE') ok")).ok, false);
    assert.equal((await scalar("SELECT has_function_privilege('anon','create_maintenance_invoice_atomic(jsonb,uuid[],jsonb,text)','EXECUTE') ok")).ok, false);
  });
  await check('52 logs create exactly one canonical invoice at Rp15.600.000; all links commit', async () => {
    const logs = await batch(); const r = request(logs); const out = await invoke(r);
    assert.equal(Number(out.invoice.total), 15600000); assert.equal(out.invoice.status, 'PENDING_APPROVAL');
    assert.equal(JSON.parse(out.invoice.materials_detail).filter(x => x.included_in_service && x.subtotal === 0).length, 12);
    assert.equal((await db.query('SELECT count(*)::int n FROM maintenance_logs WHERE invoice_id=$1 AND invoiced', [out.invoice.id])).rows[0].n, 52);
    const again = await invoke({ ...r, invoice: { ...r.invoice, id: 'INV-20261015-RETRY' }, ids: [...r.ids].reverse() });
    assert.equal(again.invoice.id, out.invoice.id); assert.equal(again.replayed, true);
    await assert.rejects(() => invoke(request(logs.slice(0, 1))), /sudah digunakan|sudah ditagih/);
    assert.equal((await scalar('SELECT count(*)::int n FROM invoices')).n, 1);
  });
  await check('200 jobs keep per-log prices and a retry cannot create a second invoice', async () => {
    const logs = await batch(200); const r = request(logs); const out = await invoke(r);
    assert.equal(out.invoice.units, 200);
    assert.equal(Number(out.invoice.total), Number(r.invoice.total));
    assert.equal((await invoke(r)).replayed, true);
  });
  await check('log/unit edits after API read reject invoice before insertion', async () => {
    const logs = await batch(1); const r = request(logs);
    await db.query('UPDATE maintenance_logs SET cost=123 WHERE id=$1', [logs[0].id]);
    await assert.rejects(() => invoke(r), /Log berubah/);
    await db.query('UPDATE maintenance_logs SET cost=NULL WHERE id=$1', [logs[0].id]);
    await db.query('UPDATE maintenance_units SET capacity_pk=7 WHERE id=$1', [units[0].id]);
    await assert.rejects(() => invoke(r), /Aset\/kapasitas berubah/);
    await db.query('UPDATE maintenance_units SET capacity_pk=$1 WHERE id=$2', [units[0].capacity_pk, units[0].id]);
    assert.equal((await db.query('SELECT count(*)::int n FROM invoices WHERE id=$1', [r.invoice.id])).rows[0].n, 0);
  });
  await check('a price edit after API read is not silently accepted', async () => {
    const logs = await batch(1); const r = request(logs);
    await db.query('UPDATE maintenance_client_prices SET unit_price=500000 WHERE id=$1', [prices[0].id]);
    await assert.rejects(() => invoke(r), /Harga khusus berubah/);
    await db.query('UPDATE maintenance_client_prices SET unit_price=$1 WHERE id=$2', [prices[0].unit_price, prices[0].id]);
  });
  await check('global fallback price edits between preview and commit are also blocked', async () => {
    const logs = await batch(1);
    const globalUnits = units.map((u, i) => i === 0 ? { ...u, ac_type: 'split', capacity_pk: 1 } : u);
    const catalog = [{ service: 'Cleaning', type: 'AC Split 0.5-1PK', price: 95000, is_active: true }];
    await db.query('UPDATE maintenance_units SET ac_type=$1,capacity_pk=$2 WHERE id=$3', ['split',1,units[0].id]);
    await db.query('INSERT INTO price_list(service,type,price) VALUES($1,$2,$3)', ['Cleaning',catalog[0].type,95000]);
    const q = buildMaintenanceInvoiceQuote({ clientId: dupoin.client_id, logs, units: globalUnits, clientPrices: prices, priceListData: catalog });
    const r = request(logs, { labor: q.labor, total: q.total, materials_detail: JSON.stringify(q.line_items) });
    r.snapshot = { ...r.snapshot, units: globalUnits, catalog };
    await db.exec('UPDATE price_list SET price=100000');
    await assert.rejects(() => invoke(r), /Price list berubah/);
    await db.exec('UPDATE price_list SET price=95000');
    assert.equal(Number((await invoke(r)).invoice.total), 95000);
    await db.query('UPDATE maintenance_units SET ac_type=$1,capacity_pk=$2 WHERE id=$3', [units[0].ac_type,units[0].capacity_pk,units[0].id]);
  });
  await check('regular and merged job invoices both block rebilling', async () => {
    for (const merged of [false, true]) {
      const jid = `JOB-${merged}`; const iid = `INV-EXISTING-${merged}`;
      await db.query('INSERT INTO orders(id,status,invoice_id) VALUES($1,$2,$3)', [jid, 'COMPLETED', merged ? iid : null]);
      await db.query('INSERT INTO invoices(id,job_id,status) VALUES($1,$2,$3)', [iid, merged ? null : jid, 'UNPAID']);
      await assert.rejects(() => batch(1, jid).then(logs => invoke(request(logs))), /sudah memiliki invoice/);
    }
  });
  await check('foreign client / duplicate source / changed total cannot produce a draft', async () => {
    const logs = await batch(1); const r = request(logs);
    await assert.rejects(() => invoke({ ...r, ids: [r.ids[0], r.ids[0]] }), /log unik/);
    await assert.rejects(() => invoke({ ...r, invoice: { ...r.invoice, total: 1 } }), /Total invoice/);
    const foreign = id(9000);
    await db.query('INSERT INTO maintenance_clients(id,name) VALUES($1,$2)', [foreign,'Other fixture']);
    await assert.rejects(() => invoke({ ...r, invoice: { ...r.invoice, maintenance_client_id: foreign } }), /bukan milik/);
  });
  await check('failure marking logs rolls back the invoice insert too (no orphan)', async () => {
    const logs = await batch(1); const r = request(logs);
    await db.exec(`CREATE FUNCTION fail_log_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture log update failure'; END $$;
      CREATE TRIGGER test_failure BEFORE UPDATE ON maintenance_logs FOR EACH ROW EXECUTE FUNCTION fail_log_update();`);
    await assert.rejects(() => invoke(r), /fixture log update failure/);
    assert.equal((await db.query('SELECT count(*)::int n FROM invoices WHERE id=$1', [r.invoice.id])).rows[0].n, 0);
    assert.equal((await db.query('SELECT invoiced,invoice_id FROM maintenance_logs WHERE id=$1', [logs[0].id])).rows[0].invoice_id, null);
    await db.exec('DROP TRIGGER test_failure ON maintenance_logs; DROP FUNCTION fail_log_update()');
  });
  await check('Owner browser cannot bypass server-only RPC; no payment is recorded', async () => {
    const logs = await batch(1); const r = request(logs);
    await db.exec("SET test.role='authenticated'");
    await assert.rejects(() => invoke(r), /Akses pembuatan/);
    await db.exec("SET test.role='service_role'");
    assert.equal((await scalar('SELECT count(*)::int n FROM invoice_payments')).n, 0);
  });
  await check('reapplying migration leaves existing invoices, links and money unchanged', async () => {
    const snapshot = async () => Promise.all(['invoices','orders','maintenance_logs','maintenance_client_prices','invoice_payments'].map(async table =>
      (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows));
    const before = await snapshot();
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
  });
  console.log(JSON.stringify({ passed, simulation: 'PostgreSQL/WASM', production_writes: false }));
} finally { await db.close(); }
