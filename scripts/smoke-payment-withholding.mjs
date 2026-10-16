import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const origin = process.env.PAYMENT_PREVIEW_ORIGIN || 'http://127.0.0.1:4192';
const browser = await chromium.launch({ headless: true });
const results = [];
try {
 for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
   const page = await browser.newPage({ viewport }); const errors = [], external = [];
   page.on('pageerror', e => errors.push(e.message));
   await page.route('**/*', route => {
     if (!route.request().url().startsWith(origin + '/')) { external.push(route.request().url()); return route.abort(); }
     if (new URL(route.request().url()).pathname.startsWith('/api/')) { external.push('Forbidden API'); return route.abort(); }
     return route.continue();
   });
   await page.goto(origin + '/preview/payment-withholding/index.html', { waitUntil: 'networkidle' });
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
   await save.click();
   await page.getByRole('status').filter({ hasText: /lunas: kas Rp 2.902.500/ }).waitFor();
   const settled = JSON.parse(await page.getByLabel('Hasil simulasi').innerText());
   assert.deepEqual(settled, { status: 'PAID', kas: 2902500, potonganNonkas: 47500, apiSimulasi: 1, produksiDiubah: false });
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
   results.push({ viewport, adminAcknowledgementsRequired: true, validSettlement: true, grossUpBlocked: true, outOfRangeBlocked: true, missingMigrationVisible: true, runtimeErrors: 0, productionWrites: 0 });
   await page.close();
 }
 console.log(JSON.stringify({ passed: true, results }));
} finally { await browser.close(); }
