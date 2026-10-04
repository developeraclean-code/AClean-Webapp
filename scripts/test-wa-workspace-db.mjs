// Isolated PostgreSQL/WASM contract test; never reads .env or connects to Supabase.
// WA_PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/test-wa-workspace-db.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const { PGlite } = await import(process.env.WA_PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
let checks = 0;
const sql = text => db.exec(text);
const value = async text => (await db.query(text)).rows[0];
const check = async (label, fn) => { await fn(); checks++; console.log(`PASS ${label}`); };
const rejects = async (text, match) => { await assert.rejects(()=>sql(text),match); };
try {
  await sql(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.auth_role',true) $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;
    CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role',true) $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    CREATE TABLE user_profiles(id uuid PRIMARY KEY,name text,role text);
    INSERT INTO user_profiles VALUES('00000000-0000-4000-8000-000000000001','Admin Test','Admin');
    CREATE TABLE customers(id text PRIMARY KEY,phone text,last_rating_request date);
    CREATE TABLE invoices(id text PRIMARY KEY,job_id text,customer text,phone text,total numeric,status text,paid_amount numeric DEFAULT 0,remaining_amount numeric,paid_at date,payment_proof_url text,paid_method text,
      sent boolean,sent_at timestamptz,wa_sent_count integer,wa_last_sent_at timestamptz,wa_last_sent_mode text,wa_last_sent_batch text,wa_last_sent_by text,wa_last_sent_method text);
    CREATE TABLE invoice_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),invoice_id text,amount numeric,method text,notes text,paid_at date,recorded_by_name text);
    CREATE TABLE orders(id text PRIMARY KEY,status text);
    CREATE TABLE service_reports(id text PRIMARY KEY,report_card_sent_at timestamptz,report_card_sent_by text,report_card_sent_count integer,report_card_last_sent_mode text,report_card_last_sent_method text,updated_at timestamptz);
    CREATE TABLE wa_messages(id bigserial PRIMARY KEY,phone text,name text,content text,role text,created_at timestamptz);
    CREATE TABLE wa_conversations(phone text PRIMARY KEY,last_reply text,updated_at timestamptz);
    CREATE TABLE payment_suggestions(id uuid PRIMARY KEY,phone text,amount numeric,image_url text,status text,invoice_id text,resolved_at timestamptz,resolved_by text);
    SELECT set_config('test.auth_role','authenticated',false),set_config('test.role','Admin',false);
  `);
  await sql(readFileSync(new URL('../migrations/173_invoice_payment_idempotency.sql',import.meta.url),'utf8'));
  const docs=readFileSync(new URL('../migrations/170_atomic_document_send_and_material_stock.sql',import.meta.url),'utf8');
  await sql(docs.slice(docs.indexOf('CREATE OR REPLACE FUNCTION public.record_invoice_wa_sent('),docs.indexOf('CREATE OR REPLACE FUNCTION public.record_report_card_wa_sent(')));
  await sql(readFileSync(new URL('../migrations/171_fix_report_card_rpc_text_id.sql',import.meta.url),'utf8'));
  await sql(readFileSync(new URL('../migrations/193_whatsapp_workspace.sql',import.meta.url),'utf8'));
  const p1='10000000-0000-4000-8000-000000000001', p2='10000000-0000-4000-8000-000000000002';
  const r1='20000000-0000-4000-8000-000000000001';
  await sql(`INSERT INTO customers VALUES('c1','6281234567890',NULL); INSERT INTO orders VALUES('J1','COMPLETED'),('J2','COMPLETED');
    INSERT INTO invoices(id,job_id,customer,phone,total,status,paid_amount,remaining_amount) VALUES
      ('A','J1','Rumah','6281234567890',500,'PARTIAL_PAID',200,300),('B','J2','Kantor','6281234567890',500,'UNPAID',0,500),('X',NULL,'Lain','6288888888888',100,'UNPAID',0,100);
    INSERT INTO payment_suggestions(id,phone,amount,image_url,status) VALUES('${p1}','6281234567890',600,'https://proof.test/1','PENDING'),('${p2}','6281234567890',100,'https://proof.test/2','PENDING');`);
  const pay=`SELECT apply_wa_payment('${r1}','${p1}','[{"invoice_id":"A","amount":300},{"invoice_id":"B","amount":300}]',600,'transfer','')`;
  await check('migration compiles and partial + multi-invoice payment commits',async()=>{
    await sql(pay);
    assert.deepEqual(await value("SELECT paid_amount::float,status FROM invoices WHERE id='A'"),{paid_amount:500,status:'PAID'});
    assert.deepEqual(await value("SELECT paid_amount::float,status FROM invoices WHERE id='B'"),{paid_amount:300,status:'PARTIAL_PAID'});
    assert.equal((await value(`SELECT status FROM payment_suggestions WHERE id='${p1}'`)).status,'CONFIRMED');
    assert.equal((await value("SELECT status FROM orders WHERE id='J1'")).status,'PAID');
  });
  await check('retry the same request is idempotent and cannot change payload',async()=>{
    await sql(pay);assert.equal((await value('SELECT count(*)::int AS n FROM invoice_payments')).n,2);
    await rejects(pay.replace("600,'transfer'","700,'transfer'"),/data berbeda/);
    await rejects(pay.replace(r1,'20000000-0000-4000-8000-000000000002'),/sudah diproses/);
  });
  await check('overpayment rolls back all allocations and leaves proof pending',async()=>{
    await rejects(`SELECT apply_wa_payment(gen_random_uuid(),'${p2}','[{"invoice_id":"B","amount":201}]',201,'transfer','Koreksi sesuai bukti asli')`,/melebihi/);
    assert.equal((await value(`SELECT status FROM payment_suggestions WHERE id='${p2}'`)).status,'PENDING');
    assert.equal((await value('SELECT count(*)::int AS n FROM wa_payment_receipts')).n,1);
  });
  await check('cross-phone and duplicate allocations cannot be paid',async()=>{
    await rejects(`SELECT apply_wa_payment(gen_random_uuid(),'${p2}','[{"invoice_id":"X","amount":100}]',100,'transfer','')`,/Nomor/);
    await rejects(`SELECT apply_wa_payment(gen_random_uuid(),'${p2}','[{"invoice_id":"B","amount":50},{"invoice_id":"B","amount":50}]',100,'transfer','')`,/unik/);
    await rejects(`SELECT apply_wa_payment(gen_random_uuid(),'${p2}','[{"invoice_id":"B","amount":99}]',99,'transfer','')`,/koreksi/);
  });
  await check('failure on the second invoice rolls back the first invoice and receipt',async()=>{
    const proof='10000000-0000-4000-8000-000000000003';
    await sql(`INSERT INTO payment_suggestions(id,phone,amount,status) VALUES('${proof}','6281234567890',200,'PENDING')`);
    await rejects(`SELECT apply_wa_payment(gen_random_uuid(),'${proof}','[{"invoice_id":"B","amount":100},{"invoice_id":"X","amount":100}]',200,'transfer','')`,/Nomor/);
    assert.equal((await value("SELECT paid_amount::float AS amount FROM invoices WHERE id='B'")).amount,300);
    assert.equal((await value('SELECT count(*)::int AS n FROM invoice_payments')).n,2);
    assert.equal((await value('SELECT count(*)::int AS n FROM wa_payment_receipts')).n,1);
  });
  await check('proof reuse across separate suggestions is refused',async()=>{
    await sql(`UPDATE payment_suggestions SET image_url='https://proof.test/1' WHERE id='${p2}'`);
    await rejects(`SELECT apply_wa_payment(gen_random_uuid(),'${p2}','[{"invoice_id":"B","amount":100}]',100,'transfer','')`,/sudah digunakan/);
  });
  await check('follow-up optimistic concurrency and inbound reopening',async()=>{
    await sql("SELECT save_wa_followup('6281234567890',0,'DONE',NULL,'Admin','Sudah selesai')");
    await rejects("SELECT save_wa_followup('6281234567890',0,'WAITING_CUSTOMER',NULL,'Admin','')",/admin lain/);
    await sql("INSERT INTO wa_messages(phone,name,content,role,created_at) VALUES('6281234567890','Customer','Halo lagi','customer',now())");
    assert.deepEqual(await value("SELECT status,version FROM wa_followups WHERE phone='6281234567890'"),{status:'NEEDS_REPLY',version:2});
  });
  await check('unauthorized and null roles fail closed; table writes denied',async()=>{
    await sql("SELECT set_config('test.role','Teknisi',false); SET ROLE authenticated;");
    assert.equal((await value('SELECT count(*)::int AS n FROM wa_followups')).n,0);
    await rejects("INSERT INTO wa_followups(phone) VALUES('6281111111111')",/permission denied/);
    await rejects("SELECT save_wa_followup('6281234567890',2,'DONE',NULL,'','')",/Akses/);
    await rejects(pay,/Akses/);
    await sql("RESET ROLE; SELECT set_config('test.role','',false)");await rejects(pay,/Akses/);
    await sql("SELECT set_config('test.role','Admin',false)");
  });
  const sid='30000000-0000-4000-8000-000000000001';
  const payload=`'{"phone":"6281234567890","kind":"INVOICE","document_id":"B","message":"Invoice","url":"https://docs.test/B.pdf"}'`;
  await check('only server claims sends and duplicate ID never claims twice',async()=>{
    await rejects(`SELECT claim_wa_send('${sid}',${payload},'Admin')`,/Server only/);
    await sql("SELECT set_config('test.auth_role','service_role',false)");
    assert.equal((await value(`SELECT claim_wa_send('${sid}',${payload},'Admin') AS v`)).v.claimed,true);
    assert.equal((await value(`SELECT claim_wa_send('${sid}',${payload},'Admin') AS v`)).v.claimed,false);
    await rejects(`SELECT claim_wa_send('${sid}',${payload.replace('Invoice','Different')},'Admin')`,/berbeda/);
  });
  await check('accepted document atomically records message and audit exactly once',async()=>{
    await sql(`SELECT finish_wa_send('${sid}','ACCEPTED',NULL,'provider-1'); SELECT finish_wa_send('${sid}','ACCEPTED',NULL,'provider-1')`);
    assert.equal((await value(`SELECT count(*)::int AS n FROM wa_messages WHERE id=(SELECT message_id FROM wa_outbox WHERE id='${sid}')`)).n,1);
    assert.equal((await value("SELECT wa_sent_count FROM invoices WHERE id='B'")).wa_sent_count,1);
  });
  await check('manual and cron reminders share cooldown including uncertain attempts',async()=>{
    const rem=`'{"phone":"6281234567890","kind":"SERVICE_REMINDER","customer_id":"c1","message":"Servis lagi?"}'`;
    const id='30000000-0000-4000-8000-000000000002';
    await sql(`SELECT claim_wa_send('${id}',${rem},'Admin'); SELECT finish_wa_send('${id}','UNCERTAIN','timeout',NULL)`);
    await rejects(`SELECT claim_wa_send(gen_random_uuid(),${rem},'Cron')`,/30 hari/);
    assert.equal((await value("SELECT last_rating_request FROM customers WHERE id='c1'")).last_rating_request,null);
  });
  await check('explicitly failed reminder can retry; accepted reminder updates legacy cooldown',async()=>{
    await sql("INSERT INTO customers VALUES('c2','6281234567891',NULL)");
    const rem=`'{"phone":"6281234567891","kind":"SERVICE_REMINDER","customer_id":"c2","message":"Servis?"}'`;
    const a='30000000-0000-4000-8000-000000000003',b='30000000-0000-4000-8000-000000000004';
    await sql(`SELECT claim_wa_send('${a}',${rem},'Admin'); SELECT finish_wa_send('${a}','FAILED','Ditolak',NULL)`);
    assert.equal((await value(`SELECT claim_wa_send('${b}',${rem},'Admin') AS v`)).v.claimed,true);
    await sql(`SELECT finish_wa_send('${b}','ACCEPTED',NULL,NULL)`);
    assert.notEqual((await value("SELECT last_rating_request FROM customers WHERE id='c2'")).last_rating_request,null);
    await rejects(`SELECT claim_wa_send(gen_random_uuid(),${rem},'Cron')`,/30 hari/);
  });
  await check('document audit failure rolls back history and keeps the send pending for review',async()=>{
    const id='30000000-0000-4000-8000-000000000005';
    await sql(`SELECT claim_wa_send('${id}','{"phone":"6281234567890","kind":"INVOICE","document_id":"MISSING","message":"Invoice"}','Admin')`);
    await rejects(`SELECT finish_wa_send('${id}','ACCEPTED',NULL,NULL)`,/tidak ditemukan/);
    assert.equal((await value(`SELECT status FROM wa_outbox WHERE id='${id}'`)).status,'SENDING');
    assert.equal((await value(`SELECT count(*)::int AS n FROM wa_messages WHERE id=(SELECT message_id FROM wa_outbox WHERE id='${id}')`)).n,0);
  });
  console.log(`\n${checks} PostgreSQL contract groups passed. No production connection.`);
} finally { await db.close(); }
