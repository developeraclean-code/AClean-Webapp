// Isolated PostgreSQL/WASM. Synthetic fixtures only; no .env, API, WA or live writes.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { withholdingSnapshot } from '../src/lib/paymentWithholding.js';
const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite(); let passed = 0;
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const inv = async n => (await one('SELECT to_jsonb(i) value FROM invoices i WHERE id=$1', ['I'+n])).value;
async function seed(n, { cash = 2902500, paid = 0, deduction = 0, grossUp = false } = {}) {
 await db.query(`INSERT INTO invoices(id,customer,phone,total,labor,material,discount,status,paid_amount,remaining_amount,pph23,pph23_amount,job_id,materials_detail)
 VALUES($1,'Company example','628000000001',2950000,2350000,600000,0,$2,$3::numeric,2950000-$3::numeric,$4,$5,$6,'[]')`,
 ['I'+n, paid ? 'PARTIAL_PAID' : 'UNPAID', paid, grossUp, deduction, 'J'+n]);
 await db.query("INSERT INTO orders(id,invoice_id,status) VALUES($1,$2,'INVOICE_APPROVED')", ['J'+n, 'I'+n]);
 await db.query(`INSERT INTO payment_suggestions(id,phone,sender_name,amount,image_url,status,validation_status)
 VALUES($1,'628000000002','Finance example',$2,$3,'PENDING','PENDING')`, [id(n), cash, 'proof-'+n+'.jpg']);
 if (paid) await db.query("INSERT INTO invoice_payments(id,invoice_id,amount,method,paid_at) VALUES($1,$2,$3,'transfer','2026-10-12')", [id(n+10000), 'I'+n, paid]);
}
async function confirm(n, overrides = {}) {
 const args = { request: id(n+1000), invoice: 'I'+n, suggestion: id(n), url: 'proof-'+n+'.jpg', snapshot: withholdingSnapshot(await inv(n)), date: '2026-10-15', note: 'Reviewed finance payment; tax slip pending', ack: true, ...overrides };
 return (await one('SELECT confirm_invoice_wa_withholding_atomic($1,$2,$3,$4,$5,$6,$7,$8) result',
 [args.request, args.invoice, args.suggestion, args.url, JSON.stringify(args.snapshot), args.date, args.note, args.ack])).result;
}
const snapshot = async () => (await q(`SELECT * FROM (SELECT 'invoice' kind,to_jsonb(i) value FROM invoices i UNION ALL SELECT 'payment',to_jsonb(p) FROM invoice_payments p UNION ALL SELECT 'proof',to_jsonb(s) FROM payment_suggestions s UNION ALL SELECT 'order',to_jsonb(o) FROM orders o) snapshots ORDER BY kind,value::text`));
try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'authenticated'::text $$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
 CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
 SET test.role='Owner'; CREATE TABLE user_profiles(id uuid,name text,role text); CREATE TABLE customers(phone text,last_service date);
 CREATE TABLE invoices(id text PRIMARY KEY,customer text,phone text,service text,job_id text,units int,labor bigint,material bigint,discount bigint,total bigint,status text,due date,teknisi text,materials_detail text,sent boolean,
 paid_amount numeric,remaining_amount numeric,paid_at timestamptz,paid_method text,paid_notes text,payment_proof_url text,last_changed_by text,pdf_url text,pdf_generated_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
 pph23 boolean DEFAULT false,pph23_amount numeric DEFAULT 0,trade_in_amount numeric DEFAULT 0,unit_ac_amount bigint DEFAULT 0,quotation_id text,invoice_type text);
 CREATE TABLE orders(id text PRIMARY KEY,invoice_id text,status text,last_changed_by text);
 CREATE TABLE invoice_payments(id uuid PRIMARY KEY,invoice_id text REFERENCES invoices(id),amount numeric CHECK(amount>0),method text,notes text,paid_at date,recorded_by text,recorded_by_name text,created_at timestamptz DEFAULT now(),quotation_payment_id uuid);
 CREATE TABLE operational_mutations(mutation_key text PRIMARY KEY,operation text,actor_id uuid,actor_name text,result jsonb DEFAULT '{}',completed_at timestamptz);
 CREATE TABLE payment_suggestions(id uuid PRIMARY KEY,phone text,sender_name text,amount numeric,image_url text,invoice_id text,status text,validation_status text DEFAULT 'PENDING',order_id text,matched_at timestamptz,match_source text,resolved_at timestamptz,resolved_by text,created_at timestamptz DEFAULT now());
 CREATE TABLE wa_payment_receipts(id uuid PRIMARY KEY,suggestion_id uuid UNIQUE,payload jsonb,result jsonb,actor text);
 CREATE TABLE quotations(id text PRIMARY KEY,job_id text,customer text,total bigint);
 CREATE TABLE quotation_payments(id uuid PRIMARY KEY,quotation_id text,amount numeric,paid_at date,created_at timestamptz);`);
 await db.exec(readFileSync(new URL('../migrations/173_invoice_payment_idempotency.sql',import.meta.url),'utf8'));
 const workflow=readFileSync(new URL('../migrations/177_atomic_invoice_report_order_workflows.sql',import.meta.url),'utf8');
 await db.exec(workflow.slice(workflow.indexOf('CREATE OR REPLACE FUNCTION public.settle_invoice_atomic'),workflow.indexOf('CREATE OR REPLACE FUNCTION public.submit_service_report_atomic')));
 await db.exec(readFileSync(new URL('../migrations/206_invoice_merge_payment_review.sql',import.meta.url),'utf8'));
 const migration=readFileSync(new URL('../migrations/212_reviewed_payment_withholding.sql',import.meta.url),'utf8');
 await seed(1);
 await check('migration is idempotent and never approves historical invoices or proofs', async () => {
   const before=await inv(1); await db.exec(migration); await db.exec(migration);
   const after=await inv(1); delete after.withheld_amount; assert.deepEqual(after,before);
   assert.equal((await one('SELECT count(*)::int n FROM invoice_payments')).n,0);
   assert.equal((await one('SELECT status FROM payment_suggestions')).status,'PENDING');
 });
 const firstSnapshot=withholdingSnapshot(await inv(1));
 await check('PT ONE 3 scenario: finance phone, 2.021% deduction, cash not inflated, jobs and proof atomic', async () => {
   const result=await confirm(1); assert.equal(result.invoice.status,'PAID'); assert.equal(result.invoice.total,2950000);
   assert.equal(result.invoice.pph23,false); assert.equal(result.invoice.withheld_amount,47500);
   assert.equal(result.payment.amount,2902500); assert.equal(result.payment.withheld_amount,47500);
   assert.equal(result.payment.withholding_detail.tax_slip_verified,false);
   assert.equal(result.suggestion.match_source,'manual_withholding'); assert.equal(result.suggestion.validation_status,'LINKED');
   assert.equal(result.orders[0].status,'PAID'); assert.equal(result.invoice.phone,'628000000001');
   assert.equal((await one("SELECT sum(cash_amount)::float cash FROM finance_cash_events WHERE id='I1'")).cash,2902500);
 });
 await check('lost response replay returns once; changed payload or new ID cannot consume proof twice', async () => {
   assert.equal((await confirm(1,{snapshot:firstSnapshot})).replayed,true);
   await assert.rejects(()=>confirm(1,{snapshot:firstSnapshot,note:'Different explanation'}),/ID pembayaran/);
   await assert.rejects(()=>confirm(1,{request:id(9999)}),/sudah diproses/);
   assert.equal((await one("SELECT count(*)::int n FROM invoice_payments WHERE invoice_id='I1'")).n,1);
 });
 await check('role and EXECUTE grants fail closed', async () => {
   await seed(2);
   for(const role of ['', 'Teknisi','Helper']) { await db.query("SELECT set_config('test.role',$1,false)",[role]); await assert.rejects(()=>confirm(2),/Akses/); }
   await db.exec("SET test.role='Admin'"); assert.equal((await confirm(2)).invoice.status,'PAID'); await db.exec("SET test.role='Owner'");
   const fn='confirm_invoice_wa_withholding_atomic(uuid,text,uuid,text,jsonb,date,text,boolean)';
   assert.equal((await one("SELECT has_function_privilege('anon',$1,'EXECUTE') ok",[fn])).ok,false);
   assert.equal((await one("SELECT has_function_privilege('authenticated',$1,'EXECUTE') ok",[fn])).ok,true);
 });
 await check('out-of-range, manual ack, notes and dates fail without partial writes', async () => {
   await seed(3,{cash:2800000}); const before=await snapshot(); await assert.rejects(()=>confirm(3),/toleransi/); assert.deepEqual(await snapshot(),before);
   await seed(4);
   for(const patch of [{ack:false},{note:'short'},{date:'2099-01-01'},{date:null}]) await assert.rejects(()=>confirm(4,patch),/Periksa/);
   assert.equal((await inv(4)).status,'UNPAID');
 });
 await check('stale price, changed proof, already grossed-up and cancelled job are blocked', async () => {
   await seed(5);const stale=withholdingSnapshot(await inv(5)); await db.exec("UPDATE invoices SET labor=2340000 WHERE id='I5'");
   await assert.rejects(()=>confirm(5,{snapshot:stale}),/berubah/);await assert.rejects(()=>confirm(5,{url:'changed.jpg'}),/Bukti berubah/);
   await seed(6,{grossUp:true});await assert.rejects(()=>confirm(6),/gross-up/);
   await seed(7,{deduction:47000});await assert.rejects(()=>confirm(7),/gross-up/);
   await seed(8);await db.exec("UPDATE orders SET status='CANCELLED' WHERE id='J8'");await assert.rejects(()=>confirm(8),/dibatalkan/);
 });
 await check('2% and 3% accepted, one rupiah outside either bound rejected', async () => {
   for(const [n,deduction] of [[10,47000],[11,70500],[12,46999],[13,70501]]){
     await seed(n,{cash:2950000-deduction});
     if(n<12) assert.equal((await confirm(n)).invoice.status,'PAID'); else await assert.rejects(()=>confirm(n),/toleransi/);
   }
 });
 await check('DP and legacy cash fallback are preserved without counting tax as cash', async () => {
   await seed(14,{paid:1000000,cash:1902500});await confirm(14);
   assert.equal((await one("SELECT sum(cash_amount)::float cash FROM finance_cash_events WHERE id='I14'")).cash,2902500);
   await seed(15,{paid:1000000,cash:1902500});await db.exec("DELETE FROM invoice_payments WHERE invoice_id='I15'");await confirm(15);
   assert.equal((await one("SELECT sum(cash_amount)::float cash FROM finance_cash_events WHERE id='I15'")).cash,2902500);
 });
 await check('legacy full/exact proof still works after adding tax credit columns', async () => {
   await seed(16,{cash:2950000});
   const result=(await one('SELECT confirm_invoice_wa_proof_atomic($1,$2,$3,$4,true,NULL) result',[id(1016),'I16',id(16),'proof-16.jpg'])).result;
   assert.equal(result.invoice.status,'PAID');assert.equal(result.invoice.withheld_amount,0);
   assert.equal((await one("SELECT sum(cash_amount)::float cash FROM finance_cash_events WHERE id='I16'")).cash,2950000);
 });
 await check('a true quotation DP is counted on its receipt date once, never again as tax or final cash', async () => {
   await db.exec(`ALTER TABLE quotations ADD COLUMN invoice_id text; ALTER TABLE quotations ADD COLUMN updated_at timestamptz;
     ALTER TABLE quotation_payments ADD COLUMN applied_amount numeric DEFAULT 0,ADD COLUMN applied_invoice_id text,ADD COLUMN method text,ADD COLUMN notes text,ADD COLUMN reference text,ADD COLUMN recorded_by text,ADD COLUMN recorded_by_name text,ADD COLUMN applied_at timestamptz,ADD COLUMN updated_at timestamptz;
     ALTER TABLE invoice_payments ALTER COLUMN id SET DEFAULT gen_random_uuid();`);
   const deposit=readFileSync(new URL('../migrations/190_quotation_deposit_ledger.sql',import.meta.url),'utf8');
   await db.exec(deposit.slice(deposit.indexOf('CREATE OR REPLACE FUNCTION public.apply_quotation_payments_to_invoice('),deposit.indexOf('CREATE OR REPLACE FUNCTION public.record_quotation_deposit_atomic(')));
   await db.exec(deposit.slice(deposit.indexOf('CREATE OR REPLACE FUNCTION public.apply_invoice_quotation_deposit_trigger()'),deposit.indexOf('-- Unified cash source:')));
   await seed(21,{paid:1000000,cash:1902500});
   await db.query("INSERT INTO quotations(id,job_id,customer,total,invoice_id) VALUES('Q21','J21','Company example',2950000,'I21')");
   await db.query("INSERT INTO quotation_payments(id,quotation_id,amount,paid_at,created_at,applied_amount,applied_invoice_id) VALUES($1,'Q21',1000000,'2026-10-12',now(),1000000,'I21')",[id(21000)]);
   await db.query("UPDATE invoice_payments SET quotation_payment_id=$1 WHERE invoice_id='I21'",[id(21000)]);
   await db.exec("UPDATE invoices SET quotation_id='Q21' WHERE id='I21'");
   await confirm(21);
   assert.equal((await inv(21)).status,'PAID');assert.equal((await inv(21)).paid_amount,2950000);
   assert.equal((await one("SELECT sum(cash_amount)::float cash FROM finance_cash_events WHERE id='I21'")).cash,1902500);
   assert.equal((await one("SELECT sum(cash_amount)::float cash FROM finance_cash_events WHERE id LIKE 'DP-%'")).cash,1000000);
   const settled=await inv(21);await db.exec("SELECT apply_quotation_payments_to_invoice('Q21','I21')");assert.deepEqual(await inv(21),settled);
 });
 await check('duplicate media / different invoice / ledger-only prior cash never reused', async () => {
   await seed(17);await db.exec("UPDATE payment_suggestions SET image_url='proof-1.jpg' WHERE id='"+id(17)+"'");
   await assert.rejects(()=>confirm(17,{url:'proof-1.jpg'}),/sudah digunakan/);
   await seed(18);await db.query("UPDATE payment_suggestions SET invoice_id='I4' WHERE id=$1",[id(18)]);await assert.rejects(()=>confirm(18),/invoice lain/);
   await seed(19);await db.query("INSERT INTO invoice_payments(id,invoice_id,amount) VALUES($1,'I19',10)",[id(2019)]);await assert.rejects(()=>confirm(19),/tidak sesuai ledger/);
 });
 await check('failure during proof update rolls back cash, tax credit, invoice and all jobs', async () => {
   await seed(20);const before=await snapshot();
   await db.exec(`CREATE FUNCTION fail_proof_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${id(20)}'::uuid AND NEW.status='CONFIRMED' THEN RAISE EXCEPTION 'simulated write failure'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER fail_proof_test BEFORE UPDATE ON payment_suggestions FOR EACH ROW EXECUTE FUNCTION fail_proof_test();`);
   await assert.rejects(()=>confirm(20),/simulated/);assert.deepEqual(await snapshot(),before);await db.exec('DROP TRIGGER fail_proof_test ON payment_suggestions');
 });
 await check('legacy revert, ledger edit/delete and direct tax writes fail visibly instead of corrupting credit', async () => {
   for(const sql of ["UPDATE invoices SET status='UNPAID',paid_amount=0 WHERE id='I1'","UPDATE invoices SET total=3000000 WHERE id='I1'","DELETE FROM invoices WHERE id='I1'","DELETE FROM invoice_payments WHERE invoice_id='I1'","UPDATE invoice_payments SET amount=2950000 WHERE invoice_id='I1'","UPDATE invoices SET withheld_amount=1 WHERE id='I4'"])
     await assert.rejects(()=>db.exec(sql),/PPh/);
   await db.exec("UPDATE invoices SET pdf_url='new.pdf',pdf_generated_at=now(),last_changed_by='Owner' WHERE id='I1'");
 });
 await check('200 finance payments settle exactly once with separate cash and noncash totals', async () => {
   for(let n=100;n<300;n++)await seed(n);
   const results=await Promise.all(Array.from({length:200},(_,i)=>confirm(i+100)));
   assert.equal(results.filter(r=>r.invoice.status==='PAID').length,200);
   assert.equal((await one("SELECT count(*)::int n,sum(amount)::float cash,sum(withheld_amount)::float tax FROM invoice_payments WHERE invoice_id IN(SELECT 'I'||generate_series(100,299))")).n,200);
   const cash=await one("SELECT sum(cash_amount)::float cash FROM finance_cash_events WHERE id IN(SELECT 'I'||generate_series(100,299))");assert.equal(cash.cash,200*2902500);
 });
 console.log(JSON.stringify({passed,syntheticPayments:200,productionWrites:0,aiCalls:0,whatsAppSends:0}));
} catch (error) { console.error('FAIL', error.message, error.detail || '', error.where || ''); process.exitCode=1; }
finally {await db.close();}
