import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const origin=process.env.PAYMENT_PREVIEW_ORIGIN||'http://127.0.0.1:4192';
const browser=await chromium.launch({headless:true});
const results=[];
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const page=await browser.newPage({viewport});const errors=[],external=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(!request.url().startsWith(origin+'/')){external.push(url.origin);return route.abort();}
   if(url.pathname.startsWith('/api/')){
    if(url.pathname!=='/api/payment-media-health'||request.method()!=='GET'){writes.push(url.pathname);return route.abort();}
    return route.fulfill({json:{enabled:true,last_worker_at:new Date().toISOString(),waiting:1,unsecured:0,overdue:1,failed:5,review:250,
     incidents:[{id:'FAILED',sender_name:'Customer arsip contoh',phone:'628000000000',status:'FAILED_PERMANENT',attempts:3,last_error:'URL sumber 404; file belum pernah disimpan',created_at:new Date().toISOString()},
      {id:'WAIT',sender_name:'Customer retry contoh',phone:'628000000001',status:'FAILED_RETRYABLE',r2_url:'/demo-proof',attempts:1,created_at:new Date().toISOString()}]}});
   }
   return route.continue();
  });
  await page.goto(origin+'/preview/payment-inbox/index.html',{waitUntil:'networkidle'});
  await page.getByRole('status').filter({hasText:/250 suggestion/}).waitFor();
  await page.getByRole('button',{name:/Periksa 2 media/}).click();
  await page.getByText('File belum diamankan · periksa WA/kirim ulang',{exact:true}).waitFor();
  assert.match(await page.locator('body').innerText(),/Media aman · pemrosesan\/retry tertunda/);
  await page.getByRole('button',{name:'Simulasikan bukti baru'}).click();
  await page.getByRole('status').filter({hasText:/251 suggestion · 1 notifikasi/}).waitFor();
  await page.getByRole('button',{name:'Periksa di Invoice',exact:true}).click();
  await page.getByText('Navigasi review saja: tidak ada pembayaran diubah',{exact:true}).waitFor();
  await page.getByRole('button',{name:'↻ Perbarui',exact:true}).click();
  await page.waitForTimeout(100);assert.match(await page.getByRole('status').innerText(),/251 suggestion · 1 notifikasi/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Horizontal overflow');
  await page.screenshot({path:`/private/tmp/aclean-payment-inbox-${viewport.width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Buka Invoice asli (simulasi)',exact:true}).click();
  const actual=page.getByRole('region',{name:'Invoice asli simulasi'});
  await actual.getByRole('button',{name:'🤖 Pending AI (251)',exact:true}).click();
  await actual.getByRole('button',{name:'✕ Reject',exact:true}).first().waitFor();
  assert.equal(await actual.getByRole('button',{name:'✕ Reject',exact:true}).count(),251);
  await page.getByRole('button',{name:'Buka Invoice asli (simulasi)',exact:true}).click();
  await page.getByRole('button',{name:'Simulasikan semua selesai'}).click();
  await page.getByRole('status').filter({hasText:/0 suggestion/}).waitFor();
  await page.getByRole('button',{name:'Uji role teknisi'}).click();
  assert.equal(await page.getByRole('region',{name:'Kesehatan bukti pembayaran WA'}).count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);
  results.push({viewport,pendingRows:250,actualInvoiceRows:251,notificationsDeduplicated:true,bannerReadOnly:true,resolvedRowsCleared:true,technicianBlocked:true,horizontalOverflow:false,runtimeErrors:0,productionRequests:0});
  await page.close();
 }
 console.log(JSON.stringify({passed:true,cases:results,aiCalls:0,whatsAppSends:0,productionWrites:0}));
}finally{await browser.close();}
