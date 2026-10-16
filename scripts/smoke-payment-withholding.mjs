import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { callBrowserPaymentRpc, createPaymentWithholdingDb, seedBrowserPayment, snapshotMigration } from './lib/payment-withholding-db.mjs';
import { rawInvoice } from '../preview/payment-withholding/fixture.js';
const origin = process.env.PAYMENT_PREVIEW_ORIGIN || 'http://127.0.0.1:4192';
const browser = await chromium.launch({ headless: true });
const results = [];
const databases = new Set();
try {
 for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
   const db = await createPaymentWithholdingDb({ applySnapshotFix: false });
   databases.add(db);
   await seedBrowserPayment(db);
   let lastArgs, sqlRequests = 0;
   const page = await browser.newPage({ viewport }); const errors = [], external = [];
   page.on('pageerror', e => errors.push(e.message));
   await page.route('**/*', async route => {
     if (!route.request().url().startsWith(origin + '/')) { external.push(route.request().url()); return route.abort(); }
     if (new URL(route.request().url()).pathname.startsWith('/api/')) { external.push('Forbidden API'); return route.abort(); }
     if (new URL(route.request().url()).pathname === '/__test__/payment-rpc') {
       const { name, args } = route.request().postDataJSON();assert.equal(name,'confirm_invoice_wa_withholding_atomic');
       sqlRequests++;lastArgs=args;
       try { return route.fulfill({ json: { data: await callBrowserPaymentRpc(db,args) } }); }
       catch (error) { return route.fulfill({ json: { error: { code: error.code, message: error.message } } }); }
     }
     return route.continue();
   });
   await page.goto(origin + '/preview/payment-withholding/index.html?database=isolated', { waitUntil: 'networkidle' });
   await page.getByRole('region', { name: 'Pemeriksaan potongan PPh' }).waitFor();
   const save = page.getByRole('button', { name: /Catat Transfer \+ Potongan & Lunas/ });
   assert.equal(await save.isDisabled(), true);
   await page.getByLabel(/Saya sudah memeriksa file dan memastikan pengirim/).check();
   assert.equal(await save.isDisabled(), true);
   await page.getByLabel(/Saya konfirmasi selisih/).check();
   assert.equal(await save.isDisabled(), true);
   await page.getByLabel(/Catatan pemeriksaan/).fill('Finance membayar setelah potongan PPh; bukti potong menyusul.');
   assert.equal(await save.isEnabled(), true);
   assert.match(await page.getByRole('region', { name: 'Pemeriksaan potongan PPh' }).innerText(), /2,021%/);
   assert.equal(await page.getByLabel('Tanggal transfer').inputValue(), '2026-10-15');
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
   await page.screenshot({ path: `/private/tmp/aclean-pph-review-${viewport.width}.png`, fullPage: true });
   // First reproduce the exact browser->SQL failure with the deployed 212 RPC.
   await save.click();await page.getByRole('status').filter({ hasText: /Invoice berubah sejak pratinjau/ }).waitFor();
   assert.equal(Array.isArray(lastArgs.p_expected_invoice.materials_detail),true);
   assert.equal(lastArgs.p_expected_invoice.materials_detail.length,6);
   assert.equal((await db.query('SELECT count(*)::int n FROM invoice_payments')).rows[0].n,0);
   // Install 213 in the isolated database, then ensure a REAL item change is
   // still blocked. The same form/request must succeed only after it matches.
   await db.exec(snapshotMigration());
   const edited=JSON.parse(rawInvoice.materials_detail);edited[0].jumlah=2;
   await db.query('UPDATE invoices SET materials_detail=$1 WHERE id=$2',[JSON.stringify(edited),rawInvoice.id]);
   await save.click();await page.waitForFunction(() => JSON.parse(document.querySelector('[aria-label="Hasil simulasi"]').textContent).apiSimulasi===2);
   await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b=>b.textContent.includes('Catat Transfer + Potongan')&&!b.disabled));
   assert.equal((await db.query('SELECT count(*)::int n FROM invoice_payments')).rows[0].n,0);
   await db.query('UPDATE invoices SET materials_detail=$1 WHERE id=$2',[rawInvoice.materials_detail,rawInvoice.id]);
   await save.click();
   await page.getByRole('status').filter({ hasText: /lunas: kas Rp 2.902.500/ }).waitFor();
   const settled = JSON.parse(await page.getByLabel('Hasil simulasi').innerText());
   assert.deepEqual(settled, { status: 'PAID', kas: 2902500, potonganNonkas: 47500, apiSimulasi: 3, produksiDiubah: false });
   assert.equal((await callBrowserPaymentRpc(db,lastArgs)).replayed,true);
   const ledger=(await db.query('SELECT count(*)::int n,sum(amount)::float cash,sum(withheld_amount)::float noncash FROM invoice_payments')).rows[0];
   assert.deepEqual(ledger,{n:1,cash:2902500,noncash:47500});
   assert.equal((await db.query('SELECT sum(cash_amount)::float cash FROM finance_cash_events')).rows[0].cash,2902500);
   await page.getByRole('button', { name: 'Uji selisih di luar toleransi' }).click();
   await page.getByRole('alert').filter({ hasText: /di luar toleransi/ }).waitFor();
   assert.equal(await save.isDisabled(), true);
   await page.getByRole('button', { name: 'Batal', exact: true }).click();
   await page.getByRole('button', { name: 'Uji invoice gross-up' }).click();
   await page.getByRole('alert').filter({ hasText: /gross-up/ }).waitFor();
   assert.equal(await save.isDisabled(), true);
   await page.getByRole('button', { name: 'Batal', exact: true }).click();
   await page.getByRole('button', { name: 'Reset simulasi' }).click();
   await page.getByRole('button', { name: 'Batal', exact: true }).click();
   await page.getByRole('button', { name: 'Uji migrasi belum terpasang' }).click();
   await page.getByLabel(/Saya sudah memeriksa file dan memastikan pengirim/).check();
   await page.getByLabel(/Saya konfirmasi selisih/).check();
   await page.getByLabel(/Catatan pemeriksaan/).fill('Verifikasi perusahaan dan potongan PPh oleh admin');
   await save.click(); await page.getByRole('status').filter({ hasText: /Migrasi 212 belum terpasang/ }).waitFor();
   assert.equal(JSON.parse(await page.getByLabel('Hasil simulasi').innerText()).status, 'UNPAID');
   assert.deepEqual(errors, []); assert.deepEqual(external, []);
   assert.equal(sqlRequests,3);
   results.push({ viewport, realBrowserToPostgresRpc: true, sixParsedItems: true, originalBugReproduced: true, realItemChangesBlocked: true, validSettlement: true, retriesCreateNoSecondPayment: true, grossUpBlocked: true, outOfRangeBlocked: true, missingMigrationVisible: true, runtimeErrors: 0, productionWrites: 0 });
   await page.close();
   await db.close();
   databases.delete(db);
 }
 console.log(JSON.stringify({ passed: true, results }));
} catch (error) { console.error('FAIL', error.message, error.detail || ''); process.exitCode=1; }
finally { await browser.close(); for (const db of databases) await db.close(); }
