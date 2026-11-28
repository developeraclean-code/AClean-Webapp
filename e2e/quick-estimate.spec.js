import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const out = '/private/tmp/aclean-estimate-qa';
const failures = new WeakMap();
test.beforeEach(async ({page}) => {
  failures.set(page, []);
  page.on('pageerror', error => failures.get(page).push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api')) { failures.get(page).push('Unexpected request: '+url.origin+url.pathname); return route.abort(); }
    return route.continue();
  });
  await page.goto('/preview/quick-estimate/');
});
test.afterEach(async({page})=>{ expect(failures.get(page)).toEqual([]); });
async function open(page) { await page.getByRole('button',{name:'⚡ Estimasi Cepat',exact:true}).click(); }
async function add(page, name, qty, price) {
  await page.getByRole('button',{name:'＋ Tambah Sparepart',exact:true}).click();
  const field = page.locator('input[placeholder="Contoh: Kapasitor 35 µF merek ..."]').last();
  await field.fill(name);
  const row=field.locator('xpath=../..');
  await row.getByLabel('Jumlah',{exact:true}).fill(String(qty));
  await row.getByLabel('Harga satuan (Rp)',{exact:true}).fill(String(price));
}
async function download(page, format, filename) {
  const [file] = await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:`⬇ Unduh ${format}`,exact:true}).click()]);
  await mkdir(out,{recursive:true});
  await file.saveAs(`${out}/${filename}`);
  const data=await readFile(`${out}/${filename}`);
  expect(data.length).toBeGreaterThan(1000);
  if (format === 'JPEG') {
    const width = await page.evaluate(async data => { const img = new Image(); img.src = 'data:image/jpeg;base64,' + data; await img.decode(); return img.naturalWidth; }, data.toString('base64'));
    expect(width).toBe(1800);
  }
  expect(data.subarray(0,format==='PDF'?5:2).toString('hex')).toBe(format==='PDF'?'255044462d':'ffd8');
}
test('role guard allows Owner/Admin and revokes access immediately',async({page})=>{
  await open(page);
  for(const role of ['Finance','Teknisi','Supervisor','']) {
    await page.getByLabel('Role simulasi').selectOption(role);
    await expect(page.getByRole('button',{name:'⚡ Estimasi Cepat',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Sparepart',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Jasa Lain',exact:true})).toHaveCount(0);
  }
  await page.getByLabel('Role simulasi').selectOption('Admin');
  await expect(page.getByRole('button',{name:'Sparepart',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Jasa Lain',exact:true})).toBeVisible();
});
test('install defaults, cable auto/manual, multi-type and real downloads',async({page}, info)=>{
  await open(page);
  await expect(page.locator('table')).toContainText('400.000');
  await expect(page.getByText('Rp 1.395.000',{exact:true})).toBeVisible();
  await page.getByLabel('Panjang pipa / unit (m)').fill('6');
  await expect(page.getByLabel('Panjang kabel / unit (m)')).toHaveValue('7');
  await page.getByLabel('Panjang kabel / unit (m)').fill('10');
  await page.getByLabel('Panjang pipa / unit (m)').fill('5');
  await expect(page.getByLabel('Panjang kabel / unit (m)')).toHaveValue('10');
  await page.getByRole('button',{name:'Atur otomatis'}).click();
  await expect(page.getByLabel('Panjang kabel / unit (m)')).toHaveValue('6');
  await page.getByRole('button',{name:'＋ Tambah Tipe AC'}).click();
  await expect(page.getByLabel('Ukuran AC (PK)')).toHaveCount(2);
  await page.getByRole('button',{name:'Reset estimasi'}).click();
  await page.getByLabel('Nama customer',{exact:true}).fill('SIMULASI Instalasi');
  await download(page,'PDF',`${info.project.name}-install.pdf`);
  await download(page,'JPEG',`${info.project.name}-install.jpg`);
});
test('pipe manual subtotal, invalid export, mode isolation, reset',async({page},info)=>{
  await open(page);
  await page.getByRole('button',{name:'Ganti Instalasi Pipa',exact:true}).click();
  await expect(page.getByText('Rp 960.000',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'＋ Tambah Item Manual',exact:true}).click();
  await expect(page.getByRole('button',{name:'⬇ Unduh PDF',exact:true})).toBeDisabled();
  await page.getByLabel('Nama item 1',{exact:true}).fill('Pipa drain manual');
  const row=page.getByLabel('Nama item 1',{exact:true}).locator('xpath=../..');
  await row.getByLabel('Jumlah',{exact:true}).fill('2.5');
  await row.getByLabel('Harga satuan (Rp)',{exact:true}).fill('30000');
  await expect(page.getByText('Rp 1.035.000',{exact:true})).toBeVisible();
  await download(page,'PDF',`${info.project.name}-pipe.pdf`);
  await download(page,'JPEG',`${info.project.name}-pipe.jpg`);
  await page.getByRole('button',{name:'Sparepart',exact:true}).click();
  await expect(page.locator('table tbody tr')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'⬇ Unduh JPEG',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Ganti Instalasi Pipa',exact:true}).click();
  await expect(page.getByLabel('Nama item 1',{exact:true})).toHaveValue('Pipa drain manual');
  await page.getByRole('button',{name:'Hapus item 1',exact:true}).click();
  await expect(page.getByText('Rp 960.000',{exact:true})).toBeVisible();
});
test('sparepart final documents, manual terms, zero price and long document',async({page},info)=>{
  await open(page);
  await page.getByRole('button',{name:'Sparepart',exact:true}).click();
  await page.getByLabel('Nama customer',{exact:true}).fill('SIMULASI PT Pelanggan & Rekan');
  await add(page,'Kapasitor 35 µF',2,125000);
  await add(page,'Motor fan',1,450000);
  await page.getByLabel('Ketentuan & catatan (opsional)').fill('Garansi sesuai persetujuan tertulis.\nHarga berlaku 7 hari.');
  await expect(page.getByText('Rp 700.000',{exact:true})).toBeVisible();
  await expect(page.getByText('Garansi pekerjaan instalasi:',{exact:false})).toHaveCount(0);
  await download(page,'PDF',`${info.project.name}-sparepart.pdf`);
  await download(page,'JPEG',`${info.project.name}-sparepart.jpg`);
  await add(page,'Bonus sparepart',1,0);
  await expect(page.getByText('Rp 700.000',{exact:true})).toBeVisible();
  for(let i=4;i<=30;i++) await add(page,`Item ${i} - ${'Spesifikasi sparepart panjang '.repeat(5)}`,1,10000);
  await expect(page.getByText('Rp 970.000',{exact:true})).toBeVisible();
  await download(page,'PDF',`${info.project.name}-long.pdf`);
  await download(page,'JPEG',`${info.project.name}-long.jpg`);
  await page.screenshot({path:`${out}/${info.project.name}-long-screen.png`,fullPage:true});
  await page.getByRole('button',{name:'Reset estimasi'}).click();
  await page.getByRole('button',{name:'Sparepart',exact:true}).click();
  await expect(page.locator('table tbody tr')).toHaveCount(0);
  await expect(page.getByLabel('Ketentuan & catatan (opsional)')).toHaveValue('');
});
test('jasa lain ducting uses manual pricing, own terms, exports and reset',async({page},info)=>{
  await open(page);
  await page.getByRole('button',{name:'Jasa Lain',exact:true}).click();
  await expect(page.getByRole('button',{name:'⬇ Unduh PDF',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'⬇ Unduh JPEG',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'＋ Tambah Jasa Lain',exact:true}).click();
  await expect(page.getByRole('button',{name:'⬇ Unduh PDF',exact:true})).toBeDisabled();
  await page.getByLabel('Nama item 1',{exact:true}).fill('Ducting galvanis');
  const row=page.getByLabel('Nama item 1',{exact:true}).locator('xpath=../..');
  await row.getByLabel('Jumlah',{exact:true}).fill('2.5');
  await row.getByLabel('Satuan',{exact:true}).fill('m');
  await row.getByLabel('Harga satuan (Rp)',{exact:true}).fill('120000');
  await page.getByLabel('Ketentuan & catatan (opsional)').fill('Harga berlaku 14 hari.\nPengerjaan setelah survei.');
  await expect(page.getByRole('cell',{name:'Rp 300.000',exact:true})).toBeVisible();
  await expect(page.locator('section[aria-label="Penawaran Jasa Lain"]')).toBeVisible();
  await expect(page.getByText('TOTAL PENAWARAN',{exact:true})).toBeVisible();
  await download(page,'PDF',`${info.project.name}-jasa-lain.pdf`);
  await download(page,'JPEG',`${info.project.name}-jasa-lain.jpg`);
  await page.getByRole('button',{name:'Sparepart',exact:true}).click();
  await expect(page.locator('table tbody tr')).toHaveCount(0);
  await expect(page.getByLabel('Ketentuan & catatan (opsional)')).toHaveValue('');
  await page.getByRole('button',{name:'Jasa Lain',exact:true}).click();
  await expect(page.getByLabel('Nama item 1',{exact:true})).toHaveValue('Ducting galvanis');
  await expect(page.getByLabel('Ketentuan & catatan (opsional)')).toHaveValue('Harga berlaku 14 hari.\nPengerjaan setelah survei.');
  await page.getByRole('button',{name:'Reset estimasi'}).click();
  await page.getByRole('button',{name:'Jasa Lain',exact:true}).click();
  await expect(page.locator('table tbody tr')).toHaveCount(0);
  await expect(page.getByLabel('Ketentuan & catatan (opsional)')).toHaveValue('');
});

test('large AC and concurrent freon options match public calculation',async({page})=>{
  await open(page);
  await page.getByLabel('Ukuran AC (PK)').selectOption('2.5');
  await expect(page.getByText('Rp 1.855.000',{exact:true})).toBeVisible();
  await page.getByLabel('Penambahan Freon · Rp 1.000.000',{exact:true}).check();
  await page.getByLabel('Kuras Vacum Freon · Rp 1.150.000',{exact:true}).check();
  await expect(page.getByText('Rp 4.005.000',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Bongkar Pasang AC',exact:true}).click();
  await expect(page.getByText('Rp 4.155.000',{exact:true})).toBeVisible();
});
test('mobile pipe controls stay in viewport; negative manual values block exports',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Ganti Instalasi Pipa',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'Sparepart',exact:true}).click();
  await add(page,'Simulasi invalid',1,-1);
  await expect(page.getByRole('button',{name:'⬇ Unduh PDF',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'⬇ Unduh JPEG',exact:true})).toBeDisabled();
});
