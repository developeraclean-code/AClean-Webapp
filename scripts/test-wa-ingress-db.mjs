// Isolated PostgreSQL + actual capture function. Synthetic contacts only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeWaIngress, safeWhacenterMediaUrl, safeFonnteMediaUrl } from '../api/_wa-ingress.js';
const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite(); let passed = 0;
const q = async (sql, args=[]) => (await db.query(sql,args)).rows;
const one = async (sql,args=[]) => (await q(sql,args))[0];
const check = async (label, fn) => { await fn(); passed++; console.log('PASS',label); };
const event = n => normalizeWaIngress({ device:'628000000001',sender:'628000000002',type:'image',url:`https://api.fonnte.com/t/test-${n}.jpg`,timestamp:String(1792197446+n) });
const capture = async value => (await one('SELECT capture_wa_webhook_214($1::jsonb) result',[JSON.stringify(value)])).result;
try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE wa_webhook_raw(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,payload jsonb,sender text,member text,msg_type text,has_member boolean,has_message boolean,response_status integer,created_at timestamptz DEFAULT now());
    CREATE TABLE wa_messages(id bigserial PRIMARY KEY,phone text NOT NULL,name text,content text NOT NULL,role text NOT NULL DEFAULT 'customer',image_url text,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE wa_conversations(id bigserial PRIMARY KEY,phone text NOT NULL UNIQUE,name text,last_message text,last_reply text,source text DEFAULT 'manual',unread integer DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE user_profiles(id uuid DEFAULT gen_random_uuid(),phone text);
    CREATE TABLE app_settings(key text PRIMARY KEY,value text);
    CREATE TABLE invoices(id text,status text,total numeric);INSERT INTO invoices VALUES('KEEP','UNPAID',985000);
    CREATE TABLE invoice_payments(id text,amount numeric);
    CREATE TABLE payment_suggestions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text,validation_status text DEFAULT 'PENDING');
    INSERT INTO app_settings VALUES('wa_payment_detect','true');`);
  await db.exec(readFileSync(new URL('../migrations/188_durable_wa_payment_media_queue.sql',import.meta.url),'utf8'));
  const migration = readFileSync(new URL('../migrations/214_durable_wa_ingress.sql',import.meta.url),'utf8');
  await check('additive migration can run twice without changing historical finance',async()=>{
    const before=await q('SELECT * FROM invoices');await db.exec(migration);await db.exec(migration);assert.deepEqual(await q('SELECT * FROM invoices'),before);
  });
  await check('200 deliveries each persist one receipt, message, conversation increment and media reference',async()=>{
    const rows=await Promise.all(Array.from({length:200},(_,n)=>capture(event(n))));
    assert.ok(rows.every(row=>!row.duplicate&&row.message_id&&row.media_job?.id));
    for(const table of ['wa_webhook_raw','wa_messages','wa_payment_media_jobs']) assert.equal((await one(`SELECT count(*)::int n FROM ${table}`)).n,200);
    assert.equal((await one('SELECT unread FROM wa_conversations')).unread,200);
  });
  await check('200 replayed requests do not duplicate messages, unread or media',async()=>{
    const rows=await Promise.all(Array.from({length:200},(_,n)=>capture(event(n))));assert.ok(rows.every(row=>row.duplicate));
    assert.equal((await one('SELECT count(*)::int n FROM wa_messages')).n,200);assert.equal((await one('SELECT unread FROM wa_conversations')).unread,200);
  });
  await check('R2 mirror commits its parent chat attachment in the same transaction, including worker recovery',async()=>{
    const result=await capture(event(0));
    const job=await one('SELECT * FROM wa_payment_media_jobs WHERE source_url=$1',[event(0).media_url]);
    assert.equal(job.wa_message_id,result.message_id);
    await db.query("UPDATE wa_payment_media_jobs SET r2_url='/api/foto?key=wa-inbox%2F2026-10%2Ftest.jpg',r2_key='wa-inbox/2026-10/test.jpg' WHERE id=$1",[job.id]);
    assert.equal((await one('SELECT image_url FROM wa_messages WHERE id::text=$1',[result.message_id])).image_url,'/api/foto?key=wa-inbox%2F2026-10%2Ftest.jpg');
    await db.query("UPDATE wa_messages SET image_url='/api/foto?key=manual-proof' WHERE id::text=$1",[result.message_id]);
    await db.query("UPDATE wa_payment_media_jobs SET r2_url='/api/foto?key=wa-inbox%2F2026-10%2Ftest2.jpg' WHERE id=$1",[job.id]);
    assert.equal((await one('SELECT image_url FROM wa_messages WHERE id::text=$1',[result.message_id])).image_url,'/api/foto?key=manual-proof');
  });
  await check('a database failure rolls the entire intake back, leaving a safe retry',async()=>{
    await db.exec(`CREATE FUNCTION test_block_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic queue failure'; END $$;
      CREATE TRIGGER test_queue_block BEFORE INSERT ON wa_payment_media_jobs FOR EACH ROW EXECUTE FUNCTION test_block_queue();`);
    await assert.rejects(capture(event(500)),/synthetic queue failure/);
    assert.equal((await one('SELECT count(*)::int n FROM wa_messages')).n,200);assert.equal((await one('SELECT count(*)::int n FROM wa_webhook_raw')).n,200);
    assert.equal((await one('SELECT unread FROM wa_conversations')).unread,200);
    await db.exec('DROP TRIGGER test_queue_block ON wa_payment_media_jobs');assert.equal((await capture(event(500))).duplicate,false);
  });
  await check('missing media URLs and unresolved LID stay visible for manual review',async()=>{
    for(const body of [{sender:'98765432112345@lid',type:'image',timestamp:'1'},{sender:'628000000003',type:'image',timestamp:'2'}]){
      const result=await capture(normalizeWaIngress(body));assert.equal(result.intake_status,'REVIEW');assert.equal(result.media_job,null);
    }
    const health=(await one('SELECT get_wa_ingress_health_214() health')).health;
    assert.equal(health.review_count,2);assert.equal(health.incidents.length,2);assert.equal(JSON.stringify(health).includes('payload'),false);
  });
  await check('videos without captions are recorded once, never sent through payment AI',async()=>{
    const value=normalizeWaIngress({sender:'628000000004',type:'video',url:'https://api.fonnte.com/t/video.mp4',timestamp:'3'});
    const result=await capture(value);assert.equal(result.intake_status,'RECORDED');assert.ok(result.message_id);assert.equal(result.media_job,null);
    assert.equal((await capture(value)).duplicate,true);
  });
  await check('disabled detection and internal sender never enqueue customer payment proofs',async()=>{
    await db.exec("UPDATE app_settings SET value='false' WHERE key='wa_payment_detect'");
    assert.equal((await capture(event(501))).media_job,null);
    await db.exec("UPDATE app_settings SET value='true' WHERE key='wa_payment_detect';INSERT INTO user_profiles(phone) VALUES('08000000002')");
    assert.equal((await capture(event(502))).media_job,null);
    await db.exec('DELETE FROM user_profiles');
  });
  await check('existing terminal media and paid suggestions never reopen on new delivery IDs',async()=>{
    await db.exec("UPDATE wa_payment_media_jobs SET status='DONE';INSERT INTO payment_suggestions(status) VALUES('CONFIRMED')");
    const result=await capture({...event(0),event_key:event(503).event_key});assert.equal(result.media_job.status,'DONE');
    assert.equal((await one('SELECT status FROM payment_suggestions')).status,'CONFIRMED');
  });
  await check('provider group receipt does not create a fake customer/payment job',async()=>{
    const result=await capture(normalizeWaIngress({sender:'123000@g.us',member:'628000000005',type:'image',url:'https://api.fonnte.com/t/group.jpg',timestamp:'4'}));
    assert.equal(result.intake_status,'GROUP_RECEIVED');assert.equal(result.message_id,null);assert.equal(result.media_job,null);
  });
  await check('SQL rejects unsafe media URLs and public roles cannot execute capture/health',async()=>{
    await assert.rejects(capture({...event(504),media_url:'https://evil.invalid/file.jpg'}),/URL media tidak aman/);
    for(const fn of ['capture_wa_webhook_214(jsonb)','get_wa_ingress_health_214()']){
      for(const role of ['anon','authenticated'])assert.equal((await one('SELECT has_function_privilege($1,$2,$3) allowed',[role,fn,'EXECUTE'])).allowed,false);
      assert.equal((await one('SELECT has_function_privilege($1,$2,$3) allowed',['service_role',fn,'EXECUTE'])).allowed,true);
    }
  });
  const wha = n => normalizeWaIngress({from:'628000000008',to:'628000000001',type:'image',media:`https://app.whacenter.com/media/receipt-${n}.jpg`,timestamp:String(1792197446+n)}, {provider:'whacenter'});
  await check('reproduces WhaCenter media rejection by 214 before the forward fix',async()=>{
    await assert.rejects(capture(wha(900)),/URL media tidak aman/);
  });
  await check('233 is idempotent, preserves old messages and finance, and keeps Fonnte RPC compatible',async()=>{
    const before=await q('SELECT * FROM wa_messages ORDER BY id');
    const forward=readFileSync(new URL('../migrations/233_wa_media_provider_parity.sql',import.meta.url),'utf8');
    await db.exec(forward);await db.exec(forward);
    assert.deepEqual(await q('SELECT * FROM wa_messages ORDER BY id'),before);
    const f=await capture(event(901));assert.equal(f.media_job.provider,'fonnte');
    const legacy=event(902);delete legacy.payload.provider;assert.equal((await capture(legacy)).media_job.provider,'fonnte');
  });
  await check('WhaCenter intake commits receipt, message and provider-tagged recoverable media together',async()=>{
    const value=wha(903);const saved=await capture(value);
    assert.equal(saved.intake_status,'MEDIA_QUEUED');assert.equal(saved.media_job.provider,'whacenter');
    assert.equal((await capture(value)).duplicate,true);
    await db.exec("INSERT INTO app_settings(key,value) VALUES('wa_provider','fonnte') ON CONFLICT(key) DO UPDATE SET value='fonnte'");
    assert.equal((await one('SELECT provider FROM wa_payment_media_jobs WHERE id=$1',[saved.media_job.id])).provider,'whacenter');
    assert.equal((await one('SELECT count(*)::int n FROM wa_messages WHERE webhook_event_key=$1',[value.event_key])).n,1);
  });
  await check('database and app allowlists agree for canonical URLs and reject spoofed/private authorities',async()=>{
    const extra=['cdn.example.com'];
    const cases=['https://app.whacenter.com/a.jpg','https://whacenter.com/a.pdf','https://media.whacenter.com/a.jpg',
      'https://cdn.example.com/a.jpg','https://app.whacenter.com:443/a.jpg','https://app.whacenter.com/a b.jpg',
      'https://whacenter.com.evil.com/a.jpg','https://evilwhacenter.com/a.jpg','https://user:pass@whacenter.com/a.jpg',
      'https://whacenter.com:8080/a.jpg','http://app.whacenter.com/a.jpg','https://127.0.0.1/a.jpg',
      'https://api.fonnte.com/a.jpg','https://cdn.example.com.evil.com/a.jpg','https://-bad.whacenter.com/a.jpg','https://bad-.whacenter.com/a.jpg'];
    for(const value of cases){
      const safe=safeWhacenterMediaUrl(value,{env:{WHACENTER_MEDIA_HOSTS:extra.join(',')}});
      const allowed=(await one('SELECT wa_media_url_allowed_233($1,$2,$3) ok',[safe||value,'whacenter',extra])).ok;
      assert.equal(allowed,Boolean(safe),value);
    }
    for(const value of ['https://api.fonnte.com/a.jpg','https://fonnte.com/a.jpg','https://fonnte.com.evil.com/a.jpg','https://app.whacenter.com/a.jpg']){
      const safe=safeFonnteMediaUrl(value);
      assert.equal((await one('SELECT wa_media_url_allowed_233($1,$2,$3) ok',[safe||value,'fonnte',extra])).ok,Boolean(safe),value);
    }
  });
  await check('custom WhaCenter host uses the service-only overload and built-ins stay enabled',async()=>{
    const value={...wha(904),media_url:'https://cdn.example.com/invoice.pdf'};
    await assert.rejects(capture(value),/URL media tidak aman/);
    const result=(await one('SELECT capture_wa_webhook_214($1::jsonb,$2::text[]) result',[JSON.stringify(value),['cdn.example.com']])).result;
    assert.equal(result.media_job.provider,'whacenter');
    await assert.rejects(capture({...wha(905),payload:{provider:'unknown'}}),/Provider webhook tidak valid/);
  });
  await check('worker lease RPC retains the originating WhaCenter provider',async()=>{
    await db.exec('CREATE TABLE cron_runs(task_name text,status text,started_at timestamptz)');
    await db.exec(readFileSync(new URL('../migrations/210_payment_media_worker.sql',import.meta.url),'utf8'));
    await db.exec("UPDATE wa_payment_media_jobs SET status='DONE'");
    const saved=await capture(wha(908));
    await db.query("UPDATE wa_payment_media_jobs SET created_at=now()-interval '10 minutes',next_retry_at=now()-interval '1 minute' WHERE id=$1",[saved.media_job.id]);
    const claimed=(await one('SELECT claim_wa_payment_media($1::uuid) job',['20000000-0000-4000-8000-000000000001'])).job;
    assert.equal(claimed.id,saved.media_job.id);assert.equal(claimed.provider,'whacenter');
  });
  await check('actual anon/authenticated sessions cannot invoke either capture signature or the allowlist helper',async()=>{
    const functions=['capture_wa_webhook_214(jsonb)','capture_wa_webhook_214(jsonb,text[])','wa_media_url_allowed_233(text,text,text[])'];
    for(const fn of functions)for(const role of ['anon','authenticated']){
      assert.equal((await one('SELECT has_function_privilege($1,$2,$3) allowed',[role,fn,'EXECUTE'])).allowed,false);
    }
    for(const role of ['anon','authenticated']){
      await db.exec('SET ROLE '+role);
      try {await assert.rejects(capture(wha(906)),/permission denied/);} finally {await db.exec('RESET ROLE');}
    }
    await db.exec('SET ROLE service_role');
    try {assert.equal((await capture(wha(907))).media_job.provider,'whacenter');}finally{await db.exec('RESET ROLE');}
  });
  await check('reproduces missing chat preview for a file already stored in R2 staging',async()=>{
    const saved=await capture(wha(9001));
    await db.query("UPDATE wa_payment_media_jobs SET r2_key='wa-staging/2026-11/preview.jpg',r2_url='/api/foto?key=wa-staging%2F2026-11%2Fpreview.jpg' WHERE id=$1",[saved.media_job.id]);
    assert.equal((await one('SELECT image_url FROM wa_messages WHERE id::text=$1',[saved.message_id])).image_url,null);
  });
  await check('234 repairs existing staged previews idempotently without changing finance or manual attachments',async()=>{
    const migration=readFileSync(new URL('../migrations/234_wa_staged_media_chat_preview.sql',import.meta.url),'utf8');
    await db.exec(migration);await db.exec(migration);
    const saved=await capture(wha(9001));
    assert.equal((await one('SELECT image_url FROM wa_messages WHERE id::text=$1',[saved.message_id])).image_url,'/api/foto?key=wa-staging%2F2026-11%2Fpreview.jpg');
    assert.equal((await one('SELECT image_url FROM wa_messages WHERE webhook_event_key=$1',[event(0).event_key])).image_url,'/api/foto?key=manual-proof');
  });
  await check('staging preview links before OCR and advances atomically when proof is archived',async()=>{
    const saved=await capture(wha(9002));const id=saved.media_job.id;
    const staged='/api/foto?key=wa-staging%2F2026-11%2Fphoto.jpg';const archived='/api/foto?key=wa-inbox%2F2026-11%2Fphoto.jpg';
    await db.query('UPDATE wa_payment_media_jobs SET r2_url=$1 WHERE id=$2',[staged,id]);
    assert.equal((await one('SELECT image_url FROM wa_messages WHERE id::text=$1',[saved.message_id])).image_url,staged);
    await db.query('UPDATE wa_payment_media_jobs SET r2_url=$1 WHERE id=$2',[archived,id]);
    assert.equal((await one('SELECT image_url FROM wa_messages WHERE id::text=$1',[saved.message_id])).image_url,archived);
    await db.exec('BEGIN');await db.query('UPDATE wa_payment_media_jobs SET r2_url=$1 WHERE id=$2',[staged,id]);await db.exec('ROLLBACK');
    assert.equal((await one('SELECT image_url FROM wa_messages WHERE id::text=$1',[saved.message_id])).image_url,archived);
  });
  await check('preview trigger rejects external references and requires the exact customer/message/phone link',async()=>{
    const saved=await capture(wha(9003));const id=saved.media_job.id;
    await db.query('UPDATE wa_payment_media_jobs SET r2_url=$1 WHERE id=$2',['https://evil.invalid/file.jpg',id]);
    assert.equal((await one('SELECT image_url FROM wa_messages WHERE id::text=$1',[saved.message_id])).image_url,null);
    await db.query("UPDATE wa_payment_media_jobs SET phone='628000000099',r2_url='/api/foto?key=wa-staging%2Fx.jpg' WHERE id=$1",[id]);
    assert.equal((await one('SELECT image_url FROM wa_messages WHERE id::text=$1',[saved.message_id])).image_url,null);
    await db.query("UPDATE wa_payment_media_jobs SET phone='628000000008',wa_message_id=NULL WHERE id=$1",[id]);
    await db.query('UPDATE wa_payment_media_jobs SET wa_message_id=$1 WHERE id=$2',[saved.message_id,id]);
    assert.equal((await one('SELECT image_url FROM wa_messages WHERE id::text=$1',[saved.message_id])).image_url,'/api/foto?key=wa-staging%2Fx.jpg');
  });
  assert.equal((await one('SELECT count(*)::int n FROM invoice_payments')).n,0);
  assert.deepEqual(await q('SELECT * FROM invoices'),[{id:'KEEP',status:'UNPAID',total:'985000'}]);
  console.log(JSON.stringify({passed,syntheticDeliveries:200,syntheticReplays:200,productionWrites:0,aiCalls:0,paymentWrites:0}));
} finally { await db.close(); }
