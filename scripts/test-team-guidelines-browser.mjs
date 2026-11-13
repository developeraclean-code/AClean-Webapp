// Actual React view + Supabase client + SQL/RLS on a disposable database.
// R2 HTTP is intercepted in-process; no credentials, production data or external writes.
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {PGlite} from '@electric-sql/pglite';
import {uploadFoto} from '../api/_handlers/foto.js';
const root=new URL('../',import.meta.url), out=new URL('../deliverables/team-guidelines-2026-11-13/',import.meta.url);
const db=new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('fixture.role',true)$$;`);
await db.exec(await readFile(new URL('../migrations/128_team_guidelines.sql',import.meta.url),'utf8'));
await db.exec('GRANT SELECT,INSERT,UPDATE,DELETE ON team_guidelines TO authenticated; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;');
const bundle=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{createClient}from'@supabase/supabase-js';import View from './src/views/TeamGuidelinesView.jsx';const role=new URLSearchParams(location.search).get('role')||'Owner';const supabase=createClient(location.origin,'fixture-only',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{'X-Fixture-Role':role}}});createRoot(document.getElementById('root')).render(<View supabase={supabase} currentUser={{role,name:'Fiktif'}} apiFetch={fetch} showNotif={message=>{window.notices.push(message)}} showConfirm={async()=>true}/>);`,resolveDir:new URL('..',import.meta.url).pathname,loader:'jsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}})).outputFiles[0].text;
function fixturePng(red=35,green=150,blue=210) {
 const chunk=(type,data)=>{const name=Buffer.from(type),bytes=Buffer.concat([name,data]);let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);name.copy(result,4);data.copy(result,8);result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);return result;};
 const width=640,height=320,header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const raw=Buffer.alloc(height*(width*3+1));for(let y=0;y<height;y++){const offset=y*(width*3+1);for(let x=0;x<width;x++){const light=x>25&&x<615&&y>25&&y<295;raw[offset+1+x*3]=light?red:15;raw[offset+2+x*3]=light?green:25;raw[offset+3+x*3]=light?blue:45;}}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const png=fixturePng();
const objects=new Map(),savedEnvironment={...process.env};
Object.assign(process.env,{R2_ACCESS_KEY:'fixture',R2_SECRET_KEY:'fixture',R2_ACCOUNT_ID:'fixture',R2_BUCKET_NAME:'fixture'});
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{assert.match(String(url),/^https:\/\/fixture\.r2\.cloudflarestorage\.com\/fixture\//);objects.set(decodeURIComponent(new URL(url).pathname.slice('/fixture/'.length)),options.body);return new Response('',{status:200});};
let failUpload=false,failRead=false,failSave=false,loseSaveResponse=false,delayUpload=false,mutations=0,queue=Promise.resolve();
const checks=[];
const server=createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};res.status=n=>{res.statusCode=n;return res;};
 try{
  if(u.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:8px;background:#0b1120;font-family:Arial,sans-serif"><div id="root"></div><script>window.notices=[]</script><script src="/bundle.js"></script></body></html>');return;}
  if(u.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);return;}
  if(u.pathname.startsWith('/sop/')){res.setHeader('Content-Type','image/png');res.end(png);return;}
  if(u.pathname==='/api/foto'){const bytes=objects.get(u.searchParams.get('key'));if(!bytes)return res.status(404).end();res.setHeader('Content-Type','image/jpeg');res.end(bytes);return;}
  if(u.pathname==='/api/upload-foto'){
   if(delayUpload)await new Promise(resolve=>setTimeout(resolve,350));
   if(failUpload)return res.status(503).json({error:'Fixture R2 unavailable'});
   let raw='';for await(const chunk of req)raw+=chunk;req.body=JSON.parse(raw);await uploadFoto(req,res);return;
  }
  if(u.pathname==='/rest/v1/team_guidelines'){
   const run=async()=>{
    if(req.method==='GET'&&failRead)return res.status(503).json({message:'Fixture read unavailable'});
    if(req.method!=='GET'&&failSave)return res.status(403).json({code:'42501',message:'Fixture save denied'});
    let raw='';for await(const chunk of req)raw+=chunk;
    const payload=raw?JSON.parse(raw):{},role=req.headers['x-fixture-role']||'Helper';
    await db.exec('BEGIN');
    try{
     await db.query("SELECT set_config('fixture.role',$1,true)",[role]);await db.exec('SET LOCAL ROLE authenticated');
     let result;
     if(req.method==='GET')result=await db.query('SELECT * FROM team_guidelines ORDER BY sort_order');
     else if(req.method==='POST'){
      mutations++;assert.deepEqual(Object.keys(payload).sort(),['content','role_scope','section','sort_order','updated_at','updated_by']);
      result=await db.query('INSERT INTO team_guidelines(content,section,role_scope,sort_order,updated_at,updated_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[payload.content,payload.section,payload.role_scope,payload.sort_order,payload.updated_at,payload.updated_by]);
     }else if(req.method==='PATCH'){
      mutations++;assert.deepEqual(Object.keys(payload).sort(),['content','updated_at','updated_by']);
      result=await db.query('UPDATE team_guidelines SET content=$1,updated_at=$2,updated_by=$3 WHERE id=$4 RETURNING *',[payload.content,payload.updated_at,payload.updated_by,u.searchParams.get('id').slice(3)]);
     }else if(req.method==='DELETE'){
      mutations++;result=await db.query('DELETE FROM team_guidelines WHERE id=$1 RETURNING id',[u.searchParams.get('id').slice(3)]);
     }else throw new Error('Unexpected method');
     await db.exec('COMMIT');
     if(req.method==='POST'&&loseSaveResponse){loseSaveResponse=false;return res.status(200).end('{');}
     const single=String(req.headers.accept).includes('vnd.pgrst.object');
     if(single&&result.rows.length!==1)return res.status(406).json({code:'PGRST116',message:'No single returned row'});
     res.json(single?result.rows[0]:result.rows);
    }catch(e){await db.exec('ROLLBACK');res.status(400).json({message:e.message,code:e.code});}
   };
   queue=queue.then(run);await queue;return;
  }
  res.status(404).end();
 }catch(e){console.error(e);if(!res.writableEnded)res.status(500).json({message:'Fixture failed'});}
});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch({headless:true});
 const context=await browser.newContext();let errors=0;context.on('page',p=>p.on('pageerror',()=>errors++));
 const page=await context.newPage();const add=()=>page.getByRole('button',{name:'+ Tambah Poin / Gambar',exact:true}).click();
 const save=()=>page.getByRole('button',{name:'Simpan Poin',exact:true}).click();
 const image=(name='contoh.png')=>page.getByLabel('Pilih gambar poin').setInputFiles({name,mimeType:'image/png',buffer:png});
 await page.goto(base);await expect(page.getByText('Hadir tepat waktu sesuai jadwal kerja yang ditentukan.',{exact:true})).toBeVisible();checks.push('legacy-text');
 await add();await expect(page.getByRole('button',{name:'Simpan Poin'})).toBeDisabled();await page.getByLabel('Teks poin').fill('Aturan fiktif\nBaris kedua');await save();await expect(page.getByText('Aturan fiktif\nBaris kedua',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Aturan fiktif\nBaris kedua',{exact:true})).toBeVisible();checks.push('text-save-reload');
 await add();failUpload=true;await image();await expect(page.getByRole('alert')).toContainText('Fixture R2 unavailable');assert.equal((await db.query("SELECT count(*)::int n FROM team_guidelines WHERE content LIKE '%![Gambar%'")).rows[0].n,0);failUpload=false;delayUpload=true;await image();await expect(page.getByRole('button',{name:'📋 Tata Tertib',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Simpan Poin'})).toBeEnabled();delayUpload=false;await save();await expect(page.getByAltText('Gambar poin 1')).toBeVisible();await expect.poll(()=>page.getByAltText('Gambar poin 1').evaluate(e=>e.naturalWidth)).toBeGreaterThan(0);await page.reload();await expect(page.getByAltText('Gambar poin 1')).toBeVisible();checks.push('image-only-upload-reload-and-failure');
 await page.getByRole('button',{name:'Edit poin 12',exact:true}).click();await page.getByLabel('Teks poin').fill('Aturan dengan gambar');await save();await expect(page.getByText('Aturan dengan gambar',{exact:true})).toBeVisible();await expect(page.getByAltText('Gambar poin 1')).toBeVisible();checks.push('edit-mixed-content');
 await page.getByRole('button',{name:'Edit poin 12',exact:true}).click();await page.getByRole('button',{name:'Hapus gambar 1'}).click();await save();await expect(page.getByAltText('Gambar poin 1')).toHaveCount(0);checks.push('remove-image');
 await add();await page.getByLabel('Pilih gambar poin').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('invalid')});await expect(page.getByRole('alert')).toContainText('bukan gambar yang valid');await page.getByRole('button',{name:'Batal',exact:true}).click();checks.push('invalid-image');
 await add();await page.getByLabel('Teks poin').fill('Belum tersimpan');failSave=true;await save();await expect(page.getByRole('alert')).toContainText('Fixture save denied');await expect(page.getByRole('button',{name:'Simpan Poin'})).toBeDisabled();await expect(page.getByLabel('Teks poin')).toHaveValue('Belum tersimpan');failSave=false;await page.getByRole('button',{name:'Muat ulang daftar'}).click();await expect(page.getByText('Belum tersimpan',{exact:true})).toHaveCount(0);checks.push('failed-save-keeps-draft-no-false-success');
 await add();await page.getByLabel('Teks poin').fill('Respons simpan terputus');loseSaveResponse=true;await save();await expect(page.getByRole('button',{name:'Simpan Poin'})).toBeDisabled();await page.getByRole('button',{name:'Muat ulang daftar'}).click();await expect(page.getByText('Respons simpan terputus',{exact:true})).toBeVisible();assert.equal((await db.query("SELECT count(*)::int n FROM team_guidelines WHERE content='Respons simpan terputus'")).rows[0].n,1);checks.push('lost-response-no-insert-replay');
 await page.getByRole('button',{name:'🛠 Jobdesk',exact:true}).click();await page.getByRole('button',{name:'🧢 Helper',exact:true}).click();await add();await page.getByLabel('Teks poin').fill('Jobdesk Helper fiktif');await save();await page.getByRole('button',{name:'🔧 Teknisi',exact:true}).click();await expect(page.getByText('Jobdesk Helper fiktif',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'🧢 Helper',exact:true}).click();await expect(page.getByText('Jobdesk Helper fiktif',{exact:true})).toBeVisible();checks.push('section-role-scope');
 await page.getByRole('button',{name:'🧾 SOP Layanan',exact:true}).click();await expect(page.getByText('SOP Cleaning Service AC',{exact:true})).toBeVisible();await add();await page.getByLabel('Teks poin').fill('SOP tambahan fiktif');await save();await expect(page.getByText('SOP tambahan fiktif',{exact:true})).toBeVisible();checks.push('custom-sop-and-static-posters');
 await page.goto(base+'?role=Admin');await add();await page.getByLabel('Teks poin').fill('Admin fiktif');await save();await expect(page.getByText('Admin fiktif',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Hapus poin 14',exact:true}).click();await expect(page.getByText('Admin fiktif',{exact:true})).toHaveCount(0);checks.push('admin-add-delete');
 for(const role of ['Helper','Teknisi','Finance']){
  await page.goto(base+'?role='+role);await expect(page.getByText('Aturan dengan gambar',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'+ Tambah Poin / Gambar'})).toHaveCount(0);await expect(page.getByRole('button',{name:/Edit poin/})).toHaveCount(0);
  const response=await page.request.post(base+'/rest/v1/team_guidelines',{headers:{'X-Fixture-Role':role},data:{content:'Unauthorized',section:'tata_tertib',role_scope:'all',sort_order:100,updated_at:new Date().toISOString(),updated_by:'Fiktif'}});assert.equal(response.status(),400);
 }checks.push('staff-read-only-and-sql-rls');
 failRead=true;await page.reload();await expect(page.getByRole('alert')).toContainText('Poin belum berhasil dimuat',{timeout:15000});failRead=false;await page.getByRole('button',{name:'Coba lagi'}).click();await expect(page.getByText('Aturan dengan gambar',{exact:true})).toBeVisible();checks.push('read-error-retry');
 await page.goto(base);await page.setViewportSize({width:390,height:844});await add();await page.getByLabel('Teks poin').fill('Teks panjang '.repeat(30));await image();await expect(page.getByRole('button',{name:'Simpan Poin'})).toBeEnabled();await image();await expect(page.getByRole('alert')).toContainText('sudah ditambahkan');for(let i=1;i<=3;i++){await page.getByLabel('Pilih gambar poin').setInputFiles({name:`sample-${i}.png`,mimeType:'image/png',buffer:fixturePng(40+i*40,140,180)});await expect(page.getByAltText(`Gambar poin ${i+1}`,{exact:true})).toBeVisible();}await expect(page.getByRole('button',{name:'+ Tambah Gambar',exact:true})).toBeDisabled();checks.push('duplicate-and-four-image-limit');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:new URL('mobile-editor.png',out).pathname,fullPage:true});checks.push('mobile-no-horizontal-overflow');
 assert.equal(errors,0);await context.close();
 await mkdir(out,{recursive:true});await writeFile(new URL('browser-results.json',out),JSON.stringify({passed:true,checks,uncaught_errors:errors,external_writes:false,database:'disposable PostgreSQL/WASM; migration 128 and existing RLS',r2:'actual upload handler, intercepted HTTP storage'},null,2)+'\n');
 for(const check of checks)console.log('PASS '+check);
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await db.close();globalThis.fetch=originalFetch;process.env=savedEnvironment;}
