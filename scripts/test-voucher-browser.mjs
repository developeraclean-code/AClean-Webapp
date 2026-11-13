// Browser -> real API handlers -> actual migration/RPCs on disposable PostgreSQL/WASM.
// All people, tokens and invoices are fictional; no .env is read.
import assert from 'node:assert/strict';import{readFile,writeFile,mkdir}from'node:fs/promises';import{createServer}from'node:http';import{fileURLToPath}from'node:url';
import{build}from'esbuild';import{chromium,expect}from'@playwright/test';import{PGlite}from'@electric-sql/pglite';
import{voucherFixture,seed,owner}from'./test-voucher-db.mjs';
process.env.SUPABASE_URL='https://voucher-db.invalid';process.env.SUPABASE_SERVICE_KEY='fixture-only';
const api=await import('../api/_handlers/voucher.js');
const result=[];let db,scenario,dropResponse=false,apiFailure=false,requests=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 if(!String(url).startsWith('https://voucher-db.invalid/'))throw new Error('External network forbidden');
 const u=new URL(url),table=u.pathname.split('/').at(-1),args=options.body?JSON.parse(options.body):{};
 try{
  let data;
  if(u.pathname.includes('/rpc/')){
   const entries=Object.entries(args);data=(await db.query(`SELECT public.${table}(${entries.map(([key],i)=>`${key} => $${i+1}`).join(',')}) AS r`,entries.map(([,value])=>typeof value==='object'?JSON.stringify(value):value))).rows[0].r;
  }else if(table==='user_profiles')data=(await db.query('SELECT id,name,role,active FROM user_profiles WHERE id=$1',[u.searchParams.get('id').slice(3)])).rows;
  else if(table==='invoices')data=(await db.query('SELECT * FROM invoices WHERE id=$1',[u.searchParams.get('id').slice(3)])).rows;
  else throw new Error('Unimplemented fixture route');
  return new Response(JSON.stringify(data),{status:200});
 }catch(e){return new Response(JSON.stringify({code:e.code||'FIXTURE_ERROR',message:e.message}),{status:400});}
};
const bundle=(await build({entryPoints:[fileURLToPath(new URL('./fixtures/voucher-modal.jsx',import.meta.url))],bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}})).outputFiles[0].text;
const invoiceSource=await readFile(new URL('../src/views/InvoiceView.jsx',import.meta.url),'utf8');
const adminFn=invoiceSource.slice(invoiceSource.indexOf('function VoucherAdminTab('),invoiceSource.indexOf('\nexport default memo(InvoiceView)'));
const adminState=invoiceSource.slice(invoiceSource.indexOf('const [voucherList,'),invoiceSource.indexOf('const [quoPDFData'));
const adminFixture=`import React,{useState,useRef,useEffect}from'react';import{createRoot}from'react-dom/client';import{cs}from'./src/theme/cs.js';import{getLocalDate as localDateWIB}from'./src/lib/dateTime.js';${adminFn}\nfunction Fixture(){const apiHeaders=async()=>({'Content-Type':'application/json'});${adminState}\nuseEffect(()=>{loadVouchers()},[]);return <VoucherAdminTab {...{voucherList,voucherStats,voucherFilter,setVoucherFilter,voucherSearch,setVoucherSearch,voucherLoading,voucherError,voucherPage,loadVouchers,apiHeaders,showNotif:()=>{},fmt:String}}/>;}createRoot(document.getElementById('root')).render(<Fixture/>);`;
const adminBundle=(await build({stdin:{contents:adminFixture,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}})).outputFiles[0].text;
let initial;
const server=createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(scenario==='admin'?adminBundle:bundle);return;}
 if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(`<html><body><div id="root"></div><script>window.fixture=${JSON.stringify(initial)};</script><script src="/bundle.js"></script></body></html>`);return;}
 if(!u.pathname.startsWith('/api/')){res.statusCode=404;res.end();return;}
 try{
  let body='';for await(const chunk of req)body+=chunk;req.body=body?JSON.parse(body):{};req.appClaims={userId:owner,role:'Owner'};req.query=Object.fromEntries(u.searchParams);requests.push({path:u.pathname,body:req.body});
  res.status=n=>{res.statusCode=n;return res;};res.json=data=>{if(dropResponse&&u.pathname==='/api/apply-invoice-voucher'){dropResponse=false;res.statusCode=200;res.setHeader('Content-Type','application/json');res.end('{');return res;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return res;};
  if(scenario==='code-change' && u.pathname==='/api/validate-voucher')await new Promise(resolve=>setTimeout(resolve,400));
  if(apiFailure){res.status(503).json({error:'Fixture dependency outage'});return;}
  const handler={'/api/validate-voucher':api.validateVoucher,'/api/apply-invoice-voucher':api.applyInvoiceVoucher,'/api/admin-vouchers':api.adminVouchers,'/api/cancel-voucher':api.cancelVoucher}[u.pathname];if(!handler)throw new Error('Unexpected route');await handler(req,res);
 }catch(e){if(!res.writableEnded){res.statusCode=500;res.end(JSON.stringify({error:'Fixture HTTP failure'}));}}
});
const browser=await chromium.launch({headless:true});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
 for(scenario of ['preview-close','percent-save','free-unit','manual-best','rollback','uncertain-retry','stale-preview','code-change','admin']){
  db=new PGlite();await voucherFixture(db);await seed(db,'A','ACL-FIXTURE',scenario==='free-unit'?'free_unit':'discount_pct',scenario==='free-unit'?1:10);
  if(scenario==='admin')await db.exec("INSERT INTO customer_vouchers(phone,code,type,value)SELECT '6281234567890','ACL-PAGE-'||lpad(n::text,3,'0'),'discount_pct',5 FROM generate_series(1,110)n");
  requests=[];apiFailure=false;dropResponse=false;
  const inv=(await db.query("SELECT * FROM invoices WHERE id='A'")).rows[0];initial={invoice:inv,form:{discount:scenario==='manual-best'?30000:0},items:[{nama:'Material',jumlah:1,harga_satuan:50000,subtotal:50000,keterangan:'barang'}],jasa:[{nama:'Cleaning AC',jumlah:2,harga_satuan:100000,subtotal:200000,keterangan:'jasa'}]};
  const context=await browser.newContext({viewport:{width:420,height:900}}),page=await context.newPage();let errors=0;page.on('pageerror',()=>errors++);await page.goto(url);
  if(scenario==='admin'){
   await expect(page.getByText('1–50 dari 111')).toBeVisible();await page.getByRole('button',{name:'Berikutnya'}).click();await expect(page.getByText('51–100 dari 111')).toBeVisible();
   apiFailure=true;await page.getByRole('button',{name:'Cari',exact:true}).click();await expect(page.getByRole('alert')).toContainText('belum berhasil');apiFailure=false;await page.getByRole('button',{name:'Coba lagi',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);
   await page.getByPlaceholder('Cari kode / phone / nama...').fill('ACL-PAGE-001');await page.getByRole('button',{name:'Cari',exact:true}).click();await expect(page.getByText('1–1 dari 1')).toBeVisible();page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Batalkan',exact:true}).click();await expect.poll(async()=>Number((await db.query("SELECT count(*) n FROM customer_vouchers WHERE code='ACL-PAGE-001' AND is_valid=false")).rows[0].n)).toBe(1);
  }else{
   await page.getByPlaceholder('Kode voucher (cth: ACL-K3M9P2)').fill('ACL-FIXTURE');await page.getByRole('button',{name:'Cek',exact:true}).click();
   if(scenario==='code-change'){
    await page.getByPlaceholder('Kode voucher (cth: ACL-K3M9P2)').fill('ACL-OTHER');await page.waitForTimeout(700);await expect(page.getByRole('button',{name:'Terapkan Voucher',exact:true})).toHaveCount(0);assert.equal((await db.query('SELECT claimed_at FROM customer_vouchers')).rows[0].claimed_at,null);
   }else if(scenario==='manual-best'){
    await expect(page.getByText(/Voucher tidak menambah potongan;/)).toBeVisible();assert.equal((await db.query('SELECT count(*)::int n FROM voucher_redemptions')).rows[0].n,0);
   }else{
    await page.getByRole('button',{name:'Terapkan Voucher',exact:true}).click();assert.equal((await db.query('SELECT claimed_at FROM customer_vouchers')).rows[0].claimed_at,null);
    if(scenario==='preview-close'){await page.getByRole('button',{name:'Batal',exact:true}).click();assert.equal((await db.query('SELECT claimed_at FROM customer_vouchers')).rows[0].claimed_at,null);}
    else if(scenario==='stale-preview'){
     // Changing any invoice field invalidates the preview before a save can claim it.
     await page.getByPlaceholder('Alasan perubahan nilai...').fill('Fixture change');await expect(page.getByRole('button',{name:'Terapkan Voucher',exact:true})).toHaveCount(0);assert.equal((await db.query('SELECT claimed_at FROM customer_vouchers')).rows[0].claimed_at,null);
    }else{
     if(scenario==='rollback')await db.exec(`CREATE FUNCTION fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Fixture claim persistence failure';END$$;CREATE TRIGGER fixture_fail AFTER UPDATE ON customer_vouchers FOR EACH ROW EXECUTE FUNCTION fixture_fail();`);
     if(scenario==='uncertain-retry')dropResponse=true;
     await page.getByRole('button',{name:/Simpan Perubahan/}).click();
     if(['rollback','uncertain-retry'].includes(scenario)){
      await expect(page.getByRole('alert')).toContainText('belum terkonfirmasi');await expect(page.getByRole('button',{name:'Batal',exact:true})).toBeDisabled();
      if(scenario==='rollback'){assert.equal((await db.query('SELECT claimed_at FROM customer_vouchers')).rows[0].claimed_at,null);assert.equal(Number((await db.query("SELECT total FROM invoices WHERE id='A'")).rows[0].total),250000);await db.exec('DROP TRIGGER fixture_fail ON customer_vouchers');}
      await page.getByRole('button',{name:'Konfirmasi ulang hasil simpan'}).click();
     }
     await expect.poll(()=>page.evaluate(()=>window.fixtureState().open)).toBe(false);
     const stored=(await db.query("SELECT total,discount FROM invoices WHERE id='A'")).rows[0];assert.equal(Number(stored.discount),scenario==='free-unit'?100000:20000);assert.equal(Number(stored.total),scenario==='free-unit'?150000:230000);
     assert.equal((await db.query('SELECT count(*)::int n FROM voucher_operations')).rows[0].n,1);
     const saveCalls=requests.filter(r=>r.path==='/api/apply-invoice-voucher');assert.equal(new Set(saveCalls.map(r=>r.body.request_id)).size,1);
    }
   }
  }
  assert.equal(errors,0);assert.equal(requests.some(r=>r.path==='/api/claim-voucher'),false);result.push({scenario,passed:true});console.log('PASS browser '+scenario);await context.close();await db.close();db=null;
 }
 await mkdir('deliverables/voucher-hardening-2026-11-12',{recursive:true});await writeFile('deliverables/voucher-hardening-2026-11-12/browser-results.json',JSON.stringify({scope:'Actual UI -> real API -> actual SQL migration on fictional local database; native concurrency tested separately',passed:result.length,results:result},null,2));
}catch(e){console.error(JSON.stringify({passed:result.length,failed_scenario:scenario,error:e.name,message:e.message.slice(0,1000)}));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await db?.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
