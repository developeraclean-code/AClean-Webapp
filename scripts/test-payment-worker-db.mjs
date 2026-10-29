// Isolated PostgreSQL/WASM, synthetic media only. No environment, AI, WA or production calls.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { ensurePaymentSuggestion, retryOnePaymentMediaJob } from '../api/_payment-media.js';
const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite(); let passed = 0;
const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const q = async (sql, args=[]) => (await db.query(sql,args)).rows;
const one = async (sql,args=[]) => (await q(sql,args))[0];
const claim = async n => (await one('SELECT claim_wa_payment_media($1) job',[id(n)])).job;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS',name); };
async function insert(n, {status='STORED',stored=true,age=10,attempts=0}={}) {
 await db.query(`INSERT INTO wa_payment_media_jobs(id,source_url,phone,status,r2_key,r2_url,created_at,updated_at,next_retry_at,attempts)
 VALUES($1,$2,'628000000000',$3,$4,$5,now()-make_interval(mins=>$6),now()-make_interval(mins=>$6),now()-interval '1 minute',$7)`,
 [id(n),`https://media.invalid/${n}.jpg`,status,stored?`wa-inbox/${n}.jpg`:null,stored?`/api/foto?key=wa-inbox/${n}.jpg`:null,age,attempts]);
}
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE app_settings(key text PRIMARY KEY,value text);
 CREATE TABLE cron_runs(task_name text,status text,started_at timestamptz);
 CREATE TABLE payment_suggestions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text,validation_status text,
  phone text,sender_name text,raw_message text,amount numeric,bank text,transfer_date date,invoice_id text,order_id text,
  match_source text,source text,image_url text,created_at timestamptz DEFAULT now());
 CREATE TABLE invoices(id text,status text,total numeric);INSERT INTO invoices VALUES('KEEP','UNPAID',1000000);
 CREATE TABLE invoice_payments(id text,amount numeric);
 INSERT INTO app_settings VALUES('wa_payment_detect','true');`);
 await db.exec(readFileSync(new URL('../migrations/188_durable_wa_payment_media_queue.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../migrations/197_payment_media_repair.sql',import.meta.url),'utf8'));
 const migration=readFileSync(new URL('../migrations/210_payment_media_worker.sql',import.meta.url),'utf8');
 const cutoverMigration=readFileSync(new URL('../migrations/224_coolify_worker_routes.sql',import.meta.url),'utf8');
 await check('migration is idempotent and changes no historical financial values',async()=>{
  const before=await q('SELECT * FROM invoices');await db.exec(migration);await db.exec(migration);await db.exec(cutoverMigration);
  assert.deepEqual(await q('SELECT * FROM invoices'),before);
  assert.equal((await one('SELECT count(*)::int n FROM invoice_payments')).n,0);
 });
 await check('new webhook owns the first two minutes; retries do not race immediate classification',async()=>{
  await insert(1,{age:1});assert.equal(await claim(1001),null);await db.exec('DELETE FROM wa_payment_media_jobs');
 });
 await check('unsecured Fonnte media is claimed before an older stored media',async()=>{
  await insert(2,{age:60});await insert(3,{stored:false,age:10});const job=await claim(1002);
  assert.equal(job.id,id(3));assert.equal(job.attempts,1);assert.equal(job.status,'PROCESSING');
  assert.equal((await claim(1003)).id,id(2));assert.equal(await claim(1004),null);
 });
 await check('200 simultaneous requests receive 200 distinct durable leases',async()=>{
  await db.exec('DELETE FROM wa_payment_media_jobs');for(let n=10;n<210;n++)await insert(n);
  const jobs=await Promise.all(Array.from({length:200},(_,n)=>claim(2000+n)));
  assert.equal(new Set(jobs.map(j=>j.id)).size,200);assert.equal(new Set(jobs.map(j=>j.lease_token)).size,200);
  assert.equal(await claim(2999),null);
 });
 await check('expired process can recover, while the old owner cannot overwrite its result',async()=>{
  await db.exec('DELETE FROM wa_payment_media_jobs');await insert(300);
  const old=await claim(3001);assert.equal(await claim(3002),null);
  await db.query("UPDATE wa_payment_media_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[old.id]);
  const fresh=await claim(3002);assert.equal(fresh.attempts,2);
  const staleUpdate=await q("UPDATE wa_payment_media_jobs SET status='DONE' WHERE id=$1 AND lease_token=$2 RETURNING id",[old.id,old.lease_token]);
  assert.equal(staleUpdate.length,0);assert.equal((await one('SELECT status FROM wa_payment_media_jobs')).status,'PROCESSING');
 });
 await check('crash on the final attempt becomes manual review, not an immortal PROCESSING row',async()=>{
  await db.exec('DELETE FROM wa_payment_media_jobs');await insert(400,{attempts:2});const third=await claim(4001);
  assert.equal(third.attempts,3);assert.equal(third.retry_exhausted,false);
  await db.exec("UPDATE wa_payment_media_jobs SET lease_expires_at=now()-interval '1 second'");
  const recovered=await claim(4002);assert.equal(recovered.retry_exhausted,true);assert.equal(recovered.attempts,3);
 });
 await check('terminal media never reopens and completed suggestions stay completed',async()=>{
  await db.exec('DELETE FROM wa_payment_media_jobs');
  for(const [n,status] of ['DONE','IGNORED','PENDING_REVIEW','FAILED_PERMANENT'].entries())await insert(500+n,{status});
  await db.exec("INSERT INTO payment_suggestions(status,validation_status) VALUES('CONFIRMED','LINKED'),('DISMISSED','REJECTED')");
  assert.equal(await claim(5001),null);
  assert.deepEqual((await q('SELECT status FROM payment_suggestions ORDER BY status')).map(x=>x.status),['CONFIRMED','DISMISSED']);
 });
 await check('legacy third-attempt crashes in a retryable status also reach a final review decision',async()=>{
  await db.exec('DELETE FROM wa_payment_media_jobs');await insert(550,{attempts:3,age:60});
  const recovered=await claim(5501);assert.equal(recovered.retry_exhausted,true);assert.equal(recovered.attempts,3);
  assert.equal(await claim(5502),null);
 });
 await check('health gives exact aggregate counts, bounded incident details and no source URLs or secrets',async()=>{
  await db.exec('DELETE FROM wa_payment_media_jobs');for(let n=600;n<800;n++)await insert(n,{status:'FAILED_PERMANENT',stored:false,age:60});
  const health=(await one('SELECT get_payment_ingestion_health() health')).health;
  assert.equal(health.failed,200);assert.equal(health.incidents.length,50);assert.equal(health.waiting,0);
  assert.equal(JSON.stringify(health).includes('source_url'),false);assert.equal(JSON.stringify(health).includes('lease_token'),false);
 });
 await check('RPC permissions deny anon/authenticated and allow service_role only',async()=>{
  for(const fn of ['claim_wa_payment_media(uuid)','get_payment_ingestion_health()','dispatch_payment_media_retry()']){
   for(const role of ['anon','authenticated'])assert.equal((await one('SELECT has_function_privilege($1,$2,$3) ok',[role,fn,'EXECUTE'])).ok,false);
   assert.equal((await one('SELECT has_function_privilege($1,$2,$3) ok',['service_role',fn,'EXECUTE'])).ok,true);
  }
 });
 await check('200 complete JavaScript retry pipelines create 200 unique reviews with no invoice/ledger writes or AI calls',async()=>{
  await db.exec('DELETE FROM payment_suggestions;DELETE FROM wa_payment_media_jobs');
  for(let n=1000;n<1200;n++)await insert(n);
  await db.exec("UPDATE wa_payment_media_jobs SET category='bukti_transfer',transfer_amount=200000");
  const before=await q('SELECT * FROM invoices');const originalFetch=globalThis.fetch;
  let calls=0;
  const response=body=>({ok:true,status:200,json:async()=>body});
  globalThis.fetch=async(raw,options={})=>{
   calls++;const url=new URL(raw);assert.equal(url.origin,'https://db.invalid','External AI/storage call is forbidden in this test');
   const body=options.body?JSON.parse(options.body):null;
   if(url.pathname.endsWith('/rpc/claim_wa_payment_media'))return response((await one('SELECT claim_wa_payment_media($1) job',[body.p_lease_token])).job);
   if(url.pathname.endsWith('/invoices')){assert.ok(!options.method,'Invoices must only be read');return response([]);}
   if(url.pathname.endsWith('/wa_payment_media_jobs')&&options.method==='PATCH'){
    const keys=Object.keys(body);assert.ok(keys.every(k=>/^[a-z_]+$/.test(k)));
    const args=keys.map(k=>body[k]);args.push(url.searchParams.get('id').slice(3),url.searchParams.get('lease_token').slice(3));
    return response(await q(`UPDATE wa_payment_media_jobs SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')} WHERE id=$${keys.length+1} AND lease_token=$${keys.length+2} RETURNING *`,args));
   }
   if(url.pathname.endsWith('/payment_suggestions')&&options.method==='POST'){
    const keys=Object.keys(body);assert.ok(keys.every(k=>/^[a-z_]+$/.test(k)));
    return response(await q(`INSERT INTO payment_suggestions(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(media_job_id) DO NOTHING RETURNING *`,keys.map(k=>body[k])));
   }
   if(url.pathname.endsWith('/payment_suggestions'))return response(await q('SELECT * FROM payment_suggestions WHERE media_job_id=$1',[url.searchParams.get('media_job_id').slice(3)]));
   throw new Error('Unexpected request '+url.pathname);
  };
  try{
   const config={supabaseUrl:'https://db.invalid',serviceKey:'synthetic-service'};
   const results=await Promise.all(Array.from({length:200},()=>retryOnePaymentMediaJob(config)));
   assert.ok(results.every(r=>r.ok&&r.suggestion===1));
   assert.equal((await one('SELECT count(*)::int n FROM payment_suggestions')).n,200);
   assert.equal((await one("SELECT count(*)::int n FROM wa_payment_media_jobs WHERE status='DONE' AND lease_token IS NULL")).n,200);
   assert.deepEqual(await q('SELECT * FROM invoices'),before);assert.equal((await one('SELECT count(*)::int n FROM invoice_payments')).n,0);
   assert.equal((await retryOnePaymentMediaJob(config)).checked,0);
   const done=await one('SELECT * FROM wa_payment_media_jobs ORDER BY id LIMIT 1');
   await db.query("UPDATE payment_suggestions SET status='CONFIRMED',validation_status='LINKED' WHERE media_job_id=$1",[done.id]);
   const replay=await ensurePaymentSuggestion({...config,job:done,classification:{amount:200000}});
   assert.equal(replay.suggestion.status,'CONFIRMED');assert.equal(replay.inserted,false);
   assert.equal((await one('SELECT count(*)::int n FROM payment_suggestions')).n,200);
   console.log(JSON.stringify({pipelineJobs:200,requestsToSyntheticDb:calls,aiCalls:0,invoicePaymentWrites:0}));
  }finally{globalThis.fetch=originalFetch;}
 });
 await check('scheduler uses Vault at runtime; respects disabled detection and fails visibly without a secret',async()=>{
  await db.exec(`CREATE SCHEMA vault;CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
   CREATE SCHEMA net;CREATE TABLE net.test_requests(url text,headers jsonb,body jsonb,timeout_milliseconds integer);
   CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
   BEGIN INSERT INTO net.test_requests VALUES(url,headers,body,timeout_milliseconds); RETURN 1;END $$;`);
  await assert.rejects(()=>q('SELECT dispatch_payment_media_retry()'),/not configured/);
  await db.exec("INSERT INTO vault.decrypted_secrets VALUES('aclean_payment_worker_secret',repeat('x',48))");
  await q('SELECT dispatch_payment_media_retry()');const request=await one('SELECT * FROM net.test_requests');
  assert.equal(request.url,'https://app.aclean.id/api/cron-reminder?task=payment-media-retry');
  assert.equal(request.headers['X-Internal-Token'],'x'.repeat(48));assert.equal(request.timeout_milliseconds,55000);
  await db.exec("UPDATE app_settings SET value='false' WHERE key='wa_payment_detect'");
  assert.equal((await one('SELECT dispatch_payment_media_retry() id')).id,null);assert.equal((await one('SELECT count(*)::int n FROM net.test_requests')).n,1);
 });
 console.log(JSON.stringify({passed,syntheticMediaTested:200,productionWrites:0,aiCalls:0,whatsAppSends:0}));
}finally{await db.close();}
