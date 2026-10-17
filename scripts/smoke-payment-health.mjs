// Isolated UI scenarios; all external/API requests are forbidden.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const origin = process.env.PAYMENT_PREVIEW_ORIGIN || 'http://127.0.0.1:4192';
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [], forbidden = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith('/api/')) { forbidden.push(url.pathname); return route.abort(); }
      return route.continue();
    });
    await page.goto(`${origin}/preview/payment-health/index.html`, { waitUntil: 'networkidle' });
    const panel = page.getByRole('region', { name: 'Kesehatan bukti pembayaran WA' });
    await panel.getByText('Berhasil · antrean retry kosong', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Tinjau bukti (76)', exact: true }).waitFor();
    assert.match(await panel.innerText(), /0 kegagalan baru dalam 24 jam/);
    await panel.getByRole('button', { name: '▸ Rincian media (11)', exact: true }).click();
    await panel.getByRole('button', { name: 'Gagal otomatis (5)', exact: true }).click();
    assert.equal(await panel.getByRole('article').count(), 5);
    assert.equal(await panel.getByText('Belum ada percobaan worker tercatat', { exact: false }).count(), 5);
    await panel.getByText('Alasan/kendala terakhir', { exact: true }).first().click();
    assert.match(await panel.innerText(), /HTTP 404/);
    assert.doesNotMatch(await panel.innerText(), /3\/3|3 percobaan worker/);
    await panel.getByRole('button', { name: 'Tinjauan admin (6)', exact: true }).click();
    assert.equal(await panel.getByRole('article').count(), 6);
    assert.equal(await panel.getByRole('link', { name: 'Buka media tersimpan ↗', exact: true }).count(), 6);
    assert.match(await panel.innerText(), /Bukan kegagalan retry/);
    await panel.getByRole('button', { name: 'Ke daftar tinjauan', exact: true }).first().click();
    await page.getByRole('status').filter({ hasText: /tidak ada pembayaran diubah/ }).waitFor();
    await panel.getByRole('button', { name: 'Antrean retry (0)', exact: true }).click();
    assert.equal(await panel.getByRole('article').count(), 0);
    await panel.getByText('Tidak ada media pada kategori ini dalam rincian yang dimuat.', { exact: true }).waitFor();
    await panel.getByRole('button', { name: '▾ Tutup rincian media', exact: true }).click();
    await page.screenshot({ path: `/private/tmp/aclean-payment-health-${viewport.width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Retry aktif', exact: true }).click();
    await panel.getByText('Bukti tersedia untuk ditinjau', { exact: true }).waitFor();
    await panel.getByRole('button', { name: '▸ Rincian media (13)', exact: true }).click();
    await panel.getByRole('button', { name: 'Antrean retry (2)', exact: true }).click();
    assert.equal(await panel.getByRole('article').count(), 2);
    assert.match(await panel.innerText(), /Retry paling awal/);
    await page.getByRole('button', { name: 'Pemeriksaan gagal', exact: true }).click();
    await panel.getByText('Pemeriksaan terakhir gagal', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Hasil belum terbaca', exact: true }).click();
    await panel.getByText('Hasil pemeriksaan belum dapat dibaca', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Deteksi nonaktif', exact: true }).click();
    await panel.getByText('Deteksi bukti bayar dimatikan di Pengaturan', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Penerimaan perlu diperiksa', exact: true }).click();
    await panel.getByText('Periksa penerimaan webhook (2)', { exact: true }).click();
    await panel.getByText('Foto/dokumen diterima tanpa URL Fonnte yang aman; file belum dapat diunduh.', { exact: true }).waitFor();
    await panel.getByText('Identitas pengirim belum dapat dipastikan; jangan menebak nomor dari LID.', { exact: true }).waitFor();
    assert.match(await panel.innerText(), /Antrean retry kosong bukan jaminan semua pesan WA sudah diterima/);
    await page.getByRole('button', { name: 'Monitor penerimaan belum tersedia', exact: true }).click();
    await panel.getByText('Status penerimaan webhook belum tersedia; periksa koneksi/migrasi 214', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Antrean kosong', exact: true }).click();
    await page.getByRole('button', { name: 'Simulasi koneksi gagal', exact: true }).click();
    await panel.getByRole('alert').waitFor();
    await panel.getByText('Status terkini belum dapat dipastikan', { exact: true }).waitFor();
    assert.match(await panel.innerText(), /Hasil tersimpan terakhir/);
    await panel.getByRole('button', { name: '↻ Perbarui status', exact: true }).click();
    assert.equal(await panel.getByRole('alert').count(), 0);
    await page.getByRole('status').filter({ hasText: /tidak ada AI atau pembayaran/ }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
    results.push({ viewport, historicalFailures: 5, manualReviews: 6, totalPendingAI: 76, scenarios: 8, ingressReview: true, filtering: true, readOnly: true, runtimeErrors: 0, horizontalOverflow: false });
    await page.close();
  }
  console.log(JSON.stringify({ passed: true, results, aiCalls: 0, productionRequests: 0, paymentWrites: 0 }));
} finally { await browser.close(); }
