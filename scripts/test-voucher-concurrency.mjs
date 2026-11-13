// Native PostgreSQL on a fresh loopback-only instance. No .env or external DB URL.
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:net';import {randomBytes} from 'node:crypto';
import {voucherFixture,seed,quote,save,owner,draft} from './test-voucher-db.mjs';
const {default:EmbeddedPostgres}=await import(process.env.ACLEAN_EMBEDDED_PG_MODULE||'embedded-postgres');
const port=await new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const root=mkdtempSync(join(tmpdir(),'aclean-voucher-native-'));
const server=new EmbeddedPostgres({databaseDir:join(root,'db'),port,user:'postgres',password:randomBytes(24).toString('hex'),persistent:true,postgresFlags:['-h','127.0.0.1','-k',root,'-c','shared_buffers=16MB','-c','max_connections=10'],onLog:()=>{},onError:()=>{}});
const clients=[];let passed=0;
try{
 await server.initialise();await server.start();
 const connect=async()=>{const c=server.getPgClient();await c.connect();clients.push(c);return c;};
 const setup=await connect(),a=await connect(),b=await connect();
 const db={exec:s=>setup.query(s),query:(...v)=>setup.query(...v)};
 await voucherFixture(db,{schemaOwner:'supabase_admin'});
 assert.equal((await setup.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='public' AND p.proname LIKE '%_241' AND pg_get_userbyid(p.proowner)='postgres'")).rows[0].n,8);
 for(const c of [a,b])await c.query('SET ROLE service_role');await setup.query(`CREATE FUNCTION fixture_slow_invoice() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END$$;CREATE TRIGGER fixture_slow_invoice BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION fixture_slow_invoice();`);
 const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
 await check('simultaneous same request has one save and one replay',async()=>{
  await seed(db);const q=await quote(db);const result=await Promise.all([save(a,q),save(b,q)]);assert.deepEqual(result.map(x=>x.replayed).sort(),[false,true]);
  assert.equal((await setup.query('SELECT count(*)::int n FROM voucher_operations')).rows[0].n,1);
 });
 await check('one voucher raced across two invoices has one winner',async()=>{
  await seed(db,'B','ACL-RACE');await setup.query("INSERT INTO invoices SELECT (jsonb_populate_record(NULL::invoices,to_jsonb(i)||'{\"id\":\"C\"}'::jsonb)).* FROM invoices i WHERE id='B'");
  const qa=await quote(db,'B','ACL-RACE'),qb=await quote(db,'C','ACL-RACE');
  const result=await Promise.allSettled([save(a,qa,'30000000-0000-4000-8000-000000000001'),save(b,qb,'30000000-0000-4000-8000-000000000002')]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.code,'23514');
  assert.equal((await setup.query("SELECT count(*)::int n FROM voucher_redemptions WHERE invoice_id IN ('B','C')")).rows[0].n,1);
 });
 await check('concurrent different requests for one invoice cannot overwrite a saved version',async()=>{
  await seed(db,'D','ACL-SAME');const q=await quote(db,'D','ACL-SAME');const result=await Promise.allSettled([save(a,q,'40000000-0000-4000-8000-000000000001'),save(b,q,'40000000-0000-4000-8000-000000000002')]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.code,'40001');
 });
 await check('blocked invoice times out rather than waits indefinitely',async()=>{
  await seed(db,'E','ACL-LOCK');const q=await quote(db,'E','ACL-LOCK');await a.query('BEGIN');await a.query("SELECT id FROM invoices WHERE id='E' FOR UPDATE");
  try{await assert.rejects(save(b,q,'50000000-0000-4000-8000-000000000001'),e=>e.code==='55P03');}finally{await a.query('ROLLBACK');}
 });
 await check('PPh amount is grossed up with the supported legacy alternate rate',async()=>{
  await seed(db,'F','ACL-TAX');const edit={...draft,pph23:true,pph23_rate:0.025};const q=await quote(db,'F','ACL-TAX',edit);const r=await save(db,q,'60000000-0000-4000-8000-000000000001',edit);assert.equal(Number(r.invoice.pph23_amount),Math.round(200000/.975)-200000);
 });
 await check('payment ledger independently blocks discounting even if invoice cache is stale',async()=>{
  await seed(db,'G','ACL-LEDGER');await setup.query("INSERT INTO invoice_payments(invoice_id,amount)VALUES('G',1)");await assert.rejects(quote(db,'G','ACL-LEDGER'),e=>e.code==='23514');
 });
 await check('loyalty baseline includes only PAID and normalized phone without historic awards',async()=>{
  await setup.query("INSERT INTO orders(id,phone,customer,status,date)VALUES('O1','081234567890','Fiktif','PAID','2026-11-01')");const r=(await setup.query("SELECT issue_vouchers_241('loyalty',5) r")).rows[0].r;assert.equal(r.baseline_initialized,true);assert.equal(r.issued,0);
 });
 await check('crossed milestone is issued exactly once under concurrent task calls',async()=>{
  await setup.query("INSERT INTO orders(id,phone,customer,status,date)VALUES('O2','+6281234567890','Fiktif','COMPLETED','2026-11-02'),('O3','081234567890','Fiktif','INVOICE_APPROVED','2026-11-03')");assert.equal((await setup.query("SELECT issue_vouchers_241('loyalty',5) r")).rows[0].r.issued,0);await setup.query("UPDATE orders SET status='PAID' WHERE id='O2'");const results=await Promise.all([a.query("SELECT issue_vouchers_241('loyalty',5) r"),b.query("SELECT issue_vouchers_241('loyalty',5) r")]);assert.deepEqual(results.map(x=>x.rows[0].r.issued).sort(),[0,1]);
  assert.equal((await setup.query("SELECT count(*)::int n FROM customer_vouchers WHERE issuance_key='loyalty:6281234567890:2'")).rows[0].n,1);
 });
 await check('winback is independent, normalized, avoids active orders and duplicates',async()=>{
  await setup.query("INSERT INTO customers(id,phone,name,last_service)VALUES('W1','081299999999','Fiktif',(now() AT TIME ZONE 'Asia/Jakarta')::date-181),('W2','081288888888','Fiktif',(now() AT TIME ZONE 'Asia/Jakarta')::date-181);INSERT INTO orders(id,phone,status,date)VALUES('ACTIVE','6281288888888','WORKING',current_date)");
  const one=(await setup.query("SELECT issue_vouchers_241('winback',5) r")).rows[0].r;const two=(await setup.query("SELECT issue_vouchers_241('winback',5) r")).rows[0].r;assert.equal(one.issued,1);assert.equal(two.issued,0);
 });
 console.log(JSON.stringify({passed,failed:0,scope:'native PostgreSQL; concurrent independent connections; fictional records only'}));
}catch(e){console.error(JSON.stringify({passed,code:e.code||e.name,message:e.message}));process.exitCode=1;}
finally{for(const c of clients)await c.end().catch(()=>{});await server.stop().catch(()=>{});}
