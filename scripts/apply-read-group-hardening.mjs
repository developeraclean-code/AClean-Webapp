// Explicit, narrowly scoped release helper for 219 and 220 only.
// Default --check is read-only. Never runs a payment or changes historical rows.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';
const mode=process.argv[2]||'--check';assert.ok(['--check','--apply'].includes(mode));
const env={...process.env};
for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)){
  const match=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if(match&&!env[match[1]])env[match[1]]=match[2].trim().replace(/^(['"])(.*)\1$/,'$2');
}
const ref=new URL(env.SUPABASE_URL||env.VITE_SUPABASE_URL).hostname.split('.')[0];assert.equal(ref,'apsbeppcmsxeldnejibz');
const target=new URL(env.SUPABASE_DB_URL);assert.ok(target.hostname.includes(ref)||decodeURIComponent(target.username).includes(ref));
if(env.SUPABASE_DB_PASSWORD)target.password=env.SUPABASE_DB_PASSWORD;
const db=new pg.Client({connectionString:target.toString(),ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000,query_timeout:15000,application_name:'aclean-read-group-hardening-219-220'});
let phase='connect';
const q=async(sql,args=[])=>{phase=sql.split('\n')[0].slice(0,90);return (await db.query(sql,args)).rows;};
const sha=s=>createHash('sha256').update(s).digest('hex');
const sqlFile=name=>readFileSync(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8');
const entries=[{name:'219_report_page_narrow_materialization',version:'20261021000000219',fn:'get_service_reports_page'},
  {name:'220_atomic_group_payment',version:'20261021000000220',fn:'record_group_payment_atomic'}].map(x=>({...x,source:sqlFile(x.name)}));
const body=source=>source.match(/AS\s+\$\$([\s\S]*?)\$\$;/i)[1].trim();
const oldReport=sqlFile('201_report_access_all_assigned_crew');
const oldBody=body(oldReport.slice(oldReport.indexOf('CREATE OR REPLACE FUNCTION public.get_service_reports_page(')));
async function fingerprints(){
  const specs={
    invoices:"jsonb_build_array(id,job_id,total,labor,material,discount,status,paid_amount,remaining_amount,withheld_amount,paid_at,payment_proof_url)",
    invoice_payments:"jsonb_build_array(id,invoice_id,amount,withheld_amount,method,paid_at,notes)",
    payments:"jsonb_build_array(id,invoice_id,invoice_ids,amount,total_amount,allocation_detail,payment_proof_url,paid_at)",
    payment_suggestions:"jsonb_build_array(id,status,validation_status,invoice_id,amount,image_url,resolved_at,resolved_by)",
    orders:"jsonb_build_array(id,invoice_id,status)",
  };
  const result={};for(const [table,expr]of Object.entries(specs))result[table]=(await q(`SELECT count(*)::int count,md5(coalesce(string_agg((${expr})::text,'' ORDER BY id),'')) digest FROM public.${table}`))[0];
  return result;
}
try {
  await db.connect();phase='begin';await db.query(mode==='--apply'?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await db.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='2s'");
  const history=await q('SELECT version,name,statements FROM supabase_migrations.schema_migrations WHERE version=ANY($1) OR name=ANY($2)',[entries.map(e=>e.version),entries.map(e=>e.name)]);
  const live=await q("SELECT p.proname,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1)",[entries.map(e=>e.fn)]);
  for(const e of entries){
    const rows=history.filter(h=>h.version===e.version||h.name===e.name);assert.ok(rows.length<=1,'Ambiguous history '+e.name);
    if(rows.length){assert.equal(rows[0].name,e.name);assert.ok(rows[0].statements.some(s=>sha(s)===sha(e.source)),'Applied SQL differs '+e.name);}
    const current=live.find(p=>p.proname===e.fn)?.prosrc.trim();
    if(e.fn==='get_service_reports_page')assert.ok(current===oldBody||current===body(e.source),'Report function changed externally; stop');
    else if(current)assert.equal(current,body(e.source),'Group function changed externally; stop');
  }
  const idColumn=await q("SELECT udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='id'");assert.equal(idColumn[0]?.udt_name,'int8');
  const policies=await q("SELECT tablename,policyname,cmd,roles,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1) ORDER BY tablename,policyname",[['payments','invoice_payments','payment_suggestions']]);
  console.log(JSON.stringify({mode,project:ref,verifiedSources:entries.map(e=>({name:e.name,sha256:sha(e.source),applied:history.some(h=>h.name===e.name)})),policies}));
  if(mode==='--check'){await db.query('ROLLBACK');process.exitCode=0;}
  else {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('aclean-read-group-release-219-220',0))");
    const before=await fingerprints();
    for(const e of entries){
      if(!history.some(h=>h.name===e.name)){
        await db.query(e.source.replace(/^\s*BEGIN;\s*$/m,'').replace(/^\s*COMMIT;\s*$/m,''));
        await db.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements,created_by) VALUES($1,$2,$3::text[],$4)',[e.version,e.name,[e.source],'Codex: persetujuan Owner 21 Oktober 2026']);
      }
    }
    assert.deepEqual(await fingerprints(),before,'Historical business fields changed; rollback');
    for(const e of entries){
      const row=(await q("SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname=$1",[e.fn]))[0];
      assert.equal(row.prosrc.trim(),body(e.source));
    }
    const signature='public.record_group_payment_atomic(uuid,text[],numeric,timestamptz,text,text,jsonb,text,uuid,boolean)';
    const grants=(await q("SELECT has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated",[signature]))[0];
    assert.deepEqual(grants,{anon:false,authenticated:true});
    await db.query('COMMIT');console.log(JSON.stringify({result:'219_220_committed',historicalBusinessFieldsUnchanged:true,grants,paymentCallsExecuted:0}));
  }
  // Small, read-only smoke of the report function under an active Owner profile.
  await db.query('BEGIN READ ONLY');await db.query("SET LOCAL statement_timeout='2500ms'; SET LOCAL lock_timeout='250ms'");
  const owner=(await q("SELECT id FROM public.user_profiles WHERE role='Owner' AND active IS DISTINCT FROM false ORDER BY id LIMIT 1"))[0];assert.ok(owner);
  await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:owner.id,role:'authenticated'})]);
  const start=performance.now();const result=(await q("SELECT get_service_reports_page(current_date-7,current_date,NULL,NULL,NULL,NULL,1,5) result"))[0].result;
  console.log(JSON.stringify({reportReadSmoke:true,ms:Math.round(performance.now()-start),total:result.total_count,rows:result.rows.length}));
  if(mode==='--apply'){
    const field=(await q("SELECT id FROM public.user_profiles WHERE role IN ('Teknisi','Helper') AND active IS DISTINCT FROM false ORDER BY id LIMIT 1"))[0];
    if(field){
      await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:field.id,role:'authenticated'})]);
      await db.query('SET LOCAL ROLE authenticated');
      const visible=(await q('SELECT (SELECT count(*)::int FROM public.payments) headers,(SELECT count(*)::int FROM public.payment_suggestions) proofs'))[0];
      assert.deepEqual(visible,{headers:0,proofs:0});
      console.log(JSON.stringify({fieldRoleReadAccess:'denied',visibleRows:visible}));
      await db.query('RESET ROLE');
    }
  }
  await db.query('ROLLBACK');
} catch(error){await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({failed:true,phase,code:error.code,error:String(error.message).slice(0,350)}));process.exitCode=1;}
finally {await db.end().catch(()=>{});}
