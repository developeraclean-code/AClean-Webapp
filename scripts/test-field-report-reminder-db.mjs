// Isolated PostgreSQL contract tests: no .env, network, production data or WA.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.WA_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();let checks=0;
const sql=s=>db.exec(s),value=async s=>(await db.query(s)).rows[0];
const check=async(label,fn)=>{await fn();checks++;console.log('PASS '+label);};
const role=async(auth,app)=>sql(`RESET ROLE;SELECT set_config('test.auth_role','${auth}',false),set_config('test.role','${app}',false);SET ROLE ${auth==='service_role'?'service_role':'authenticated'};`);
try{
 await sql(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('test.auth_role',true)$$;
 CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('test.role',true)$$;
 CREATE TABLE app_settings(key text PRIMARY KEY,value text);GRANT ALL ON app_settings TO service_role;
 CREATE TABLE service_reports(id text PRIMARY KEY,status text,last_changed_by text);
 CREATE TABLE job_materials_brought(id text PRIMARY KEY,status text,notes text);
 GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;GRANT SELECT,INSERT,UPDATE ON service_reports,job_materials_brought TO authenticated,service_role;
 CREATE SCHEMA cron;CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text,active boolean);
 CREATE FUNCTION cron.alter_job(job_id bigint,active boolean) RETURNS void LANGUAGE sql AS $$UPDATE cron.job SET active=$2 WHERE jobid=$1$$;
 INSERT INTO cron.job VALUES(6,'aclean-auto-verify-laporan-48jam',true),(20,'aclean-payment-media-retry-15m',true);
 INSERT INTO app_settings VALUES('cron_jobs','[{"id":3,"backendKey":"weekly_report_enabled","active":true}]'),('weekly_report_enabled','true');
 INSERT INTO service_reports VALUES('KEEP','VERIFIED','Admin'),('MANUAL','SUBMITTED','Teknisi');
 INSERT INTO job_materials_brought VALUES('M1','BROUGHT','Admin');`);
 const source=readFileSync(new URL('../migrations/215_manual_report_verification_and_reminder.sql',import.meta.url),'utf8');
 await check('migration 215 compiles and does not alter historical report/material rows',async()=>{
  await sql(source);
  assert.deepEqual(await value("SELECT * FROM service_reports WHERE id='KEEP'"),{id:'KEEP',status:'VERIFIED',last_changed_by:'Admin'});
  assert.equal((await value("SELECT status FROM job_materials_brought WHERE id='M1'")).status,'BROUGHT');
 });
 await check('disables only legacy verification scheduler; payment retry stays active',async()=>{
  assert.equal((await value('SELECT active FROM cron.job WHERE jobid=6')).active,false);
  assert.equal((await value('SELECT active FROM cron.job WHERE jobid=20')).active,true);
 });
 await check('migration is idempotent; new reminder is OFF and old flags cannot re-enable themselves',async()=>{
  await sql(source);
  assert.equal((await value("SELECT value FROM app_settings WHERE key='field_report_reminder_enabled'")).value,'false');
  assert.equal((await value("SELECT count(*)::int n FROM app_settings,jsonb_array_elements(value::jsonb) j WHERE key='cron_jobs' AND j->>'backendKey'='field_report_reminder_enabled'")).n,1);
  assert.equal((await value("SELECT value FROM app_settings WHERE key='weekly_report_enabled'")).value,'true');
 });
 await check('service role cannot auto-verify through old Edge functions',async()=>{
  await role('service_role','');
  await assert.rejects(()=>sql("UPDATE service_reports SET status='VERIFIED',last_changed_by='auto-verify' WHERE id='MANUAL'"),/manual/);
  await assert.rejects(()=>sql("INSERT INTO service_reports VALUES('AUTO','VERIFIED','Worker')"),/manual/);
 });
 await check('old logged-in Owner browser timer is blocked despite its broad role',async()=>{
  await role('authenticated','Owner');
  await assert.rejects(()=>sql("UPDATE service_reports SET status='VERIFIED',last_changed_by='system_auto_verify' WHERE id='MANUAL'"),/manual/);
 });
 await check('Owner and Admin manual verification still work; staff verification is denied',async()=>{
  for(const appRole of ['Teknisi','Helper']){await role('authenticated',appRole);await assert.rejects(()=>sql("UPDATE service_reports SET status='VERIFIED',last_changed_by='Teknisi' WHERE id='MANUAL'"),/manual/);}
  for(const appRole of ['Owner','Admin']){
   await role('authenticated',appRole);await sql(`UPDATE service_reports SET status='VERIFIED',last_changed_by='${appRole}' WHERE id='MANUAL'`);
   assert.equal((await value("SELECT status FROM service_reports WHERE id='MANUAL'")).status,'VERIFIED');
   await sql("UPDATE service_reports SET status='SUBMITTED' WHERE id='MANUAL'");
  }
 });
 await check('legacy auto-return blocked, but ordinary Admin return remains allowed',async()=>{
  await role('authenticated','Admin');
  await assert.rejects(()=>sql("UPDATE job_materials_brought SET status='RETURNED',notes='auto-returned (>24h tidak ke-laporan)' WHERE id='M1'"),/Admin/);
  await sql("UPDATE job_materials_brought SET status='RETURNED',notes='Diperiksa Admin' WHERE id='M1'");
  assert.equal((await value("SELECT status FROM job_materials_brought WHERE id='M1'")).status,'RETURNED');
 });
 await check('only Owner can toggle; both representations change atomically',async()=>{
  for(const appRole of ['Admin','Helper','Teknisi']){await role('authenticated',appRole);await assert.rejects(()=>sql("SELECT set_automation_setting('field_report_reminder_enabled',true,'{}')"),/Owner/);}
  await role('authenticated','Owner');
  await sql("SELECT set_automation_setting('field_report_reminder_enabled',true,'{\"time\":\"20:00\"}')");
  await sql('RESET ROLE');
  assert.equal((await value("SELECT value FROM app_settings WHERE key='field_report_reminder_enabled'")).value,'true');
  assert.equal((await value("SELECT j->>'active' active FROM app_settings,jsonb_array_elements(value::jsonb) j WHERE key='cron_jobs' AND j->>'backendKey'='field_report_reminder_enabled'")).active,'true');
 });
 await check('retired automation cannot be reactivated through toggle RPC',async()=>{
  await role('authenticated','Owner');
  await assert.rejects(()=>sql("SELECT set_automation_setting('auto_verify_reports_enabled',true,'{}')"),/dihentikan/);
  await assert.rejects(()=>sql("SELECT set_automation_setting('auto_return_brought_enabled',true,'{}')"),/dihentikan/);
 });
 await check('scheduler RPC is service-only and old financial tables are not dependencies',async()=>{
  await sql('RESET ROLE');
  for(const r of ['anon','authenticated'])assert.equal((await value(`SELECT has_function_privilege('${r}','dispatch_field_report_reminders_215()','EXECUTE') AS allowed`)).allowed,false);
  assert.equal((await value("SELECT has_function_privilege('service_role','dispatch_field_report_reminders_215()','EXECUTE') AS allowed")).allowed,true);
 });
 console.log(`PASS ${checks} database contracts; zero production connections or WA sends`);
}finally{await db.close();}
