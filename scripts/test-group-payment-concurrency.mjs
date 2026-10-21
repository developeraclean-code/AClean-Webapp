// Real simultaneous connections to a NEW ephemeral localhost-only Postgres.
// Does not load .env or accept a database URL. Never points to production.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createGroupPaymentDb,groupRpc,seedGroup,ownerId } from './lib/group-payment-db.mjs';
import { createGroupPaymentRequest } from '../src/lib/groupPayment.js';
const {default:EmbeddedPostgres}=await import(process.env.ACLEAN_EMBEDDED_PG_MODULE || 'embedded-postgres');
const port=await new Promise((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
const root=mkdtempSync(join(tmpdir(),'aclean-group-native-'));
const server=new EmbeddedPostgres({databaseDir:join(root,'database'),port,user:'postgres',password:randomBytes(24).toString('hex'),persistent:true,
  postgresFlags:['-h','127.0.0.1','-k',root,'-c','shared_buffers=16MB','-c','max_connections=10'],onLog:()=>{},onError:()=>{}});
const clients=[];let checks=0,n=800;
const uid=()=>`50000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
try {
  await server.initialise();await server.start();
  const connect=async()=>{const c=server.getPgClient();await c.connect();clients.push(c);return c;};
  const setup=await connect();const adapter={query:(...a)=>setup.query(...a),exec:sql=>setup.query(sql),close:async()=>{}};
  await createGroupPaymentDb({database:adapter});
  const a=await connect(),b=await connect();
  for(const c of [a,b])await c.query("SELECT set_config('test.uid',$1,false)",[ownerId]);
  // Force a short overlap inside the real INSERT, not a JS fake lock.
  await setup.query(`CREATE FUNCTION fixture_slow_header() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END $$;
    CREATE TRIGGER fixture_slow_header BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION fixture_slow_header();`);
  async function request(suffix,proofUrl=null){
    const invoices=(await setup.query('SELECT * FROM invoices WHERE id=ANY($1)',[['A'+suffix,'B'+suffix]])).rows;
    return createGroupPaymentRequest({invoices,invoiceIds:invoices.map(i=>i.id),totalReceived:4300000,customerPhone:'628000000001',
      proofUrl,method:'cash',reviewAcknowledged:true,requestId:uid(),paidAt:'2026-10-21T09:00:00Z'});
  }
  const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
  await check('two connections, same ID and payload: one transfer, one replay',async()=>{
    await seedGroup(adapter,'same');const req=await request('same');
    const results=await Promise.all([groupRpc(a,req),groupRpc(b,req)]);
    assert.deepEqual(results.map(x=>x.replayed).sort(),[false,true]);
    assert.equal((await setup.query('SELECT count(*)::int n FROM payments')).rows[0].n,1);
  });
  await check('different IDs, overlapping invoices and opposite selection order: exactly one winner',async()=>{
    await seedGroup(adapter,'overlap');const req=await request('overlap'),other={...req,p_request_id:uid(),p_invoice_ids:[...req.p_invoice_ids].reverse()};
    const results=await Promise.allSettled([groupRpc(a,req),groupRpc(b,other)]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(results.find(x=>x.status==='rejected').reason.code,'40001');
    const cash=(await setup.query("SELECT sum(amount)::float cash,count(*)::int n FROM invoice_payments WHERE invoice_id IN ('Aoverlap','Boverlap')")).rows[0];
    assert.deepEqual(cash,{cash:4300000,n:2});
  });
  await check('same proof on two disjoint groups: advisory proof lock prevents double consumption',async()=>{
    await seedGroup(adapter,'proof1');await seedGroup(adapter,'proof2');
    const results=await Promise.allSettled([groupRpc(a,await request('proof1','one-transfer.jpg')),groupRpc(b,await request('proof2','one-transfer.jpg'))]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.match(results.find(x=>x.status==='rejected').reason.message,/sudah digunakan/);
    assert.equal((await setup.query("SELECT count(*)::int n FROM payments WHERE payment_proof_url='one-transfer.jpg'")).rows[0].n,1);
  });
  await check('locked invoice times out instead of accumulating an unbounded waiting payment',async()=>{
    await seedGroup(adapter,'locked');const req=await request('locked');
    await a.query('BEGIN');await a.query("SELECT id FROM invoices WHERE id='Alocked' FOR UPDATE");
    const start=Date.now();try{await assert.rejects(()=>groupRpc(b,req),e=>e.code==='55P03');assert.ok(Date.now()-start<4000);}
    finally{await a.query('ROLLBACK');}
    assert.equal((await setup.query("SELECT count(*)::int n FROM invoice_payments WHERE invoice_id='Alocked'")).rows[0].n,0);
  });
  console.log(JSON.stringify({checks,nativePostgres:true,simultaneousConnections:2,productionConnections:0,productionWrites:0}));
} catch(error){console.error('FAIL',error.code||'',error.message);process.exitCode=1;}
finally {for(const c of clients)await c.end().catch(()=>{});await server.stop().catch(()=>{});}
