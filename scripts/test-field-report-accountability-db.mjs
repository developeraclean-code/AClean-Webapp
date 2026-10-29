// Isolated PostgreSQL/WASM with synthetic fixtures only. No env or remote DB.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const migration = readFileSync(new URL('../migrations/223_field_report_accountability_lock.sql', import.meta.url), 'utf8');

const tech = '00000000-0000-4000-a000-000000000001';
const helper = '00000000-0000-4000-a000-000000000002';
const owner = '00000000-0000-4000-a000-000000000003';
let checks = 0;

async function check(name, run) {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
}

async function authenticate(id) {
  await db.exec(`
    RESET ROLE;
    SELECT set_config('test.uid','${id}',false);
    SELECT set_config('test.role','authenticated',false);
    SET ROLE authenticated;
  `);
}

const reportPayload = (overrides = {}) => ({
  id: 'REPORT-1', job_id: 'JOB-1', teknisi: 'Mulyadi', helper: 'Aris',
  customer: 'Bapak Jason Mentari', service: 'Repair', date: '2026-10-29',
  total_units: 1, total_freon: 0, submitted_at: '2026-10-29T04:00:00Z',
  submitted: '29/10/2026 11.00', units: [{ unit_no: 1 }], materials_used: [],
  foto_urls: ['/report/photo-1.jpg'], fotos: [{ url: '/report/photo-1.jpg' }],
  rekomendasi: 'Periksa kembali', catatan_global: '', unit_mismatch: false,
  is_substitute: false, ...overrides,
});

async function submit(payload, actor, key) {
  return (await db.query(
    'SELECT public.submit_service_report_atomic($1::jsonb,$2::text,$3::text) AS result',
    [JSON.stringify(payload), actor, key],
  )).rows[0].result;
}

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.uid',true),'')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.role',true),'')
    $$;

    CREATE TABLE public.user_profiles(
      id uuid PRIMARY KEY, name text NOT NULL, role text NOT NULL,
      active boolean NOT NULL DEFAULT true, status text, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.orders(
      id text PRIMARY KEY, customer text, teknisi text, teknisi2 text, teknisi3 text,
      helper text, helper2 text, helper3 text, assigned_members text[] NOT NULL DEFAULT '{}',
      status text, last_changed_by text
    );
    CREATE TABLE public.service_reports(
      id text PRIMARY KEY, job_id text NOT NULL UNIQUE, teknisi text, helper text,
      submitted_by_user_id uuid, customer text, service text, date date, status text,
      total_units integer, total_freon numeric, submitted_at timestamptz, submitted text,
      units jsonb, units_json text, materials_used jsonb, materials_json text,
      foto_urls text[], fotos jsonb, rekomendasi text, catatan_global text,
      unit_mismatch boolean, is_substitute boolean, hasil_survey text,
      catatan_rekomendasi text, last_changed_by text, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.invoices(
      id text PRIMARY KEY, job_id text, status text, sent boolean, paid_amount numeric
    );
    CREATE TABLE public.operational_mutations(
      mutation_key text PRIMARY KEY, operation text, actor_id uuid, actor_name text,
      result jsonb, completed_at timestamptz
    );

    INSERT INTO public.user_profiles(id,name,role,status) VALUES
      ('${tech}','Mulyadi','Teknisi','on-job'),
      ('${helper}','Aris','Helper','on-job'),
      ('${owner}','Owner','Owner','active');
    INSERT INTO public.orders(id,customer,teknisi,helper,assigned_members,status)
    VALUES('JOB-1','Bapak Jason Mentari','Mulyadi','Aris',ARRAY['Mulyadi','Aris'],'CONFIRMED');

    CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path=public,pg_catalog AS $$
      SELECT role FROM public.user_profiles WHERE id=auth.uid() AND active IS TRUE
    $$;
    CREATE FUNCTION public.get_my_name() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path=public,pg_catalog AS $$
      SELECT name FROM public.user_profiles WHERE id=auth.uid() AND active IS TRUE
    $$;
    CREATE FUNCTION public.is_my_job(p_job_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path=public,pg_catalog AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.orders o WHERE o.id=p_job_id AND
          (public.get_my_name() IN (o.teknisi,o.teknisi2,o.teknisi3,o.helper,o.helper2,o.helper3)
           OR public.get_my_name()=ANY(o.assigned_members))
      )
    $$;

    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    GRANT SELECT,UPDATE ON public.user_profiles,public.service_reports TO authenticated;
    GRANT SELECT ON public.orders TO authenticated;
  `);

  await db.exec(migration);

  await check('helper can submit first and becomes the accountable reporter', async () => {
    await authenticate(helper);
    const result = await submit(reportPayload(), 'Aris', 'report-submit:REPORT-1');
    assert.equal(result.replayed, false);
    const report = (await db.query("SELECT status,submitted_by_user_id FROM service_reports WHERE id='REPORT-1'" )).rows[0];
    assert.equal(report.status, 'SUBMITTED');
    assert.equal(report.submitted_by_user_id, helper);
  });

  await check('atomic submit releases both assigned crew without opening profile edits', async () => {
    const profiles = (await db.query("SELECT name,status FROM user_profiles WHERE name IN ('Mulyadi','Aris') ORDER BY name")).rows;
    assert.deepEqual(profiles, [{ name: 'Aris', status: 'active' }, { name: 'Mulyadi', status: 'active' }]);
    assert.equal((await db.query("SELECT status FROM orders WHERE id='JOB-1'")).rows[0].status, 'REPORT_SUBMITTED');
    await authenticate(helper);
    await assert.rejects(
      () => db.exec(`UPDATE user_profiles SET status='standby' WHERE id='${tech}'`),
      /Only your own status may be changed/,
    );
  });

  await check('teammate cannot create or replace the existing report', async () => {
    await authenticate(tech);
    await assert.rejects(
      () => submit(reportPayload({ id: 'REPORT-OTHER' }), 'Mulyadi', 'report-submit:REPORT-OTHER'),
      /sudah memiliki laporan/,
    );
    await assert.rejects(
      () => submit(reportPayload({ rekomendasi: 'Ubah oleh rekan' }), 'Mulyadi', 'report-submit:REPORT-1:teammate'),
      /Laporan terkunci/,
    );
    assert.equal((await db.query('SELECT count(*)::int AS count FROM service_reports')).rows[0].count, 1);
  });

  await check('original reporter is locked while report is SUBMITTED', async () => {
    await authenticate(helper);
    await assert.rejects(
      () => submit(reportPayload({ rekomendasi: 'Ubah sebelum revisi' }), 'Aris', 'report-submit:REPORT-1:early-edit'),
      /Laporan terkunci/,
    );
  });

  await check('only original reporter can resubmit after Owner requests REVISION', async () => {
    await authenticate(owner);
    await db.exec("UPDATE service_reports SET status='REVISION' WHERE id='REPORT-1'");

    await authenticate(tech);
    await assert.rejects(
      () => submit(reportPayload({ rekomendasi: 'Revisi oleh rekan' }), 'Mulyadi', 'report-submit:REPORT-1:wrong-revision'),
      /Laporan terkunci/,
    );

    await authenticate(helper);
    const result = await submit(
      reportPayload({ rekomendasi: 'Revisi oleh pengirim awal' }),
      'Aris',
      'report-submit:REPORT-1:revision-1',
    );
    assert.equal(result.report.status, 'SUBMITTED');
    const report = (await db.query("SELECT status,submitted_by_user_id,rekomendasi FROM service_reports WHERE id='REPORT-1'")).rows[0];
    assert.deepEqual(report, {
      status: 'SUBMITTED', submitted_by_user_id: helper, rekomendasi: 'Revisi oleh pengirim awal',
    });
  });

  await check('same mutation key replays without a duplicate write', async () => {
    await authenticate(helper);
    const replay = await submit(
      reportPayload({ rekomendasi: 'Revisi oleh pengirim awal' }),
      'Aris',
      'report-submit:REPORT-1:revision-1',
    );
    assert.equal(replay.replayed, true);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM service_reports')).rows[0].count, 1);
  });

  console.log(JSON.stringify({ checks, productionConnections: 0, productionWrites: 0 }));
} finally {
  await db.close();
}
