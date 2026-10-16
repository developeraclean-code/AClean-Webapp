// --check is read-only. --migrate applies only 210. --schedule provisions the
// independent 15-minute trigger AFTER the matching backend has been deployed.
// Never logs a credential or executes the worker/AI/WhatsApp itself.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const pg = await import(process.env.ACLEAN_PG_MODULE || 'pg');
const Client = pg.Client || pg.default.Client;
const env = { ...process.env };
for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if(m && !env[m[1]])env[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');
}
const mode=process.argv[2]||'--check'; assert.ok(['--check','--migrate','--schedule'].includes(mode));
const target=new URL(env.SUPABASE_DB_URL),ref=new URL(env.SUPABASE_URL||env.VITE_SUPABASE_URL).hostname.split('.')[0];
assert.ok(target.hostname.includes(ref)||decodeURIComponent(target.username).includes(ref),'Database project mismatch');
if(env.SUPABASE_DB_PASSWORD)target.password=env.SUPABASE_DB_PASSWORD;
const db=new Client({connectionString:target.toString(),ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000,query_timeout:30000,application_name:'aclean-payment-worker-config'});
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const name='210_payment_media_worker',version='20261016000000210';
const source=readFileSync(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const jobName='aclean-payment-media-retry-15m';
async function fingerprints(){
 const rows=[];
 for(const table of ['invoices','invoice_payments','orders','payment_suggestions','wa_payment_media_jobs']){
  const expr=table==='wa_payment_media_jobs'?"to_jsonb(t)-'lease_token'-'lease_expires_at'":'to_jsonb(t)';
  rows.push({table,...(await query(`SELECT count(*)::int n,md5(coalesce(string_agg((${expr})::text,'' ORDER BY id),'')) digest FROM public.${table} t`))[0]});
 }
 return rows;
}
try{
 await db.connect();await db.query(mode==='--check'?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN ISOLATION LEVEL REPEATABLE READ');
 await db.query("SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'");
 const extensions=await query("SELECT name,default_version,installed_version FROM pg_available_extensions WHERE name IN ('pg_cron','pg_net','supabase_vault') ORDER BY name");
 const history=await query('SELECT version,name,statements FROM supabase_migrations.schema_migrations WHERE name=$1 OR version=$2',[name,version]);
 if(history.length){assert.equal(history.length,1,'Ambiguous migration history');assert.ok(history[0].statements.some(s=>sha(s)===sha(source)),'Applied migration differs from local');}
 console.log(JSON.stringify({mode,migrationApplied:!!history.length,migrationSha256:sha(source),extensions,schedule:await query('SELECT jobname,schedule,active FROM cron.job WHERE jobname=$1',[jobName])}));
 if(mode==='--migrate'){
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('aclean-payment-worker-release',0))");
  const before=await fingerprints();
  if(!history.length){
   await db.query(source.replace(/^\s*BEGIN;\s*$/m,'').replace(/^\s*COMMIT;\s*$/m,''));
   await db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements,created_by) VALUES($1,$2,$3::text[],$4)',[version,name,[source],'Codex (permintaan Owner)']);
  }
  assert.deepEqual(await fingerprints(),before,'Historical business values changed; stopping');
  await db.query('COMMIT');console.log(JSON.stringify({result:'migration_210_committed',historicalMoneyAndQueueUnchanged:true}));
 }else if(mode==='--schedule'){
  assert.ok(history.length,'Apply migration 210 before configuring a scheduler');
  assert.ok(extensions.some(e=>e.name==='pg_cron'&&e.installed_version),'pg_cron unavailable');
  assert.ok(extensions.some(e=>e.name==='supabase_vault'&&e.installed_version),'Vault unavailable');
  assert.ok(extensions.some(e=>e.name==='pg_net'),'pg_net unavailable');
  assert.ok(env.INTERNAL_API_SECRET?.length>=32,'Internal secret missing or too short');
  const backend=await fetch('https://a-clean-webapp.vercel.app/api/payment-media-health',{
   headers:{'X-Internal-Token':env.INTERNAL_API_SECRET},signal:AbortSignal.timeout(12000),
  });
  assert.equal(backend.status,200,'Deploy the payment worker backend before enabling its scheduler');
  assert.ok(Array.isArray((await backend.json()).incidents),'Unexpected production payment worker health response');
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('aclean-payment-worker-release',0))");
  await db.query('CREATE EXTENSION IF NOT EXISTS pg_net');
  const existing=(await query("SELECT id FROM vault.secrets WHERE name='aclean_payment_worker_secret'"))[0];
  if(existing)await db.query('SELECT vault.update_secret($1,$2,$3,$4)',[existing.id,env.INTERNAL_API_SECRET,'aclean_payment_worker_secret','AClean payment worker server-to-server authentication']);
  else await db.query('SELECT vault.create_secret($1,$2,$3)',[env.INTERNAL_API_SECRET,'aclean_payment_worker_secret','AClean payment worker server-to-server authentication']);
  const valid=(await query("SELECT decrypted_secret=$1 valid FROM vault.decrypted_secrets WHERE name='aclean_payment_worker_secret'",[env.INTERNAL_API_SECRET]))[0];assert.equal(valid?.valid,true);
  await db.query('SELECT cron.schedule($1,$2,$3)',[jobName,'7,22,37,52 * * * *','SELECT public.dispatch_payment_media_retry();']);
  await db.query('COMMIT');console.log(JSON.stringify({result:'scheduler_enabled',cadenceMinutes:15,credentialStoredInVault:true,invoicePaymentWrites:0,workerTriggeredByScript:false}));
 }else {await db.query('ROLLBACK');console.log(JSON.stringify({result:'read_only_check_complete',productionWrites:0}));}
}catch(e){await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({error:e.code||e.name,message:e.name==='AssertionError'?e.message:'Provisioning stopped safely; credentials suppressed'}));process.exitCode=1;}
finally{await db.end().catch(()=>{});}
