// Isolated PostgreSQL/WASM tests. Never reads .env or accesses Supabase.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();let checks=0;
const sql=s=>db.exec(s), query=s=>db.query(s);
const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
const base={customer:'Andi',phone:'6281234567890',customer_id:'CUST-TEST-2',address:'Rumah Melati',service:'Cleaning',type:'Split',units:2,date:'2099-10-12',time:'09:00',time_end:'11:00',team_slot:'Team 01',status:'PENDING',notes:'Dari WhatsApp',source:'whatsapp'};
let seq=0;
const request=()=>`10000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`;
const call=async(id,plan=base,expected=null,reason='',rid=request())=>(await db.query('select save_schedule_plan($1,$2,$3,$4,$5) as result',[rid,id,JSON.stringify(plan),expected?JSON.stringify(expected):null,reason])).rows[0].result;
const snapshot=o=>Object.fromEntries(['date','time','time_end','team_slot','status','notes','teknisi','teknisi2','teknisi3','helper','helper2','helper3'].map(k=>[k,o[k]??null]));
try {
 await sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;
 CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role',true) $$;
 CREATE TABLE user_profiles(id uuid,name text); INSERT INTO user_profiles VALUES(auth.uid(),'Dedy');
 CREATE TABLE customers(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,name text,phone text,address text,area text,notes text,is_vip boolean,total_orders integer,joined_date date,last_service date);
 INSERT INTO customers VALUES('${base.customer_id}','Andi','${base.phone}','Rumah Melati','','',false,0,'2026-01-01','2026-01-01');
 CREATE TABLE maintenance_clients(id uuid PRIMARY KEY,customer_id text);
 CREATE TABLE orders(id text PRIMARY KEY,customer text,customer_id text,phone text,address text,area text,service text,type text,units integer,date date,time time,time_end time,team_slot text,status text,notes text,source text,dispatch boolean,dispatch_at timestamptz,last_changed_by text,maintenance_client_id uuid,project_id text,teknisi text,teknisi2 text,teknisi3 text,helper text,helper2 text,helper3 text);
 CREATE TABLE team_presets(slot text PRIMARY KEY,teknisi text,sort_order integer);
 INSERT INTO team_presets VALUES('Team 01',NULL,1),('Team 02',NULL,2),('Team 08',NULL,8),('Malam 01',NULL,9);
 CREATE TABLE daily_team_slots(date date,slot text,member1 text,member1_role text,member2 text,member2_role text,member3 text,member3_role text,member4 text,member4_role text,member5 text,member5_role text,member6 text,member6_role text,member7 text,member7_role text,member8 text,member8_role text,PRIMARY KEY(date,slot));
 CREATE TABLE technician_schedule(id serial PRIMARY KEY,order_id text REFERENCES orders(id),teknisi text,date date,time_start text,time_end text,status text);
 SELECT set_config('test.role','Owner',false);`);
 const old=readFileSync(new URL('../migrations/177_atomic_invoice_report_order_workflows.sql',import.meta.url),'utf8');
 await sql(old.slice(old.indexOf('CREATE TABLE IF NOT EXISTS public.operational_mutations'),old.indexOf('CREATE OR REPLACE FUNCTION public.settle_invoice_atomic')));
 await sql(readFileSync(new URL('../migrations/070_atomic_teknisi_slot_claim.sql',import.meta.url),'utf8'));
 await sql(readFileSync(new URL('../migrations/194_team_schedule_planning.sql',import.meta.url),'utf8'));
 let first;
 const rid=request();
 await check('future planning saves without personnel and preserves last completed service',async()=>{
  first=await call('PLAN-A',base,null,'',rid);
  assert.equal((await query('select total_orders from customers')).rows[0].total_orders,0);
  assert.equal(first.order.time,'09:00:00');
  assert.equal(first.order.status,'PENDING');assert.equal(first.order.teknisi,null);assert.equal(first.order.dispatch,false);
  assert.equal((await query('select last_service::text from customers')).rows[0].last_service,'2026-01-01');
 });
 await check('same request is idempotent, changed payload is rejected',async()=>{
  assert.equal((await call('PLAN-A',base,null,'',rid)).replayed,true);
  await assert.rejects(()=>call('PLAN-A',{...base,units:3},null,'',rid),/data berbeda/);
  assert.equal((await query('select count(*)::int as n from orders')).rows[0].n,1);
 });
 await check('same-team overlap is blocked even with an empty roster; adjacent work succeeds',async()=>{
  await assert.rejects(()=>call('PLAN-B'),/bertabrakan/);
  await call('PLAN-B',{...base,time:'11:00',time_end:'13:00',status:'CONFIRMED'});
 });
 await check('reschedule retains ID/customer confirmation, clears old crew, and records previous values',async()=>{
  const result=await call('PLAN-A',{...base,date:'2099-10-13',status:'CONFIRMED'},snapshot(first.order),'Pelanggan pindah hari');
  assert.equal(result.order.id,'PLAN-A');assert.equal(result.order.date,'2099-10-13');assert.equal(result.order.status,'CONFIRMED');
  assert.equal(result.before.date,'2099-10-12');assert.match(result.order.notes,/Pelanggan pindah hari/);first=result;
  assert.equal((await query('select count(*)::int as n from orders')).rows[0].n,2);
 });
 await check('existing job service cannot change during rescheduling',async()=>{
  await assert.rejects(()=>call('PLAN-A',{...base,service:'Install'},snapshot(first.order),'Ganti layanan'),/Jenis servis/);
 });
 await check('stale admin edits roll back without changing the job',async()=>{
  await assert.rejects(()=>call('PLAN-A',base,{...snapshot(first.order),date:'2099-10-12'},'Admin lama'),/admin lain/);
  assert.equal((await query("select date::text from orders where id='PLAN-A'")).rows[0].date,'2099-10-13');
 });
 await sql(`INSERT INTO daily_team_slots(date,slot,member1,member1_role,member2,member2_role) VALUES('2099-10-14','Team 01','Rian','teknisi','Danu','helper'),('2099-10-14','Team 02','Budi','teknisi','Danu','helper'),('2099-10-15','Team 01','Budi','teknisi','Sari','helper');`);
 let staffed;
 await check('daily roster sets technicians/helpers and reserves both roles',async()=>{
  staffed=await call('PLAN-C',{...base,date:'2099-10-14',status:'CONFIRMED'});
  assert.equal(staffed.order.teknisi,'Rian');assert.equal(staffed.order.helper,'Danu');
  assert.equal((await query("select count(*)::int as n from technician_schedule where order_id='PLAN-C'")).rows[0].n,2);
 });
 await check('shared helper across Team slots cannot be double booked',async()=>{
  await assert.rejects(()=>call('PLAN-D',{...base,date:'2099-10-14',team_slot:'Team 02'}),/bertabrakan/);
 });
 await check('moving a staffed job uses new-day roster and releases old-day reservations',async()=>{
  staffed=await call('PLAN-C',{...base,date:'2099-10-15',status:'CONFIRMED'},snapshot(staffed.order),'Tim diganti harian');
  assert.equal(staffed.order.teknisi,'Budi');assert.equal(staffed.order.helper,'Sari');
  assert.equal((await query("select count(*)::int as n from technician_schedule where order_id='PLAN-C' and date='2099-10-14'")).rows[0].n,0);
 });
 await check('cancellation retains history and releases reservations',async()=>{
  const cancelled=await call('PLAN-C',{...base,date:'2099-10-15',status:'CANCELLED'},snapshot(staffed.order),'Pelanggan membatalkan');
  assert.equal(cancelled.order.status,'CANCELLED');
  assert.equal((await query("select count(*)::int as n from technician_schedule where order_id='PLAN-C'")).rows[0].n,0);
 });
 await check('invalid roles, unknown teams, invalid dates/times and wrong customer location are rejected',async()=>{
  await sql("SELECT set_config('test.role','Teknisi',false)");await assert.rejects(()=>call('BAD'),/Owner\/Admin/);
  await sql("SELECT set_config('test.role','',false)");await assert.rejects(()=>call('BAD'),/Owner\/Admin/);
  await sql("SELECT set_config('test.role','Owner',false)");
  for(const patch of [{team_slot:'Team 99'},{date:'2099-02-30'},{time_end:'08:00'},{time:'18:00',time_end:'20:00'},{units:0},{phone:'628999999999'}])await assert.rejects(()=>call('BAD',{...base,...patch}));
 });
 await check('completed/active jobs cannot be rescheduled by this planning endpoint',async()=>{
  await sql("UPDATE orders SET status='IN_PROGRESS' WHERE id='PLAN-A'");
  const row=(await query("select * from orders where id='PLAN-A'")).rows[0];
  await assert.rejects(()=>call('PLAN-A',base,snapshot(row),'Ganti jadwal'),/berjalan/);
 });
 await check('slot claim failure rolls back order, customer count and mutation receipt',async()=>{
  await sql("INSERT INTO technician_schedule(order_id,teknisi,date,time_start,time_end,status) VALUES('PLAN-A','Rian','2099-10-14','14:00','16:00','ACTIVE')");
  const count=(await query('select total_orders from customers')).rows[0].total_orders;
  await assert.rejects(()=>call('ROLLBACK',{...base,date:'2099-10-14',time:'14:00',time_end:'16:00'}),/tidak tersedia/);
  assert.equal((await query("select count(*)::int as n from orders where id='ROLLBACK'")).rows[0].n,0);
  assert.equal((await query('select total_orders from customers')).rows[0].total_orders,count);
 });
 console.log(`PASS ${checks} PostgreSQL planning contract groups`);
}finally{await db.close();}
