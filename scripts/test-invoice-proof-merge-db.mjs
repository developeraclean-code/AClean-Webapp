// PostgreSQL/WASM contract tests only: never reads .env or production data.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
let tests = 0;
const check = async (label, fn) => { await fn(); tests++; console.log('PASS', label); };
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await rows(sql, args))[0];
const rpc = async (name, args) => (await one(`SELECT ${name}(${args.map((_, n) => '$' + (n + 1)).join(',')}) result`, args)).result;
const snap = async ids => (await rows('SELECT to_jsonb(i) value FROM invoices i WHERE id=ANY($1) ORDER BY id', [ids])).map(r => r.value);
const money = () => one(`SELECT (SELECT coalesce(sum(amount),0) FROM invoice_payments)::float cash,(SELECT count(*) FROM invoice_payments)::int payments`);
const newInv = (id, amount, phone = '6281213125126') => ({ id, phone, customer: 'Ibu Mike', units: 2, labor: amount, material: 0, discount: 0, total: amount, materials_detail: '[]' });
const merge = async (ids, id, amount, snapshot = null, phone) => rpc('consolidate_invoices_atomic', [JSON.stringify(snapshot || await snap(ids)), JSON.stringify(newInv(id, amount, phone)), 'Owner']);
const proofId = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const requestId = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const confirm = (invoice, proof, n, url = 'proof-a.jpg', ack = false) => rpc('confirm_invoice_wa_proof_atomic', [requestId(n), invoice, proof, url, ack, 'Owner']);
async function seed(id, total, extra = '') {
  await db.query(`INSERT INTO invoices(id,customer,phone,total,labor,material,discount,status,paid_amount,remaining_amount,service,units,job_id,materials_detail)
    VALUES($1,'Ibu Mike','6281213125126',$2::bigint,$2::bigint,0,0,'UNPAID',0,$2::bigint,'Repair',1,'J-'||$1,'[]')`, [id, total]);
  await db.query(`INSERT INTO orders(id,invoice_id,status) VALUES('J-'||$1,$1,'INVOICE_APPROVED')`, [id]);
  if (extra) await db.exec(extra);
}
async function proof(n, invoice = null, amount = 300, url = 'proof-a.jpg') {
  await db.query(`INSERT INTO payment_suggestions(id,phone,amount,image_url,invoice_id,status,validation_status) VALUES($1,'6281213125126',$2,$3,$4,'PENDING','PENDING')`, [proofId(n), amount, url, invoice]);
}
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'authenticated'::text $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
    SET test.role='Owner';
    CREATE TABLE user_profiles(id uuid,name text);
    CREATE TABLE customers(phone text,last_service date);
    CREATE TABLE invoices(id text PRIMARY KEY,customer text,phone text,service text,job_id text,units int,labor bigint,material bigint,discount bigint,total bigint,status text,due date,teknisi text,materials_detail text,sent boolean,
      paid_amount numeric,remaining_amount numeric,paid_at timestamptz,paid_method text,paid_notes text,payment_proof_url text,last_changed_by text,
      pdf_url text,pdf_generated_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),pph23 boolean DEFAULT false,trade_in_amount numeric DEFAULT 0,unit_ac_amount bigint DEFAULT 0,quotation_id text,invoice_type text);
    CREATE TABLE orders(id text PRIMARY KEY,invoice_id text,status text,last_changed_by text);
    CREATE TABLE invoice_payments(id uuid PRIMARY KEY,invoice_id text REFERENCES invoices(id),amount numeric CHECK(amount>0),method text,notes text,paid_at date,recorded_by text,recorded_by_name text);
    CREATE TABLE operational_mutations(mutation_key text PRIMARY KEY,operation text,actor_id uuid,actor_name text,result jsonb DEFAULT '{}',completed_at timestamptz);
    CREATE TABLE payment_suggestions(id uuid PRIMARY KEY,phone text,amount numeric,image_url text,invoice_id text,status text,validation_status text DEFAULT 'PENDING',order_id text,matched_at timestamptz,match_source text,resolved_at timestamptz,resolved_by text,created_at timestamptz DEFAULT now());`);
  await db.exec(`CREATE TABLE wa_payment_receipts(id uuid PRIMARY KEY,suggestion_id uuid UNIQUE,payload jsonb,result jsonb,actor text);
    ALTER TABLE user_profiles ADD COLUMN role text;`);
  await db.exec(readFileSync(new URL('../migrations/173_invoice_payment_idempotency.sql',import.meta.url),'utf8'));
  const workflow = readFileSync(new URL('../migrations/177_atomic_invoice_report_order_workflows.sql', import.meta.url), 'utf8');
  await db.exec(workflow.slice(workflow.indexOf('CREATE OR REPLACE FUNCTION public.settle_invoice_atomic'), workflow.indexOf('CREATE OR REPLACE FUNCTION public.submit_service_report_atomic')));
  await seed('LEG-A',100); await seed('LEG-B',200); await seed('LEG-C',300);
  await db.exec(`UPDATE invoices SET status='CANCELLED',service='Repair [Digabung ke LEG-C]',payment_proof_url='legacy.jpg' WHERE id IN ('LEG-A','LEG-B');`);
  await proof(1,'LEG-A',300,'legacy.jpg');
  await db.query(`UPDATE payment_suggestions SET status='CONFIRMED',resolved_by='retro-match' WHERE id=$1`, [proofId(1)]);
  await seed('CASH-A',100);await seed('CASH-C',100);
  await db.exec("UPDATE invoices SET status='CANCELLED',service='Repair [Digabung ke CASH-C]',payment_proof_url='cash-used.jpg' WHERE id='CASH-A'");
  await proof(50,'CASH-A',100,'cash-used.jpg');
  await db.query("UPDATE payment_suggestions SET status='CONFIRMED',resolved_by='retro-match' WHERE id=$1",[proofId(50)]);
  await db.query("INSERT INTO invoice_payments(id,invoice_id,amount) VALUES($1,'CASH-A',100)",[requestId(50)]);
  const migration = readFileSync(new URL('../migrations/206_invoice_merge_payment_review.sql', import.meta.url), 'utf8');
  const before = await money();
  await check('migration repairs stranded legacy proof and both job links without cash changes', async () => {
    await db.exec(migration);
    assert.deepEqual(await one('SELECT status,validation_status,invoice_id FROM payment_suggestions WHERE id=$1',[proofId(1)]),{status:'PENDING',validation_status:'PENDING',invoice_id:'LEG-C'});
    assert.equal((await one("SELECT count(*)::int n FROM orders WHERE id IN ('J-LEG-A','J-LEG-B') AND invoice_id='LEG-C'")).n,2);
    assert.deepEqual(await money(),before);
    assert.equal((await one("SELECT payment_proof_url FROM invoices WHERE id='LEG-C'")).payment_proof_url,null);
    assert.equal((await one('SELECT status FROM payment_suggestions WHERE id=$1',[proofId(50)])).status,'CONFIRMED');
  });
  await check('migration is idempotent and null/anonymous/technician roles fail closed', async () => {
    await db.exec(migration);
    for (const role of ['', 'Teknisi', 'Helper']) {
      await db.query("SELECT set_config('test.role',$1,false)",[role]);
      await assert.rejects(() => merge(['LEG-A','LEG-B'],'INV-20261015-NO',300),/Akses/);
      await assert.rejects(() => rpc('link_payment_suggestion_for_review',['LEG-C',proofId(1)]),/Akses/);
      await assert.rejects(() => confirm('LEG-C',proofId(1),1,'legacy.jpg'),/Akses/);
    }
    await db.exec("SET test.role='Owner'");
  });
  await check('retro-match remains pending, never attaches a proof or records payment', async () => {
    const result = await rpc('link_payment_suggestion_for_review',['LEG-C',proofId(1)]);
    assert.equal(result.suggestion.status,'PENDING'); assert.equal(result.suggestion.validation_status,'PENDING');
    assert.equal((await one("SELECT payment_proof_url FROM invoices WHERE id='LEG-C'")).payment_proof_url,null);
    assert.deepEqual(await money(),before);
  });
  await check('admin confirmation settles invoice, proof, ledger and all merged jobs once', async () => {
    const result = await confirm('LEG-C',proofId(1),1,'legacy.jpg');
    assert.equal(result.invoice.status,'PAID'); assert.equal(result.suggestion.validation_status,'LINKED');
    assert.equal((await money()).cash,400);
    assert.equal((await one("SELECT count(*)::int n FROM orders WHERE invoice_id='LEG-C' AND status='PAID'")).n,3);
    await confirm('LEG-C',proofId(1),1,'legacy.jpg'); await confirm('LEG-C',proofId(1),2,'legacy.jpg');
    assert.equal((await money()).payments,2);
  });
  await seed('A',100); await seed('B',200); await proof(2,'A');
  await check('merge is atomic and duplicate/different-tab requests replay same invoice', async () => {
    const snapshot = await snap(['A','B']);
    const result = await merge(['A','B'],'INV-20261015-MERGED',300,snapshot);
    assert.equal(result.invoice.payment_proof_url,null); assert.equal(result.invoice.status,'UNPAID');
    assert.equal(result.suggestions[0].status,'PENDING'); assert.equal(result.suggestions[0].invoice_id,result.invoice.id);
    const retry = await merge(['A','B'],'INV-20261015-ANOTHER',300,snapshot);
    assert.equal(retry.replayed,true); assert.equal(retry.invoice.id,result.invoice.id);
    assert.equal((await one("SELECT count(*)::int n FROM invoices WHERE id IN ('INV-20261015-MERGED','INV-20261015-ANOTHER')")).n,1);
  });
  await check('late webhook and pending proof updates resolve cancelled source -> current invoice', async () => {
    await proof(3,'A',300,'late.jpg');
    assert.equal((await one('SELECT invoice_id FROM payment_suggestions WHERE id=$1',[proofId(3)])).invoice_id,'INV-20261015-MERGED');
    await db.query("UPDATE payment_suggestions SET status='CONFIRMED',validation_status='PENDING',resolved_by='retro-match' WHERE id=$1",[proofId(3)]);
    assert.equal((await one('SELECT status FROM payment_suggestions WHERE id=$1',[proofId(3)])).status,'PENDING');
    await db.query('UPDATE payment_suggestions SET invoice_id=$1 WHERE id=$2',['B',proofId(3)]);
    assert.equal((await one('SELECT invoice_id FROM payment_suggestions WHERE id=$1',[proofId(3)])).invoice_id,'INV-20261015-MERGED');
  });
  await seed('STALE-A',10); await seed('STALE-B',20);
  await check('stale source, missing source, and financial mismatch abort without partial writes', async () => {
    const snapshot=await snap(['STALE-A','STALE-B']);
    await db.exec("UPDATE invoices SET total=11 WHERE id='STALE-A'");
    await assert.rejects(()=>merge(['STALE-A','STALE-B'],'INV-20261015-STALE',30,snapshot),/berubah/);
    await assert.rejects(()=>merge(['STALE-A','STALE-B'],'INV-20261015-STALE',31),/tidak sesuai/);
    const current=await snap(['STALE-A','STALE-B']);
    await assert.rejects(()=>merge(['STALE-A','STALE-B'],'INV-20261015-MISSING',30,[current[0],{...current[1],id:'MISSING'}]),/tidak lengkap/);
    assert.equal((await one("SELECT status FROM invoices WHERE id='STALE-B'")).status,'UNPAID');
    assert.equal((await one("SELECT count(*)::int n FROM invoices WHERE id LIKE 'INV-20261015-STALE%'")).n,0);
  });
  await check('PAID, partial, ledger-only cash, quotation, PPh and verified proof cannot lose money through merge', async () => {
    await seed('GUARD-A',100); await seed('GUARD-B',200);
    const statements=["status=NULL","status='PAID'","status='PARTIAL_PAID',paid_amount=10","quotation_id='Q1'","pph23=true","unit_ac_amount=100","trade_in_amount=50"];
    for (const change of statements) {
      await db.exec('BEGIN');await db.exec(`UPDATE invoices SET ${change} WHERE id='GUARD-A'`);
      await assert.rejects(()=>merge(['GUARD-A','GUARD-B'],'INV-20261015-GUARD',300));await db.exec('ROLLBACK');
    }
    await db.query("INSERT INTO invoice_payments(id,invoice_id,amount) VALUES($1,'GUARD-A',1)",[requestId(99)]);
    await assert.rejects(()=>merge(['GUARD-A','GUARD-B'],'INV-20261015-GUARD',300),/lunas\/cicilan\/DP/);
  });
  await check('failure after creating target/cancelling first source rolls entire merge back', async () => {
    await seed('FAIL-A',100);await seed('FAIL-B',200);
    await db.exec(`CREATE FUNCTION fail_cancel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='FAIL-B' AND NEW.status='CANCELLED' THEN RAISE EXCEPTION 'simulated cancel failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_cancel BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION fail_cancel();`);
    await assert.rejects(()=>merge(['FAIL-A','FAIL-B'],'INV-20261015-FAIL',300),/simulated/);
    assert.equal((await one("SELECT count(*)::int n FROM invoices WHERE id='INV-20261015-FAIL'")).n,0);
    assert.equal((await one("SELECT status FROM invoices WHERE id='FAIL-A'")).status,'UNPAID');
    await db.exec('DROP TRIGGER fail_cancel ON invoices');
  });
  await check('rejected/stale/wrong-amount proof cannot create a payment; duplicate media cannot pay another invoice', async () => {
    await proof(4,'INV-20261015-MERGED',299,'short.jpg');
    const cash=await money();
    await assert.rejects(()=>confirm('INV-20261015-MERGED',proofId(4),4,'short.jpg'),/Nominal/);
    await assert.rejects(()=>confirm('INV-20261015-MERGED',proofId(2),5,'changed.jpg'),/Bukti berubah/);
    await db.query("UPDATE payment_suggestions SET status='DISMISSED',validation_status='REJECTED' WHERE id=$1",[proofId(4)]);
    await assert.rejects(()=>confirm('INV-20261015-MERGED',proofId(4),4,'short.jpg',true),/ditinjau/);
    await proof(5,'INV-20261015-MERGED',300,'legacy.jpg');
    await assert.rejects(()=>confirm('INV-20261015-MERGED',proofId(5),5,'legacy.jpg'),/sudah digunakan/);
    assert.deepEqual(await money(),cash);
  });
  await check('failure resolving suggestion rolls invoice + ledger + jobs back too', async () => {
    await seed('PAYFAIL',100);await proof(6,'PAYFAIL',100,'failpay.jpg');
    await db.exec(`CREATE FUNCTION fail_resolve() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.image_url='failpay.jpg' AND NEW.status='CONFIRMED' THEN RAISE EXCEPTION 'simulated proof failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_resolve BEFORE UPDATE ON payment_suggestions FOR EACH ROW EXECUTE FUNCTION fail_resolve();`);
    const cash=await money();await assert.rejects(()=>confirm('PAYFAIL',proofId(6),6,'failpay.jpg'),/simulated/);
    assert.equal((await one("SELECT status FROM invoices WHERE id='PAYFAIL'")).status,'UNPAID');assert.deepEqual(await money(),cash);
    assert.equal((await one("SELECT status FROM orders WHERE id='J-PAYFAIL'")).status,'INVOICE_APPROVED');
    await db.exec('DROP TRIGGER fail_resolve ON payment_suggestions');
    await db.exec("UPDATE orders SET status='CANCELLED' WHERE id='J-PAYFAIL'");
    await assert.rejects(()=>confirm('PAYFAIL',proofId(6),6,'failpay.jpg'),/Job terkait dibatalkan/);
    assert.deepEqual(await money(),cash);
  });
  await check('already PAID invoice receives proof without another cash entry', async () => {
    await seed('ALREADY',100);await db.exec("UPDATE invoices SET status='PAID',paid_amount=100 WHERE id='ALREADY'");
    await proof(7,'ALREADY',100,'already.jpg');const cash=await money();
    assert.equal((await confirm('ALREADY',proofId(7),7,'already.jpg')).attach_only,true);
    assert.deepEqual(await money(),cash);
  });
  await check('provisional photo left by an old browser still requires explicit confirmation and creates cash only once',async()=>{
    await seed('PROVISIONAL',100);await proof(53,'PROVISIONAL',100,'provisional.jpg');
    await db.exec("UPDATE invoices SET payment_proof_url='provisional.jpg' WHERE id='PROVISIONAL'");
    const cash=await money();await confirm('PROVISIONAL',proofId(53),53,'provisional.jpg');
    await confirm('PROVISIONAL',proofId(53),53,'provisional.jpg');
    assert.equal((await money()).cash,cash.cash+100);
  });
  await check('CANCELLED sources with real cash cannot have their proof consumed again',async()=>{
    await proof(51,'CASH-C',100,'cash-used.jpg');
    const cash=await money();
    await assert.rejects(()=>confirm('CASH-C',proofId(51),51,'cash-used.jpg'),/sudah digunakan/);
    await assert.rejects(()=>rpc('apply_wa_payment',[requestId(52),proofId(51),JSON.stringify([{invoice_id:'CASH-C',amount:100}]),100,'transfer','']),/sudah digunakan/);
    assert.deepEqual(await money(),cash);
  });
  await check('nested merges route late proofs to final ID and cyclic markers fail visibly', async () => {
    await seed('NESTED',100);
    await merge(['INV-20261015-MERGED','NESTED'],'INV-20261015-NESTED',400);
    await proof(8,'A',400,'nested.jpg');
    assert.equal((await one('SELECT invoice_id FROM payment_suggestions WHERE id=$1',[proofId(8)])).invoice_id,'INV-20261015-NESTED');
    await db.exec("INSERT INTO invoices(id,status,service) VALUES('CYCLE1','CANCELLED','X [Digabung ke CYCLE2]'),('CYCLE2','CANCELLED','X [Digabung ke CYCLE1]')");
    await assert.rejects(()=>proof(9,'CYCLE1',10,'cycle.jpg'),/berulang/);
  });
  await check('Workspace allocation also accepts cancelled-source history, confirms validation and updates all jobs once', async () => {
    await db.exec("UPDATE invoices SET payment_proof_url='proof-a.jpg' WHERE id='A'");
    const result=await rpc('apply_wa_payment',[requestId(10),proofId(2),JSON.stringify([{invoice_id:'INV-20261015-NESTED',amount:300}]),300,'transfer','']);
    assert.equal(result[0].status,'PARTIAL_PAID');
    assert.equal((await one('SELECT validation_status FROM payment_suggestions WHERE id=$1',[proofId(2)])).validation_status,'LINKED');
    const cash=await money();
    await rpc('apply_wa_payment',[requestId(10),proofId(2),JSON.stringify([{invoice_id:'INV-20261015-NESTED',amount:300}]),300,'transfer','']);
    assert.deepEqual(await money(),cash);
    await proof(10,'INV-20261015-NESTED',100,'proof-a.jpg');
    await assert.rejects(()=>rpc('apply_wa_payment',[requestId(11),proofId(10),JSON.stringify([{invoice_id:'INV-20261015-NESTED',amount:100}]),100,'transfer','Payment correction']),/Bukti ini sudah digunakan/);
  });
  await check('200 jobs / 100 merged invoices preserve 200 source amounts and candidates; retries create no extra invoice or ledger', async () => {
    const cash=await money();
    for(let n=0;n<100;n++){
      const a=`SIM-${n}-A`,b=`SIM-${n}-B`,id=`INV-20261015-SIM${n}`;
      await seed(a,100+n);await seed(b,200+n);await proof(100+n,a,300+2*n,`sim-${n}.jpg`);
      const result=await merge([a,b],id,300+2*n);assert.equal(result.orders.length,2);
      const retry=await merge([a,b],`INV-20261015-RETRY${n}`,300+2*n);assert.equal(retry.invoice.id,id);
    }
    assert.equal((await one("SELECT count(*)::int n FROM orders WHERE invoice_id LIKE 'INV-20261015-SIM%'")).n,200);
    assert.equal((await one("SELECT count(*)::int n FROM payment_suggestions WHERE invoice_id LIKE 'INV-20261015-SIM%' AND status='PENDING'")).n,100);
    assert.deepEqual(await money(),cash);
  });
  console.log(`PASS ${tests} PostgreSQL contract groups, including 200-job simulation`);
} catch (error) { console.error('FAIL', error.message, error.where || ''); process.exitCode=1; }
finally { await db.close(); }
