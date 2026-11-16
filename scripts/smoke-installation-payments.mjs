// Browser -> real SQL RPCs in isolated PGlite. No credentials or production traffic.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createPaymentWithholdingDb } from './lib/payment-withholding-db.mjs';
const origin = process.env.PAYMENT_PREVIEW_ORIGIN || 'http://127.0.0.1:4193';
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const db = await createPaymentWithholdingDb();
    try {
      // Latest locally captured auth guard, without replaying a production migration.
      const sql = readFileSync(new URL('../migrations/246_fsm_rpc_null_authorization.sql', import.meta.url), 'utf8');
      await db.exec(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.record_invoice_partial_payment_atomic'), sql.indexOf('CREATE OR REPLACE FUNCTION public.update_order_workflow_atomic')));
      await db.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;
        INSERT INTO invoices(id,job_id,customer,phone,service,total,labor,material,status,paid_amount,remaining_amount,materials_detail)
          VALUES('I1','J1','Customer Simulasi','628000000001','Install',2135000,600000,1535000,'UNPAID',0,2135000,'[]');
        INSERT INTO orders VALUES('J1','I1','INVOICE_APPROVED',NULL);
        INSERT INTO payment_suggestions(id,amount,phone,image_url,status,validation_status) VALUES('30000000-0000-4000-8000-000000000001',515000,'628000000001','proof-synthetic','PENDING','PENDING');`);
      let writes = 0, dropResponse = false, failReads = false; const errors = [], external = []; let lastPartial;
      const page = await browser.newPage({ viewport: { width, height: 980 } });
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        if (!route.request().url().startsWith(origin + '/')) { external.push(route.request().url()); return route.abort(); }
        if (new URL(route.request().url()).pathname.startsWith('/api/')) { external.push('API blocked'); return route.abort(); }
        if (new URL(route.request().url()).pathname !== '/__test__/installation') return route.continue();
        const body = route.request().postDataJSON();
        try {
          let data;
          if (body.name) {
            writes++;
            if (body.name === 'record_invoice_partial_payment_atomic') {
              lastPartial = body.args;
              const a = body.args;
              data = (await db.query('SELECT record_invoice_partial_payment_atomic($1,$2,$3,$4,$5,$6,$7) result', [a.p_payment_id,a.p_invoice_id,a.p_amount,a.p_method,a.p_notes,a.p_paid_at,a.p_actor_name])).rows[0].result;
              if (dropResponse) return route.abort('failed');
            } else {
              assert.equal(body.name, 'confirm_invoice_wa_proof_atomic'); const a = body.args;
              data = (await db.query('SELECT confirm_invoice_wa_proof_atomic($1,$2,$3,$4,$5,$6) result', [a.p_request_id,a.p_invoice_id,a.p_suggestion_id,a.p_expected_proof_url,a.p_review_ack,a.p_actor_name])).rows[0].result;
            }
          } else {
            if (failReads && body.table === 'invoices') throw new Error('Simulasi gagal membaca saldo terbaru');
            assert.ok(['invoices','invoice_payments','payment_suggestions'].includes(body.table));
            // Read all synthetic rows and apply the fixture's eq filters only.
            data = (await db.query(`SELECT * FROM ${body.table}`)).rows.filter(row => body.filters.every(([key,value]) => row[key] === value)).slice(body.from,body.to+1);
          }
          return route.fulfill({ json: { data } });
        } catch (error) { return route.fulfill({ json: { error: { message: error.message, code: error.code } } }); }
      });
      await page.goto(origin + '/preview/installation-payments/index.html');
      await page.getByRole('switch', { name: /Pelunasan bertahap/ }).check();
      const region = page.getByRole('region', { name: 'Pembayaran bertahap instalasi' });
      await region.getByText('Belum ada pembayaran tercatat.').waitFor();
      const final = page.getByRole('button', { name: /Verifikasi Bukti Terakhir/ });
      assert.equal(await final.isDisabled(), true);
      assert.equal(await region.getByLabel('Nominal yang benar-benar diterima').inputValue(), '');
      for (const [amount,date,ref] of [['1000000','2026-11-10','DP paket referensi BANK001'],['620000','2026-11-14','Tambahan referensi BANK002']]) {
        await region.getByLabel('Nominal yang benar-benar diterima').fill(amount);
        await region.getByLabel('Tanggal penerimaan terdahulu').fill(date);
        await region.getByLabel(/Referensi transaksi/).fill(ref);
        await region.getByLabel(/Saya sudah memeriksa penerimaan/).check();
        await region.getByRole('button', { name: 'Catat pembayaran terdahulu saja' }).click();
        await region.getByText(new RegExp(ref)).waitFor();
        assert.equal((await db.query("SELECT status FROM invoices WHERE id='I1'")).rows[0].status, 'PARTIAL_PAID');
      }
      await region.getByText(/Sisa tagihan sudah sesuai/).waitFor();
      assert.equal(await final.isDisabled(), true);
      await page.getByLabel(/Saya sudah membuka bukti/).check();
      assert.equal(await final.isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `/private/tmp/aclean-installments-${width}.png`, fullPage: true });
      // Same request is idempotent at the actual SQL boundary.
      const a = lastPartial;
      assert.equal((await db.query('SELECT record_invoice_partial_payment_atomic($1,$2,$3,$4,$5,$6,$7) result', [a.p_payment_id,a.p_invoice_id,a.p_amount,a.p_method,a.p_notes,a.p_paid_at,a.p_actor_name])).rows[0].result.replayed, true);
      await final.click();
      await page.getByRole('status').filter({ hasText: /lunas/ }).waitFor();
      const invoice = (await db.query("SELECT * FROM invoices WHERE id='I1'")).rows[0];
      assert.equal(invoice.status, 'PAID'); assert.equal(Number(invoice.paid_amount), 2135000); assert.equal(Number(invoice.withheld_amount), 0);
      assert.equal(invoice.payment_proof_url, 'proof-synthetic');
      const ledger = (await db.query('SELECT amount FROM invoice_payments ORDER BY amount')).rows.map(r => Number(r.amount));
      assert.deepEqual(ledger, [515000,620000,1000000]);
      assert.equal(Number((await db.query('SELECT amount FROM payment_suggestions')).rows[0].amount),515000);
      assert.equal((await db.query('SELECT status FROM orders')).rows[0].status,'PAID');
      assert.equal(writes,3); assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
      console.log(`PASS ${width}px: two real earlier receipts + final proof, ledger exact, no PPh, idempotent, no overflow/errors/external requests`);

      // Reset synthetic rows only to test failure paths from a fresh browser form.
      await db.exec(`DELETE FROM invoice_payments;
        UPDATE invoices SET status='UNPAID',paid_amount=0,remaining_amount=total,payment_proof_url=NULL WHERE id='I1';
        UPDATE orders SET status='INVOICE_APPROVED';
        UPDATE payment_suggestions SET status='PENDING',validation_status='PENDING',invoice_id=NULL;`);
      failReads = true;
      await page.reload();
      await page.getByRole('switch', { name: /Pelunasan bertahap/ }).check();
      await region.getByRole('alert').filter({ hasText: /gagal membaca saldo/ }).waitFor();
      assert.equal(await final.isDisabled(),true); assert.equal(writes,3);
      failReads = false;
      await page.reload();
      await page.getByRole('switch', { name: /Pelunasan bertahap/ }).check();
      await region.getByText('Belum ada pembayaran tercatat.').waitFor();
      await region.getByLabel('Nominal yang benar-benar diterima').fill('1000000');
      await region.getByLabel('Tanggal penerimaan terdahulu').fill('2026-11-10');
      await region.getByLabel(/Referensi transaksi/).fill('DP paket referensi BANK003');
      await region.getByLabel(/Saya sudah memeriksa penerimaan/).check();
      dropResponse = true;
      await region.getByRole('button', { name: 'Catat pembayaran terdahulu saja' }).click();
      await region.getByRole('alert').filter({ hasText: /Hasil pencatatan belum dapat dipastikan/ }).waitFor();
      assert.equal(await final.isDisabled(),true);
      assert.equal(await region.getByRole('button', { name: /Catat pembayaran terdahulu/ }).count(),0);
      assert.equal(writes,4);
      assert.equal((await db.query('SELECT count(*)::int n FROM invoice_payments')).rows[0].n,1);
      assert.equal((await db.query("SELECT status FROM invoices WHERE id='I1'")).rows[0].status,'PARTIAL_PAID');
      assert.equal((await db.query('SELECT status FROM payment_suggestions')).rows[0].status,'PENDING');
      for (const role of ['Teknisi','Helper','']) {
        await db.query("SELECT set_config('test.role',$1,false)",[role]);
        await assert.rejects(() => db.query("SELECT record_invoice_partial_payment_atomic('40000000-0000-4000-8000-000000000001','I1',100,'cash','unauthorized','2026-11-10','Other')"), /Akses pembayaran ditolak/);
      }
      assert.equal((await db.query('SELECT count(*)::int n FROM invoice_payments')).rows[0].n,1);
      assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
      console.log(`PASS ${width}px: read failures block settlement; lost response stops without replay; unauthorized roles rejected by SQL`);
      await page.close();
    } finally { await db.close(); }
  }
} finally { await browser.close(); }
