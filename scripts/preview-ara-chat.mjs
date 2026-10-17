import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { runLabTurn } from './lib/ara-lab.mjs';
process.loadEnvFile('.env.local');
const port=Number(process.env.ARA_CHAT_PORT || 4176), origin=`http://127.0.0.1:${port}`;
const token=randomBytes(32).toString('hex');
const sb=createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const [settings,brain,prices]=await Promise.all([
  sb.from('app_settings').select('key,value').in('key',['llm_provider','ara_training_rules']),
  sb.from('ara_brain').select('value').eq('key','brain_customer').maybeSingle(),
  sb.from('price_list').select('service,type,harga:price').or('is_active.is.null,is_active.eq.true').order('service').limit(250),
]);
if(settings.error||brain.error||prices.error)throw new Error('Tidak dapat membaca konfigurasi ARA. Preview tidak memakai fallback konfigurasi diam-diam.');
const snapshot={settings:Object.fromEntries(settings.data.map(x=>[x.key,x.value])),brain:brain.data?.value || '',prices:prices.data};
const loadedAt=new Date().toISOString();
let busy=false,last=0;
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(req.headers.host!==`127.0.0.1:${port}`)return json(403,{error:'Host ditolak'});
  if(req.method==='GET'&&req.url==='/'){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.end(readFileSync('preview/ara/chat.html','utf8').replace('__TOKEN__',token));
  }
  if(req.headers['x-ara-lab-token']!==token)return json(403,{error:'Buka ulang halaman preview'});
  if(req.method==='GET'&&req.url==='/config')return json(200,{provider:snapshot.settings.llm_provider || 'claude',prices:snapshot.prices.length,loadedAt});
  if(req.method!=='POST'||req.url!=='/chat')return json(404,{error:'Tidak ditemukan'});
  if(req.headers.origin!==origin)return json(403,{error:'Origin ditolak'});
  if(busy||Date.now()-last<1000)return json(429,{error:'Tunggu respons sebelumnya atau coba sebentar lagi'});
  busy=true;last=Date.now();
  try{
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>150000){json(413,{error:'Pesan terlalu besar'});return;}}
    let payload;try{payload=JSON.parse(body);}catch{return json(400,{error:'JSON tidak valid'});}
    const result=await runLabTurn({snapshot,message:payload.message,history:payload.history,mode:payload.mode});
    json(200,result);
  }catch(e){console.error('[ARA LAB]',e.name);json(400,{error:'Pengujian gagal. Periksa input dan koneksi, lalu coba ulang.'});}
  finally{busy=false;}
});
server.listen(port,'127.0.0.1',()=>console.log(`ARA percakapan lokal: ${origin} | provider ${snapshot.settings.llm_provider || 'claude'} | ${snapshot.prices.length} tarif | baca konfigurasi saja, tanpa WA/DB writes`));
