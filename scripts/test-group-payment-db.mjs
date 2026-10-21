import assert from 'node:assert/strict';
import { createGroupPaymentDb, groupMigration, groupRpc, seedGroup, ownerId } from './lib/group-payment-db.mjs';
import { createGroupPaymentRequest, handleGroupPayment } from '../src/lib/groupPayment.js';
const db = await createGroupPaymentDb({ apply: false });
let checks=0, counter=100;
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const uid=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
const snapshot=()=>q(`SELECT * FROM (SELECT 'invoice' kind,to_jsonb(i) row FROM invoices i UNION ALL SELECT 'ledger',to_jsonb(p) FROM invoice_payments p
  UNION ALL SELECT 'header',to_jsonb(p) FROM payments p UNION ALL SELECT 'proof',to_jsonb(s) FROM payment_suggestions s
  UNION ALL SELECT 'order',to_jsonb(o) FROM orders o UNION ALL SELECT 'mutation',to_jsonb(m) FROM operational_mutations m) records ORDER BY kind,row::text`);
const rows=suffix=>q('SELECT * FROM invoices WHERE id=ANY($1) ORDER BY id',[['A'+suffix,'B'+suffix]]);
async function request(suffix='',patch={}) {
  const invoices=await rows(suffix);
  return createGroupPaymentRequest({invoices,invoiceIds:invoices.map(i=>i.id),totalReceived:4300000,
    customerPhone:'628000000001',method:'transfer_bca',proofUrl:'proof-'+suffix+'.jpg',reviewAcknowledged:true,
    requestId:uid(counter++),paidAt:'2026-10-21T09:00:00.000Z',...patch});
}
async function rejectedUnchanged(args,pattern) {const before=await snapshot();await assert.rejects(()=>groupRpc(db,args),pattern);assert.deepEqual(await snapshot(),before);}
try {
  await check('migration twice: additive, preserves all existing business records',async()=>{
    await seedGroup(db);const before=await q('SELECT to_jsonb(i) row FROM invoices i ORDER BY id');
    await db.exec(groupMigration());await db.exec(groupMigration());
    assert.deepEqual(await q('SELECT to_jsonb(i) row FROM invoices i ORDER BY id'),before);
    assert.equal((await q('SELECT count(*)::int n FROM invoice_payments'))[0].n,0);
  });
  let original;
  await check('synthetic two-invoice transfer: one header, two ledger entries, exact cash, two PAID orders',async()=>{
    original=await request();const result=await groupRpc(db,original);
    assert.equal(result.payment.amount,4300000);assert.equal(result.invoices.length,2);
    assert.deepEqual(result.invoices.map(i=>i.status),['PAID','PAID']);assert.ok(result.orders.every(o=>o.status==='PAID'));
    const ledger=(await q('SELECT count(*)::int n,sum(amount)::float amount,count(DISTINCT group_payment_id)::int groups FROM invoice_payments'))[0];
    assert.deepEqual(ledger,{n:2,amount:4300000,groups:1});
    assert.equal((await q('SELECT sum(cash_amount)::float cash FROM finance_cash_events'))[0].cash,4300000);
  });
  await check('lost response and concurrent submitted identical requests cannot duplicate cash',async()=>{
    const results=await Promise.all([groupRpc(db,original),groupRpc(db,original)]);assert.ok(results.every(r=>r.replayed));
    assert.equal((await q('SELECT count(*)::int n FROM payments'))[0].n,1);
    await rejectedUnchanged({...original,p_method:'cash'},/ID pembayaran/);
    await rejectedUnchanged({...original,p_request_id:uid(999)},/berubah/);
  });
  await check('real browser helper accepts real SQL response without any fallback writes',async()=>{
    const result=await handleGroupPayment({rpc(name,args){assert.equal(name,'record_group_payment_atomic');return {abortSignal(){return groupRpc(db,args).then(data=>({data,error:null}));}};}},original);
    assert.equal(result.replayed,true);
  });
  await check('oldest-first partial, unallocated invoices untouched and later remainder can settle',async()=>{
    await seedGroup(db,'partial');
    const args=await request('partial',{totalReceived:1000000});const first=await groupRpc(db,args);
    assert.deepEqual(first.payment.allocation_detail,{Apartial:1000000});assert.deepEqual(first.invoices.map(i=>i.status),['PARTIAL_PAID','UNPAID']);
    assert.ok(first.orders.every(o=>o.status==='INVOICE_APPROVED'));
    const next=await groupRpc(db,await request('partial',{totalReceived:3300000,proofUrl:'second-proof.jpg'}));
    assert.ok(next.invoices.every(i=>i.status==='PAID'));assert.ok(next.orders.every(o=>o.status==='PAID'));
    await rejectedUnchanged(args,/saldo terbaru berubah/);
  });
  await check('WA proof linked to the group, not arbitrarily to the first invoice; replay once',async()=>{
    await seedGroup(db,'wa');const proof=uid(700);
    await db.query("INSERT INTO payment_suggestions(id,phone,amount,image_url,status,validation_status) VALUES($1,'628000000002',4300000,'group-wa.jpg','PENDING','PENDING')",[proof]);
    const args=await request('wa',{suggestionId:proof,proofUrl:'group-wa.jpg'});
    const result=await groupRpc(db,args);
    assert.equal(result.suggestion.status,'CONFIRMED');assert.equal(result.suggestion.validation_status,'LINKED');
    assert.equal(result.suggestion.invoice_id,null);assert.equal(result.suggestion.group_payment_id,result.payment.id);
    assert.equal((await groupRpc(db,args)).replayed,true);
  });
  await check('failed final order write rolls back header, ledger, invoices, proof and mutation together',async()=>{
    await seedGroup(db,'fail');const args=await request('fail');
    await db.exec(`CREATE FUNCTION fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='JOB-Bfail' THEN RAISE EXCEPTION 'injected final failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_fail BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fixture_fail();`);
    await rejectedUnchanged(args,/injected final failure/);await db.exec('DROP TRIGGER fixture_fail ON orders');
    assert.equal((await groupRpc(db,args)).replayed,false);
  });
  await check('a legacy trigger rewriting price during status update rolls back rather than committing an inconsistent ledger',async()=>{
    await seedGroup(db,'trigger');const args=await request('trigger');
    await db.exec(`CREATE FUNCTION fixture_reprice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.total:=NEW.total+1; RETURN NEW; END $$;
      CREATE TRIGGER fixture_reprice BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION fixture_reprice();`);
    await rejectedUnchanged(args,/Nilai invoice berubah/);await db.exec('DROP TRIGGER fixture_reprice ON invoices');
  });
  await check('stale amount, missing/duplicate ID, mismatched customer, cancelled job fail without side effects',async()=>{
    await seedGroup(db,'guards');const base=await request('guards');
    await rejectedUnchanged({...base,p_expected:{...base.p_expected,Aguards:{...base.p_expected.Aguards,total:1}}},/berubah/);
    await rejectedUnchanged({...base,p_invoice_ids:['Aguards','Aguards']},/duplikat/);
    await rejectedUnchanged({...base,p_invoice_ids:['Aguards','missing'],p_expected:{Aguards:base.p_expected.Aguards,missing:{}}},/tidak ditemukan/);
    await rejectedUnchanged({...base,p_customer_phone:'628111111111'},/Nomor customer/);
    await db.exec("UPDATE orders SET customer='Different customer' WHERE id='JOB-Aguards'");await rejectedUnchanged(base,/Hubungan customer/);
    await db.exec("UPDATE orders SET customer=NULL WHERE id='JOB-Aguards'");
    await db.exec("UPDATE orders SET status='CANCELLED' WHERE id='JOB-Aguards'");await rejectedUnchanged(base,/dibatalkan/);
  });
  await check('zero, fractional, NaN, infinity, overpay, missing review, future date rejected atomically',async()=>{
    await seedGroup(db,'input');const base=await request('input');
    for (const amount of [0,-1,1.5,'NaN','Infinity',4300001]) await rejectedUnchanged({...base,p_total_received:amount},/Periksa|melebihi/);
    await rejectedUnchanged({...base,p_review_ack:false},/Periksa/);
    await rejectedUnchanged({...base,p_paid_at:'2099-01-01'},/Periksa/);
  });
  await check('used proof, changed WA nominal/URL and inconsistent ledger never settle',async()=>{
    await seedGroup(db,'proof');const base=await request('proof',{proofUrl:'group-wa.jpg'});
    await rejectedUnchanged(base,/sudah digunakan/);
    await rejectedUnchanged({...base,p_suggestion_id:uid(700),p_payment_proof_url:'changed.jpg'},/Bukti/);
    await db.query("INSERT INTO invoice_payments(invoice_id,amount) VALUES('Aproof',100)");
    await rejectedUnchanged({...base,p_payment_proof_url:null},/Ledger/);
  });
  await check('actual auth.uid role: Owner/Admin/Finance allowed; field roles, inactive or missing user denied',async()=>{
    for (const n of [4,5,6,99]) {
      await db.query("SELECT set_config('test.uid',$1,false)",[uid(n)]);
      await assert.rejects(()=>groupRpc(db,original),/Akses/);
    }
    for (const n of [1,2,3]) {
      await db.query("SELECT set_config('test.uid',$1,false)",[uid(n)]);await seedGroup(db,'role'+n);
      const args=await request('role'+n,{proofUrl:null,method:'cash'});
      await db.exec('SET ROLE authenticated');assert.equal((await groupRpc(db,args)).payment.amount,4300000);await db.exec('RESET ROLE');
    }
    await db.query("SELECT set_config('test.uid',$1,false)",[ownerId]);
    await db.exec('SET ROLE anon');await assert.rejects(()=>groupRpc(db,original),/permission denied/);await db.exec('RESET ROLE');
  });
  await check('real RLS: field/inactive users cannot read/change payment headers or suggestions; office reads remain',async()=>{
    for(const n of [4,5,6,99]){
      await db.query("SELECT set_config('test.uid',$1,false)",[uid(n)]);await db.exec('SET ROLE authenticated');
      assert.equal((await q('SELECT count(*)::int n FROM payments'))[0].n,0);
      assert.equal((await q('SELECT count(*)::int n FROM payment_suggestions'))[0].n,0);
      assert.equal((await db.query("UPDATE payment_suggestions SET status='DISMISSED'")).affectedRows,0);
      await db.exec('RESET ROLE');
    }
    for(const n of [1,2,3]){
      await db.query("SELECT set_config('test.uid',$1,false)",[uid(n)]);await db.exec('SET ROLE authenticated');
      assert.ok((await q('SELECT count(*)::int n FROM payments'))[0].n>0);
      assert.ok((await q('SELECT count(*)::int n FROM payment_suggestions'))[0].n>0);
      if(n===3)assert.equal((await db.query('DELETE FROM payments')).affectedRows,0);
      await db.exec('RESET ROLE');
    }
    await db.query("SELECT set_config('test.uid',$1,false)",[ownerId]);
  });
  console.log(JSON.stringify({checks,productionConnections:0,productionWrites:0,realMultiConnectionConcurrencyTest:false}));
} catch(error) {console.error('FAIL',error.code,error.message,error.where||'');process.exitCode=1;}
finally {await db.close();}
