// Synthetic PGlite check of the production SQL contract. No live credentials.
import assert from 'node:assert/strict';
import { withholdingSnapshot } from '../src/lib/paymentWithholding.js';
import { createPaymentWithholdingDb } from './lib/payment-withholding-db.mjs';

const db = await createPaymentWithholdingDb({ applyCombinedTransfer: true });
const id = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
async function seed(n, transfer = 8574000) {
  await db.query(`INSERT INTO invoices(id,job_id,customer,phone,total,labor,material,status,paid_amount,remaining_amount,materials_detail)
    VALUES($1,$2,'Customer AC','628000000001',3456000,700000,2756000,'UNPAID',0,3456000,'[]')`, ['I'+n, 'J'+n]);
  await db.query("INSERT INTO orders(id,invoice_id,status) VALUES($1,$2,'INVOICE_APPROVED')", ['J'+n, 'I'+n]);
  await db.query(`INSERT INTO payment_suggestions(id,phone,sender_name,amount,image_url,status,validation_status)
    VALUES($1,'628000000001','Customer AC',$2,$3,'PENDING','PENDING')`, [id(n), transfer, 'proof-'+n+'.jpg']);
}
async function confirm(n, overrides = {}) {
  const inv = (await one('SELECT to_jsonb(i) value FROM invoices i WHERE id=$1', ['I'+n])).value;
  const a = { request: id(n+1000), invoice: 'I'+n, suggestion: id(n), proof: 'proof-'+n+'.jpg',
    snapshot: withholdingSnapshot(inv), date: '2026-11-04', note: 'AC unit and installation verified against customer sale', ack: true, ...overrides };
  return (await one('SELECT confirm_invoice_wa_combined_transfer_atomic($1,$2,$3,$4,$5,$6,$7,$8) result',
    [a.request, a.invoice, a.suggestion, a.proof, JSON.stringify(a.snapshot), a.date, a.note, a.ack])).result;
}
try {
  await seed(1);
  const before = withholdingSnapshot((await one("SELECT to_jsonb(i) value FROM invoices i WHERE id='I1'")).value);
  const result = await confirm(1);
  assert.equal(result.invoice.status, 'PAID');
  assert.equal(Number(result.invoice.paid_amount), 3456000);
  assert.equal(Number(result.payment.amount), 3456000);
  assert.equal(Number(result.payment.withheld_amount), 0);
  assert.equal(Number(result.payment.combined_transfer_detail.transfer_amount), 8574000);
  assert.equal(Number(result.payment.combined_transfer_detail.unallocated_amount), 5118000);
  assert.equal(result.suggestion.match_source, 'manual_combined_transfer');
  assert.equal(result.orders[0].status, 'PAID');
  assert.equal(Number((await one("SELECT sum(cash_amount) amount FROM finance_cash_events WHERE id='I1'")).amount), 3456000);
  assert.equal((await confirm(1, { snapshot: before })).replayed, true);
  assert.equal(Number((await one("SELECT count(*) n FROM invoice_payments WHERE invoice_id='I1'")).n), 1);
  await assert.rejects(() => confirm(1, { request: id(9999) }), /sudah diproses/);
  await assert.rejects(() => db.query("UPDATE invoices SET paid_amount=0,status='UNPAID' WHERE id='I1'"), /dikunci/);
  await assert.rejects(() => db.query("DELETE FROM invoice_payments WHERE invoice_id='I1'"), /tidak boleh/);
  await db.exec("SET app.combined_transfer_write='allowed'");
  await assert.rejects(() => db.query("UPDATE invoice_payments SET amount=1 WHERE invoice_id='I1'"), /tidak boleh/);
  await assert.rejects(() => db.query("UPDATE invoices SET paid_amount=0,status='UNPAID' WHERE id='I1'"), /dikunci/);
  await db.exec("RESET app.combined_transfer_write");
  await seed(2, 3455999);
  await assert.rejects(() => confirm(2), /melebihi/);
  assert.equal((await one("SELECT status FROM invoices WHERE id='I2'")).status, 'UNPAID');
  await seed(3);
  const stale = withholdingSnapshot((await one("SELECT to_jsonb(i) value FROM invoices i WHERE id='I3'")).value);
  await db.query("UPDATE invoices SET total=3456001 WHERE id='I3'");
  await assert.rejects(() => confirm(3, { snapshot: stale }), /berubah/);
  assert.equal((await one("SELECT count(*) n FROM invoice_payments WHERE invoice_id='I3'")).n, 0);
  await db.exec("SET test.role='Finance'");
  await assert.rejects(() => confirm(3), /Akses/);
  assert.equal((await one("SELECT has_function_privilege('anon','confirm_invoice_wa_combined_transfer_atomic(uuid,text,uuid,text,jsonb,date,text,boolean)','EXECUTE') ok")).ok, false);
  console.log('PASS combined transfer SQL: allocation, replay, locks, underpayment, stale invoice and role');
} finally { await db.close(); }
