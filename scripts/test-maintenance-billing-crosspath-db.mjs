// Real PostgreSQL semantics in WASM; no .env, network, Supabase or WhatsApp calls.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildMaintenanceInvoiceQuote } from '../src/lib/maintenanceInvoice.js';
const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite(); let checks = 0, seq = 0;
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const cid = id(1), uid = id(2);
const q = async (sql,args=[]) => (await db.query(sql,args)).rows;
const one = async (sql,args=[]) => (await q(sql,args))[0];
const check = async (name,fn) => { await fn(); checks++; console.log('PASS',name); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const payload = (name, amount=450000) => ({ id:`INV-20261015-${name}`, customer:'Synthetic client',phone:'628100000001',service:'Cleaning',units:1,labor:amount,material:0,discount:0,total:amount,status:'PENDING_APPROVAL',maintenance_client_id:cid,
  materials_detail:JSON.stringify([{nama:'Cuci VRV Indoor',jumlah:1,harga_satuan:amount,subtotal:amount,keterangan:'jasa'}]) });
async function job(name,{ group=null,invoice=null,status='REPORT_SUBMITTED',service='Cleaning' }={}) {
  await db.query('INSERT INTO orders(id,customer,phone,status,invoice_id,is_team_split,job_group_id,maintenance_client_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[name,'Synthetic client','628100000001',status,invoice,!!group,group,cid]);
  await db.query('INSERT INTO service_reports(id,job_id,status,service,teknisi) VALUES($1,$2,$3,$4,$5)',['R-'+name,name,'SUBMITTED',service,'Teknisi fixture']);
  return name;
}
async function logsFor(orderId=null,n=1) {
  const rows=[];
  for(let i=0;i<n;i++) {
    const log={id:id(1000+(++seq)),client_id:cid,unit_id:uid,service_type:'Cuci Rutin',service_category:'cuci_rutin',service_date:'2026-10-15',cost:null,order_id:orderId,invoiced:false};
    await db.query('INSERT INTO maintenance_logs(id,client_id,unit_id,service_type,service_category,service_date,cost,order_id,invoiced) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',Object.values(log)); rows.push(log);
  }
  return rows;
}
async function b2bRequest(logs) {
  const units=await q('SELECT * FROM maintenance_units'),prices=await q('SELECT * FROM maintenance_client_prices');
  const quote=buildMaintenanceInvoiceQuote({clientId:cid,logs,units,clientPrices:prices});
  return {invoice:{...payload('B2B'+(++seq),quote.total),units:quote.count,materials_detail:JSON.stringify(quote.line_items)},ids:logs.map(l=>l.id),snapshot:{logs,units,prices,catalog:[]}};
}
const b2b = async r => {
  const previous=(await one("SELECT current_setting('test.authrole',true) AS role")).role;
  if(process.argv.includes('--manual-215'))await db.exec("SET test.authrole='service_role'");
  try{return (await one('SELECT create_maintenance_invoice_atomic($1,$2,$3,$4) result',[JSON.stringify(r.invoice),r.ids,JSON.stringify(r.snapshot),'Owner fixture'])).result;}
  finally{if(process.argv.includes('--manual-215'))await db.query("SELECT set_config('test.authrole',$1,false)",[previous]);}
};
const verify = async (jid,invoice=payload('AUTO'+(++seq)),key='finalize:'+jid) => (await one('SELECT finalize_service_report_atomic($1,$2,$3,$4) result',['R-'+jid,invoice?JSON.stringify(invoice):null,'Owner fixture',key])).result;
const money = async () => q('SELECT * FROM invoice_payments ORDER BY id');
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.authrole',true) $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
    SET test.authrole='service_role'; SET test.role='Owner';
    CREATE TABLE user_profiles(id uuid,name text);
    CREATE TABLE maintenance_clients(id uuid PRIMARY KEY,name text,pic_phone text,address text);
    CREATE TABLE maintenance_units(id uuid PRIMARY KEY,client_id uuid,unit_code text,location text,brand text,ac_type text,capacity_pk numeric);
    CREATE TABLE maintenance_logs(id uuid PRIMARY KEY,client_id uuid,unit_id uuid,service_type text,service_category text,service_date date,cost bigint,order_id text,invoiced boolean DEFAULT false);
    CREATE TABLE orders(id text PRIMARY KEY,invoice_id text,status text,last_changed_by text,is_team_split boolean DEFAULT false,job_group_id text,maintenance_client_id uuid,customer text,phone text);
    CREATE TABLE service_reports(id text PRIMARY KEY,job_id text,status text,service text,teknisi text,last_changed_by text,updated_at timestamptz);
    CREATE TABLE invoices(id text PRIMARY KEY,customer text,phone text,address text,service text,job_id text,invoice_type text,units int,labor numeric,material numeric,discount numeric,total numeric,status text,maintenance_client_id uuid,
      materials_detail text,notes text,sent boolean,paid_amount numeric,remaining_amount numeric,last_changed_by text,laporan_id text,teknisi text,trade_in boolean,trade_in_amount numeric,garansi_days int,garansi_expires date,due date,created_at timestamptz DEFAULT now(),paid_at date,payment_proof_url text,pdf_url text);
    CREATE TABLE invoice_payments(id uuid PRIMARY KEY,invoice_id text,amount numeric);
    CREATE TABLE operational_mutations(mutation_key text PRIMARY KEY,operation text,actor_id uuid,actor_name text,result jsonb,completed_at timestamptz);
    CREATE TABLE team_invoice_parts(report_id text PRIMARY KEY,order_id text,group_id text,invoice_payload jsonb,units int,labor numeric,material numeric,discount numeric,trade_in_amount numeric,total numeric,updated_at timestamptz,UNIQUE(group_id,order_id));
    CREATE TABLE price_list(service text,type text,price numeric,is_active boolean);
  `);
  await db.query('INSERT INTO maintenance_clients(id,name,pic_phone) VALUES($1,$2,$3)',[cid,'Synthetic client','628100000001']);
  await db.query('INSERT INTO maintenance_units(id,client_id,unit_code,ac_type,capacity_pk) VALUES($1,$2,$3,$4,$5)',[uid,cid,'VRV-1','vrv_indoor',7.63]);
  await db.exec(readFileSync(new URL('../migrations/108_maintenance_client_prices.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../migrations/207_maintenance_included_service_prices.sql',import.meta.url),'utf8'));
  await db.query('INSERT INTO maintenance_client_prices(client_id,service_type,ac_type,capacity_pk,unit_price) VALUES($1,$2,$3,$4,$5)',[cid,'Cuci Rutin','vrv_indoor',7.63,450000]);
  const source=readFileSync(new URL('../migrations/179_team_invoice_reconciliation_retention_query_health.sql',import.meta.url),'utf8');
  await db.exec(source.slice(source.indexOf('CREATE OR REPLACE FUNCTION public.finalize_service_report_atomic('),source.indexOf('\nREVOKE ALL ON FUNCTION public.finalize_service_report_atomic')));
  const original=(await one("SELECT prosrc FROM pg_proc WHERE oid='finalize_service_report_atomic(text,jsonb,text,text)'::regprocedure")).prosrc;
  await db.exec(readFileSync(new URL('../migrations/208_maintenance_invoice_atomic.sql',import.meta.url),'utf8'));
  // Preserve a pre-209 B2B-first scenario, including the legacy link used by stale browsers.
  await job('LEGACY-B2B');const legacyLogs=await logsFor('LEGACY-B2B');const legacy=await b2b(await b2bRequest(legacyLogs));
  const migration=readFileSync(new URL('../migrations/209_maintenance_billing_crosspath_guard.sql',import.meta.url),'utf8');
  await check('migration is idempotent and preserves the deployed workflow and all historical money',async()=>{
    const before=await q('SELECT * FROM invoices ORDER BY id');
    await db.exec(migration);await db.exec(migration);
    assert.deepEqual(await q('SELECT * FROM invoices ORDER BY id'),before);
    assert.equal((await one("SELECT prosrc FROM pg_proc WHERE oid='finalize_service_report_atomic_base_209(text,jsonb,text,text)'::regprocedure")).prosrc,original);
    for(const role of ['anon','authenticated','service_role']) for(const fn of ['finalize_service_report_atomic_base_209(text,jsonb,text,text)','create_maintenance_invoice_atomic_base_209(jsonb,uuid[],jsonb,text)'])
      assert.equal((await one('SELECT has_function_privilege($1,$2,$3) ok',[role,fn,'EXECUTE'])).ok,false);
  });
  if(process.argv.includes('--manual-215')) {
    await db.exec(`CREATE TABLE app_settings(key text PRIMARY KEY,value text);
      CREATE TABLE job_materials_brought(id text PRIMARY KEY,status text,notes text);
      SET test.authrole='authenticated';SET test.role='Owner';`);
    await db.exec(readFileSync(new URL('../migrations/215_manual_report_verification_and_reminder.sql',import.meta.url),'utf8'));
    await check('manual-only guard 215 coexists with the actual 179/209 invoice finalization RPCs',async()=>{
      await job('AUTO-215');
      await db.exec("SET test.authrole='service_role'");
      await assert.rejects(()=>verify('AUTO-215'),/manual/);
      assert.equal((await one("SELECT status FROM service_reports WHERE id='R-AUTO-215'")).status,'SUBMITTED');
      await db.exec("SET test.authrole='authenticated';SET test.role='Owner'");
      assert.equal((await verify('AUTO-215')).report.status,'VERIFIED');
    });
  }
  await check('B2B first + stale verification reuses one invoice: Rp450.000, not Rp900.000',async()=>{
    const before=digest(await q('SELECT * FROM invoices WHERE id=$1',[legacy.invoice.id]));
    const out=await verify('LEGACY-B2B',payload('STALE-BROWSER'));
    assert.equal(out.invoice.id,legacy.invoice.id);assert.equal(out.invoice_reused,true);
    assert.equal((await one("SELECT count(*)::int n FROM invoices WHERE id='INV-20261015-STALE-BROWSER'")).n,0);
    assert.equal((await verify('LEGACY-B2B',null)).invoice.id,legacy.invoice.id);
    assert.equal(digest(await q('SELECT * FROM invoices WHERE id=$1',[legacy.invoice.id])),before);
    assert.equal(out.report.status,'VERIFIED');
  });
  await check('log invoice link still prevents duplicate when order pointer is missing',async()=>{
    await db.exec("UPDATE orders SET invoice_id=NULL WHERE id='LEGACY-B2B'");
    const out=await verify('LEGACY-B2B',payload('STALE-AGAIN'),'finalize:legacy-new-key');
    assert.equal(out.invoice.id,legacy.invoice.id);assert.equal(out.order.invoice_id,legacy.invoice.id);
  });
  await check('regular first rejects B2B; unverified order logs are also never billed through B2B',async()=>{
    await job('REGULAR-FIRST'); const normal=await verify('REGULAR-FIRST');
    assert.ok(normal.invoice.id);
    await assert.rejects(()=>logsFor('REGULAR-FIRST').then(b2bRequest).then(b2b),/Order\/Laporan/);
    await job('UNVERIFIED');await assert.rejects(()=>logsFor('UNVERIFIED').then(b2bRequest).then(b2b),/Order\/Laporan/);
    assert.equal((await one("SELECT status FROM service_reports WHERE id='R-UNVERIFIED'")).status,'SUBMITTED');
  });
  await check('merged/manual existing invoice retains paid status, PDF, items and cash',async()=>{
    await job('MERGED');
    await db.exec("INSERT INTO invoices(id,job_id,status,total,labor,paid_amount,remaining_amount,materials_detail,pdf_url,payment_proof_url) VALUES('INV-MERGED',NULL,'PAID',900000,900000,900000,0,'[]','existing.pdf','existing-proof.jpg'); UPDATE orders SET invoice_id='INV-MERGED' WHERE id='MERGED'");
    await db.query("INSERT INTO invoice_payments(id,invoice_id,amount) VALUES($1,'INV-MERGED',900000)",[id(99)]);
    const before=await q("SELECT * FROM invoices WHERE id='INV-MERGED'");const cash=await money();
    const out=await verify('MERGED',payload('NO-NEW-INVOICE'));
    assert.equal(out.invoice.id,'INV-MERGED');assert.equal(out.order.status,'PAID');
    assert.deepEqual(await q("SELECT * FROM invoices WHERE id='INV-MERGED'"),before);assert.deepEqual(await money(),cash);
  });
  await check('two active candidates and billed-but-unlinked history stop for manual review',async()=>{
    await job('AMBIGUOUS');await db.exec("INSERT INTO invoices(id,job_id,status) VALUES('INV-AMB-A','AMBIGUOUS','UNPAID'),('INV-AMB-B',NULL,'UNPAID');UPDATE orders SET invoice_id='INV-AMB-B' WHERE id='AMBIGUOUS'");
    await assert.rejects(()=>verify('AMBIGUOUS'),/beberapa invoice aktif/);
    await job('UNLINKED');const logs=await logsFor('UNLINKED');await db.query('UPDATE maintenance_logs SET invoiced=true WHERE id=$1',[logs[0].id]);
    await assert.rejects(()=>verify('UNLINKED'),/tautan invoice tidak jelas/);
    assert.equal((await one("SELECT count(*)::int n FROM service_reports WHERE job_id IN ('AMBIGUOUS','UNLINKED') AND status='VERIFIED'")).n,0);
  });
  await check('multi-team completeness and actual per-team sums are unchanged',async()=>{
    await job('GROUP-A',{group:'GROUP-A'});await job('GROUP-B',{group:'GROUP-A'});
    const a=await verify('GROUP-A',payload('GROUP-A-INV',450000));assert.equal(a.invoice,null);assert.equal(a.group.ready,false);
    const b=await verify('GROUP-B',payload('GROUP-B-INV',300000));assert.equal(Number(b.invoice.total),750000);assert.equal(b.group.ready,true);
    assert.equal((await verify('GROUP-A',payload('GROUP-DUP'))).invoice.id,b.invoice.id);
    assert.equal((await one("SELECT count(*)::int n FROM invoices WHERE job_id='GROUP-A'")).n,1);
  });
  await check('partial team billing is held instead of losing unbilled team work',async()=>{
    await job('PART-A',{group:'PART-A'});await job('PART-B',{group:'PART-A'});
    await db.exec("INSERT INTO invoices(id,status,job_id) VALUES('INV-PARTIAL-GROUP','UNPAID',NULL);UPDATE orders SET invoice_id='INV-PARTIAL-GROUP' WHERE id='PART-A'");
    await assert.rejects(()=>verify('PART-A'),/sebagian tim/);
    assert.equal((await one("SELECT status FROM service_reports WHERE id='R-PART-A'")).status,'SUBMITTED');
  });
  await check('failure updating the order rolls back report verification and mutation receipt',async()=>{
    await job('FAIL-REUSE',{invoice:legacy.invoice.id});
    await db.exec(`CREATE FUNCTION fail_reuse_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id='FAIL-REUSE' THEN RAISE EXCEPTION 'fixture order failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_fail_reuse BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fail_reuse_order();`);
    await assert.rejects(()=>verify('FAIL-REUSE'),/fixture order failure/);
    assert.equal((await one("SELECT status FROM service_reports WHERE id='R-FAIL-REUSE'")).status,'SUBMITTED');
    assert.equal((await one("SELECT count(*)::int n FROM operational_mutations WHERE mutation_key='finalize:FAIL-REUSE'")).n,0);
    await db.exec('DROP TRIGGER test_fail_reuse ON orders; DROP FUNCTION fail_reuse_order()');
  });
  await check('all-team legacy B2B link is reused without merging amounts twice',async()=>{
    await job('OLD-GROUP-A',{group:'OLD-GROUP-A',invoice:legacy.invoice.id});await job('OLD-GROUP-B',{group:'OLD-GROUP-A',invoice:legacy.invoice.id});
    const a=await verify('OLD-GROUP-A',payload('OLD-GROUP-NEW'));assert.equal(a.group.ready,false);
    const b=await verify('OLD-GROUP-B',payload('OLD-GROUP-NEW2'));assert.equal(b.group.ready,true);assert.equal(b.invoice.id,legacy.invoice.id);
  });
  await check('Survey remains non-billing; canceled/rescheduled orders cannot be revived',async()=>{
    await job('SURVEY',{service:'Survey'});assert.equal((await verify('SURVEY',null)).invoice,null);
    for(const status of ['CANCELLED','RESCHEDULED']){await job('STOP-'+status,{status});await assert.rejects(()=>verify('STOP-'+status),/dibatalkan|dijadwal ulang/);}
  });
  await check('both execution orders for 200 jobs each keep one invoice and unchanged cash',async()=>{
    const cash=await money();
    for(let i=0;i<200;i++){
      const jid='BATCH-'+i;await job(jid);
      if(i%2===0)await assert.rejects(()=>logsFor(jid).then(b2bRequest).then(b2b),/Order\/Laporan/);
      const first=await verify(jid,payload('BATCH-'+i,100000+i));
      assert.equal((await verify(jid,payload('OTHER-'+i),'retry:'+jid)).invoice.id,first.invoice.id);
      if(i%2!==0)await assert.rejects(()=>logsFor(jid).then(b2bRequest).then(b2b),/Order\/Laporan/);
    }
    assert.equal((await one("SELECT count(*)::int n FROM invoices WHERE job_id LIKE 'BATCH-%'")).n,200);
    assert.deepEqual(await money(),cash);
  });
  await check('200 manual B2B logs remain supported and same-set retries are idempotent',async()=>{
    const r=await b2bRequest(await logsFor(null,200));const out=await b2b(r);
    assert.equal(Number(out.invoice.total),90000000);assert.equal((await b2b(r)).invoice.id,out.invoice.id);
  });
  await check('legacy INSERT/PATCH API cannot bypass the new atomic writer during deployment',async()=>{
    const r=await b2bRequest(await logsFor(null));
    await assert.rejects(()=>db.query('INSERT INTO invoices(id,maintenance_client_id,materials_detail,total) VALUES($1,$2,$3,$4)',
      [r.invoice.id,cid,r.invoice.materials_detail,r.invoice.total]),/wajib melalui transaksi atomik/);
    assert.equal((await one('SELECT count(*)::int n FROM invoices WHERE id=$1',[r.invoice.id])).n,0);
    assert.equal((await b2b(r)).invoice.id,r.invoice.id);
    assert.notEqual((await one("SELECT current_setting('aclean.maintenance_b2b_atomic',true) marker")).marker,'209');
  });
  await check('anonymous/helper callers fail closed; private base functions cannot bypass the gate',async()=>{
    await db.exec("SET test.authrole='authenticated'");
    for(const role of ['','Helper','Teknisi']){
      await db.query("SELECT set_config('test.role',$1,false)",[role]);await assert.rejects(()=>verify('UNVERIFIED'),/Hanya Owner/);
    }
    await db.exec("SET test.authrole='service_role';SET test.role='Owner'");
  });
  await check('reapplying 209 does not change existing invoices, cash, report state or log links',async()=>{
    const snapshot=async()=>Promise.all(['invoices','orders','service_reports','maintenance_logs','invoice_payments'].map(t=>q(`SELECT * FROM ${t} ORDER BY id`)));
    const before=await snapshot();await db.exec(migration);assert.deepEqual(await snapshot(),before);
  });
  console.log(JSON.stringify({passed:checks,regular_jobs_tested:200,manual_logs_tested:200,stale_UI_gap_closed:true,production_writes:false}));
} finally { await db.close(); }
