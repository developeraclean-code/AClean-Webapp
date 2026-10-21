// Isolated PostgreSQL/WASM; synthetic fixtures only. Never loads .env or cloud credentials.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const source = readFileSync(new URL('../migrations/201_report_access_all_assigned_crew.sql', import.meta.url), 'utf8');
const oldFunction = source.slice(source.indexOf('CREATE OR REPLACE FUNCTION public.get_service_reports_page('), source.indexOf('CREATE OR REPLACE FUNCTION public.guard_field_report_writes()'));
const migration = readFileSync(new URL('../migrations/219_report_page_narrow_materialization.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-4000-a000-000000000001';
const auth = async id => db.exec(`RESET ROLE; SELECT set_config('test.uid','${id}',false); SET ROLE authenticated;`);
const call = async args => (await db.query('SELECT get_service_reports_page($1,$2,$3,$4,$5,$6,$7,$8) result', args)).rows[0].result;
const cases = [
  [null,null,null,null,null,null,1,20],
  [null,null,null,'BELUM_VERIFIED',null,null,1,20],
  ['2026-10-05','2026-10-15','Cleaning','Semua','Semua Tim',null,2,10],
  [null,null,null,null,'Extra Crew',null,1,20],
  [null,null,null,null,null,'extra',1,20],
  [null,null,null,'VERIFIED',null,'CUSTOMER-',3,20],
  [null,null,null,null,null,null,-1,500],
  [null,null,null,null,null,null,999,20],
];
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
    CREATE TABLE user_profiles(id uuid PRIMARY KEY,role text,name text,active boolean);
    INSERT INTO user_profiles VALUES
      ('${owner}','Owner','Owner',true),
      ('00000000-0000-4000-a000-000000000002','Admin','Admin',true),
      ('00000000-0000-4000-a000-000000000003','Finance','Finance',true),
      ('00000000-0000-4000-a000-000000000004','Teknisi','Lead Crew',true),
      ('00000000-0000-4000-a000-000000000005','Helper','Extra Crew',true),
      ('00000000-0000-4000-a000-000000000006','Helper','Unassigned',true),
      ('00000000-0000-4000-a000-000000000007','Owner','Inactive',false);
    CREATE TABLE orders(id text PRIMARY KEY,teknisi text,teknisi2 text,teknisi3 text,helper text,helper2 text,helper3 text,assigned_members text[]);
    CREATE TABLE service_reports(id text PRIMARY KEY,job_id text,teknisi text,helper text,submitted_by_user_id uuid,customer text,service text,type text,date date,
      total_units integer,total_freon numeric,units jsonb,materials_used jsonb,foto_urls jsonb,fotos jsonb,units_json text,
      rekomendasi text,catatan_global text,edit_log jsonb,status text,submitted_at timestamptz,updated_at timestamptz,submitted text,unit_mismatch boolean,
      created_at timestamptz,is_substitute boolean,is_install boolean,bap_number text,bap_statement text,bap_recommendation text,
      ttd_customer_url text,ttd_customer_name text,bap_skipped_reason text,bap_signed_at timestamptz,hasil_survey text,catatan_rekomendasi text,survey_sent_at timestamptz,
      report_card_sent_at timestamptz,report_card_sent_by text,report_card_sent_count integer,report_card_last_sent_mode text,report_card_last_sent_method text);
    INSERT INTO orders SELECT 'JOB-'||i,CASE WHEN i%2=0 THEN 'Lead Crew' ELSE 'Other Lead' END,NULL,NULL,'Helper',NULL,NULL,
      CASE WHEN i%3=0 THEN ARRAY['Extra Crew','Helper','Extra Crew','  '] ELSE ARRAY[]::text[] END FROM generate_series(1,200) i;
    INSERT INTO service_reports(id,job_id,teknisi,helper,customer,service,date,status,submitted_at,units,materials_used,foto_urls,fotos,units_json,total_units)
      SELECT 'REPORT-'||i,'JOB-'||i,CASE WHEN i%2=0 THEN 'Lead Crew' ELSE 'Other Lead' END,'Helper','CUSTOMER-'||i,
        CASE WHEN i%2=0 THEN 'Cleaning' ELSE 'Repair' END,CASE WHEN i%10=0 THEN NULL ELSE date '2026-10-01'+(i%20) END,
        (ARRAY['SUBMITTED','REVISION','VERIFIED'])[1+i%3],CASE WHEN i=200 THEN NULL ELSE timestamptz '2026-10-01 09:00+07'+(i%20)*interval '1 day' END,
        jsonb_build_array(jsonb_build_object('note',repeat(md5(i::text),300),'unit',i)),
        '[{"name":"Synthetic material","qty":0.7}]','["/simulated/foto.jpg"]',
        jsonb_build_array(repeat(md5(i::text),500)),repeat(md5(i::text),500),1 FROM generate_series(1,200) i;
    SET work_mem='64kB'; ANALYZE orders; ANALYZE service_reports;`);
  await db.exec(oldFunction);
  const before = new Map();
  await check('capture legacy results for every active role and filter/page combination', async () => {
    for (let role = 1; role <= 6; role++) {
      await auth(`00000000-0000-4000-a000-${String(role).padStart(12,'0')}`);
      for (let i = 0; i < cases.length; i++) before.set(`${role}:${i}`, await call(cases[i]));
    }
  });
  await db.exec('RESET ROLE;');
  const baseline = (await db.query('SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) hash FROM service_reports r')).rows[0].hash;
  const explain = async () => (await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT get_service_reports_page()')).rows[0]['QUERY PLAN'][0];
  await auth(owner);
  const oldPlan = await explain();
  await db.exec('RESET ROLE;');
  await check('migration compiles twice and preserves business rows', async () => {
    await db.exec(migration); await db.exec(migration);
    assert.equal((await db.query('SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) hash FROM service_reports r')).rows[0].hash, baseline);
  });
  await check('all 48 result objects exactly match legacy rows, order, status counts, search and crew visibility', async () => {
    for (let role = 1; role <= 6; role++) {
      await auth(`00000000-0000-4000-a000-${String(role).padStart(12,'0')}`);
      for (let i = 0; i < cases.length; i++) assert.deepEqual(await call(cases[i]), before.get(`${role}:${i}`), `role ${role} case ${i}`);
    }
  });
  await check('anon, missing profile and inactive Owner remain denied', async () => {
    await db.exec('RESET ROLE; SET ROLE anon;');
    await assert.rejects(() => call(cases[0]), /permission denied/);
    for (const id of ['00000000-0000-4000-a000-000000000007','00000000-0000-4000-a000-000000000099']) {
      await auth(id); await assert.rejects(() => call(cases[0]), /Profil aktif/);
    }
  });
  await check('unassigned helper sees no rows and extra assigned crew sees its 66 reports', async () => {
    await auth('00000000-0000-4000-a000-000000000006'); assert.equal((await call(cases[0])).total_count, 0);
    await auth('00000000-0000-4000-a000-000000000005'); assert.equal((await call(cases[0])).total_count, 66);
  });
  await check('no integer overflow for extreme page numbers', async () => {
    await auth(owner); const result = await call([null,null,null,null,null,null,2147483647,100]);
    assert.equal(result.total_count, 200); assert.deepEqual(result.rows, []);
  });
  await check('optimized page does not increase temporary disk writes under constrained work_mem', async () => {
    await auth(owner); const nextPlan = await explain();
    const before = oldPlan.Plan['Temp Written Blocks'] || 0, after = nextPlan.Plan['Temp Written Blocks'] || 0;
    assert.ok(after <= before);
    console.log(JSON.stringify({ isolatedWorkMem:'64kB', oldTempWrittenBlocks:before, newTempWrittenBlocks:after,
      oldExecutionMs:oldPlan['Execution Time'], newExecutionMs:nextPlan['Execution Time'] }));
  });
  console.log(JSON.stringify({ checks, syntheticJobs:200, resultComparisons:48, productionConnections:0, productionWrites:0 }));
} finally { await db.close(); }
