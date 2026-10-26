// Opt-in integration test against SYNTHETIC, disposable local fixtures only.
// No default credentials, no remote target, no production API/env loading.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Writable } from 'node:stream';
import pg from 'pg';
import { captureLocalBackup, databaseBaseline, databaseProcessEnv } from './lib/local-backup-capture.mjs';
import { localDatabaseUrl, readKey, privateFile, inspectArchive, objectBuffer, decryptObject, digest, requireCondition } from './lib/local-backup-archive.mjs';

const input=process.env.LOCAL_BACKUP_TEST_CONFIG;
if(!input)throw new Error('Set LOCAL_BACKUP_TEST_CONFIG to a private isolated-fixture config. No default database is used.');
const c=JSON.parse(privateFile(input)), sourceUrl=localDatabaseUrl(c.sourceDatabaseUrl), targetUrl=localDatabaseUrl(c.targetDatabaseUrl);
requireCondition(c.confirmation==='ACLEAN_ISOLATED_RECOVERY_TEST' && sourceUrl.host!==targetUrl.host,'BACKUP_ISOLATED_TEST_REQUIRED');
const root=fs.realpathSync(c.testRoot),results=[];
requireCondition(fs.statSync(root).isDirectory() && path.resolve(c.mediaRoot).startsWith(root+path.sep),'BACKUP_TEST_DIRECTORY_INVALID');
const key=readKey(c.keyFile,path.join(root,'snapshot-a'));
const source=new pg.Client({connectionString:sourceUrl.toString()}),target=new pg.Client({connectionString:targetUrl.toString()});
let phase='connect', oldCustomerName,backup;
const capture=output=>({databaseUrl:sourceUrl.toString(),pgDump:c.pgDump,repoRoot:c.repoRoot,output,keyFile:c.keyFile,configFile:c.configFile,mediaRoot:c.mediaRoot,mediaSnapshotAcknowledged:true});
const q=async(db,sql,p=[]) => (await db.query(sql,p)).rows;
async function check(name,fn){const at=Date.now();await fn();results.push({name,status:'PASS',ms:Date.now()-at});console.log('PASS '+name);}
async function assertEmptyTarget(){
  assert.equal((await q(target,"SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'"))[0].n,0);
  if((await q(target,"SELECT to_regclass('auth.users') x"))[0].x)assert.equal((await q(target,'SELECT count(*)::int n FROM auth.users'))[0].n,0);
  else assert.equal((await q(target,"SELECT count(*)::int n FROM pg_tables WHERE schemaname='auth'"))[0].n,0);
}
function fetchLocal(url,options={}){const parsed=new URL(url);requireCondition(parsed.hostname==='127.0.0.1' && parsed.protocol==='http:','BACKUP_TEST_LOCAL_HTTP_ONLY');return fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});}
async function login(api,user){const r=await fetchLocal(api.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:api.anon,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:user.password})});assert.ok(r.ok,'Local Auth login HTTP '+r.status);return r.json();}
async function apiRequest(api,route,token,body){const r=await fetchLocal(api.url+route,{method:body?'POST':'GET',headers:{apikey:api.anon,Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {ok:r.ok,status:r.status,data:await r.json()};}
try{
  await source.connect();await target.connect();
  await check('Only synthetic source marker and factory-empty target are accepted',async()=>{
    assert.equal((await q(source,'SELECT id FROM public.lab_marker'))[0].id,'aclean-local-recovery-JGEBnh');
    await assertEmptyTarget();
  });
  const sourceSession=await login(c.sourceApi,c.users[0]);
  oldCustomerName=(await q(source,"SELECT name FROM public.customers WHERE id='LAB-CUST-1'"))[0].name;
  phase='snapshot';
  await check('New native backup exports live DB/Auth/config and >1000 frozen files',async()=>{
    backup=await captureLocalBackup({...capture(path.join(root,'snapshot-a')),afterSnapshot:async()=>{
      await q(source,"UPDATE public.customers SET name='CHANGED AFTER SNAPSHOT' WHERE id='LAB-CUST-1'");
    }});
    assert.equal(backup.verified,true);assert.ok(backup.tables>=89);assert.ok(backup.files>1000);
    assert.equal(backup.sourceWrites,0);
  });
  const archive=path.join(root,'snapshot-a'),manifest=await inspectArchive(archive,key);
  await check('Config secrets and deployment/Auth settings are preserved only inside encryption',async()=>{
    const actual=JSON.parse(await objectBuffer(archive,manifest.objects.config,key));
    assert.equal(digest(JSON.stringify(actual)),digest(JSON.stringify(JSON.parse(privateFile(c.configFile)))));
    assert.ok(actual.auth && actual.environment && actual.deployment);
    for(const file of fs.readdirSync(archive))if(file.endsWith('.enc'))assert.equal(fs.readFileSync(path.join(archive,file)).includes(Buffer.from('LOCAL-ONLY-SECRET-SENTINEL')),false);
  });
  await check('Plaintext backup is never written; archive/key are separate and private',async()=>{
    assert.ok(fs.readdirSync(archive).every(n=>n==='COMPLETE.json'||/^object-\d{6}\.enc$/.test(n)||n==='manifest.enc'));
    for(const file of fs.readdirSync(archive))assert.equal(fs.statSync(path.join(archive,file)).mode&0o077,0);
    assert.equal(fs.readdirSync(archive).includes(path.basename(c.keyFile)),false);
  });
  phase='restore';
  await check('Restore uses a new empty native DB, preserving original object ownership',async()=>{
    // Destructive statements are limited to the explicitly confirmed fresh local test target.
    await assertEmptyTarget();
    await target.query('DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS public CASCADE');
    const env=databaseProcessEnv(targetUrl);env.PGOPTIONS='-c statement_timeout=120000';
    const child=spawn(c.pgRestore,['--dbname',decodeURIComponent(targetUrl.pathname.slice(1)),'--single-transaction','--exit-on-error'],{env,stdio:['pipe','ignore','pipe']});
    let err='';child.stderr.on('data',b=>{err+=b;});child.stdin.on('error',()=>{});
    const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('BACKUP_LOCAL_RESTORE_FAILED:'+err.replace(/postgres(?:ql)?:\/\/\S+|eyJ\S+/g,'[LOCAL_CREDENTIAL]').slice(-700))));});
    try{await Promise.all([decryptObject(archive,manifest.objects.database,key,child.stdin),exited]);}
    catch(e){child.kill('SIGTERM');try{await exited;}catch(restoreError){throw restoreError;}throw e;}
    await target.query('SET ROLE postgres;SET search_path TO pg_catalog');
    const actual=await databaseBaseline(target);
    assert.deepEqual(actual,manifest.database);
  });
  await check('Concurrent source write did not leak into the exported snapshot',async()=>{
    assert.equal((await q(target,"SELECT name FROM public.customers WHERE id='LAB-CUST-1'"))[0].name,oldCustomerName);
    assert.equal((await q(source,"SELECT name FROM public.customers WHERE id='LAB-CUST-1'"))[0].name,'CHANGED AFTER SNAPSHOT');
  });
  await check('All frozen media, including empty/large files, match after decryption',async()=>{
    for(const item of manifest.media){let total=0;const hash=(await import('node:crypto')).createHash('sha256');
      await decryptObject(archive,item.object,key,new Writable({write(chunk,enc,cb){total+=chunk.length;hash.update(chunk);cb();}}));
      assert.equal(total,fs.statSync(path.join(c.mediaRoot,item.key)).size);assert.equal(hash.digest('hex'),digest(fs.readFileSync(path.join(c.mediaRoot,item.key))));
    }
  });
  phase='auth';const sessions={};
  for(const user of c.users)await check('Restored real Auth and profile: '+user.role,async()=>{
    const result=await login(c.targetApi,user);assert.equal(result.user.id,user.id);sessions[user.role]=result.access_token;
    const profile=await apiRequest(c.targetApi,'/rest/v1/user_profiles?select=id,role&id=eq.'+user.id,result.access_token);assert.ok(profile.ok);assert.equal(profile.data[0].role,user.role);
  });
  await check('Restored RLS permits office roles and hides invoices from field roles',async()=>{
    for(const user of c.users){const r=await apiRequest(c.targetApi,'/rest/v1/invoices?select=id&limit=1',sessions[user.role]);assert.ok(r.ok);assert.equal(r.data.length,['Owner','Admin','Finance'].includes(user.role)?1:0);}
  });
  await check('Owner-only recovery RPC remains protected',async()=>{
    for(const user of c.users){const r=await apiRequest(c.targetApi,'/rest/v1/rpc/get_operational_recovery_status_216',sessions[user.role],{});assert.equal(r.ok,user.role==='Owner');}
  });
  await check('Replay of restored payment cannot duplicate cash',async()=>{
    const n=(await q(target,'SELECT count(*)::int n FROM public.invoice_payments'))[0].n;
    const r=await apiRequest(c.targetApi,'/rest/v1/rpc/record_invoice_partial_payment_atomic',sessions.Owner,{p_payment_id:'90000000-0000-4000-8000-000000005004',p_invoice_id:'LAB-INV-4',p_amount:1000000,p_method:'transfer',p_notes:'DP simulasi',p_paid_at:'2026-10-12',p_actor_name:'LAB Owner'});
    assert.ok(r.ok);assert.equal(r.data.replayed,true);assert.equal((await q(target,'SELECT count(*)::int n FROM public.invoice_payments'))[0].n,n);
  });
  await check('PPh repayment replay and cash/noncash balance remain correct',async()=>{
    const payment=(await q(target,"SELECT * FROM public.invoice_payments WHERE id='90000000-0000-4000-8000-000000004010'"))[0],d=payment.withholding_detail.request;
    const n=(await q(target,'SELECT count(*)::int n FROM public.invoice_payments'))[0].n;
    const result=await apiRequest(c.targetApi,'/rest/v1/rpc/confirm_invoice_wa_withholding_atomic',sessions.Owner,{p_request_id:payment.id,p_invoice_id:d.invoice,p_suggestion_id:d.suggestion,p_expected_proof_url:d.proof,p_expected_invoice:d.expected_invoice,p_paid_at:d.paid_at,p_note:d.note,p_review_ack:true});
    assert.ok(result.ok);assert.equal(result.data.replayed,true);assert.equal((await q(target,'SELECT count(*)::int n FROM public.invoice_payments'))[0].n,n);
    const sums=(await q(target,'SELECT sum(paid_amount)::float paid,sum(withheld_amount)::float tax FROM public.invoices'))[0];
    const cash=+(await q(target,'SELECT sum(amount) cash FROM public.invoice_payments'))[0].cash;assert.equal(sums.paid,cash+sums.tax);assert.equal(sums.tax,20*47500);
  });
  await check('Config tables and accepted/uncertain outbox history survive; no auto send',async()=>{
    assert.deepEqual((await q(target,'SELECT status FROM public.wa_outbox ORDER BY id')).map(r=>r.status),['ACCEPTED','UNCERTAIN']);
    for(const row of await q(target,"SELECT key,value FROM public.app_settings WHERE key LIKE '%_enabled'"))assert.equal(row.value,'false');
    for(const relation of ['cron.job','vault.secrets'])if((await q(target,'SELECT to_regclass($1) x',[relation]))[0].x)assert.equal((await q(target,'SELECT count(*)::int n FROM '+relation))[0].n,0);
  });
  await check('A second fresh backup captures newer business/config changes',async()=>{
    const changed=JSON.parse(privateFile(c.configFile));changed.deployment.backupTestRevision=2;fs.writeFileSync(c.configFile,JSON.stringify(changed),{mode:0o600});
    const result=await captureLocalBackup(capture(path.join(root,'snapshot-b')));assert.ok(result.verified);
    const next=await inspectArchive(path.join(root,'snapshot-b'),key);
    assert.notDeepEqual(next.database.tables.find(t=>t.table==='customers'),manifest.database.tables.find(t=>t.table==='customers'));
    assert.equal(JSON.parse(await objectBuffer(path.join(root,'snapshot-b'),next.objects.config,key)).deployment.backupTestRevision,2);
  });
  await check('Changing a media file mid-backup prevents publication',async()=>{
    const changed=path.join(c.mediaRoot,'during-backup.txt');
    await assert.rejects(()=>captureLocalBackup({...capture(path.join(root,'failed-changing-media')),afterSnapshot:async()=>{fs.writeFileSync(changed,'changed');}}),/MEDIA_CHANGED/);
    assert.equal(fs.existsSync(path.join(root,'failed-changing-media/COMPLETE.json')),false);
    fs.renameSync(changed,path.join(root,'test-removed-during-backup.txt'));
  });
  const oldToken=await apiRequest(c.targetApi,'/rest/v1/invoices?select=id&limit=1',sourceSession.access_token);
  results.push({name:'Old source user token acceptance is measured, not assumed',status:'OBSERVED',accepted:oldToken.ok,
    limit:'This is not a complete signing-key rotation/refresh-session revocation drill.'});
  const report={at:new Date().toISOString(),passed:results.filter(r=>r.status==='PASS').length,observations:results.filter(r=>r.status==='OBSERVED').length,failed:0,results,jobs:200,files:backup.files,tables:backup.tables,
    databaseRows:backup.rows,nativePostgres:true,liveCapture:true,productionCalls:0,productionWrites:0,waSends:0,aiCalls:0,
    productionReady:false,scope:'LOCAL_SYNTHETIC_BACKUP_METHOD',archive};
  fs.writeFileSync(path.join(root,'native-backup-results.json'),JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({...report,results:undefined}));
}catch(error){
  fs.writeFileSync(path.join(root,'native-backup-results.json'),JSON.stringify({phase,passed:results.length,failed:1,results,error:String(error.message).replace(/postgres(?:ql)?:\/\/\S+|eyJ\S+/g,'[CREDENTIAL]').slice(0,2000)}),{mode:0o600});
  console.error(JSON.stringify({failed:true,phase,error:String(error.message).replace(/postgres(?:ql)?:\/\/\S+|eyJ\S+/g,'[CREDENTIAL]').slice(0,1200)}));process.exitCode=1;
}finally{
  if(oldCustomerName!==undefined)await source.query("UPDATE public.customers SET name=$1 WHERE id='LAB-CUST-1'",[oldCustomerName]).catch(()=>{});
  await source.end().catch(()=>{});await target.end().catch(()=>{});
}
