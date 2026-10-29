// Isolated PostgreSQL/WASM contract test. Synthetic units only; no production access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const baseline = readFileSync(new URL('../migrations/184_dashboard_installation_from_invoice_items.sql', import.meta.url), 'utf8');
const patch = readFileSync(new URL('../supabase/migrations/20261029224338_classify_dashboard_cleaning_vrv.sql', import.meta.url), 'utf8');

const units = [
  { tipe: 'AC Split Wall 1PK' },
  { tipe: 'AC Cassette 3PK' },
  { tipe: 'AC Split Duct 4PK' },
  { tipe: 'AC Floor Standing 2PK' },
  ...Array.from({ length: 30 }, () => ({ tipe: 'AC VRV Indoor' })),
  ...Array.from({ length: 12 }, () => ({ tipe: 'AC VRV Outdoor' })),
  { tipe: 'AC VRF' },
  { tipe: '' },
];

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.role', true), '')
    $$;
    CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT CASE WHEN auth.role() = 'authenticated' THEN 'Owner' ELSE NULL END
    $$;
    CREATE TABLE public.service_reports (
      id text PRIMARY KEY, job_id text, service text, units jsonb,
      total_units integer, status text, date date
    );
    CREATE TABLE public.invoices (
      id text PRIMARY KEY, job_id text, total numeric, repair_gratis text,
      status text, created_at timestamptz, materials_detail text
    );
    CREATE TABLE public.price_list (service text, type text, is_active boolean);
    SELECT set_config('test.role', 'authenticated', false);
  `);
  await db.exec(baseline);
  await db.query(
    'INSERT INTO public.service_reports VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)',
    ['R1', 'J1', 'Cleaning', JSON.stringify(units), units.length, 'VERIFIED', '2026-10-15'],
  );
  await db.exec(`
    INSERT INTO public.service_reports VALUES
      ('R2','J2','Cleaning','[]'::jsonb,2,'VERIFIED','2026-10-15'),
      ('R3','J3','Cleaning','[{"tipe":"AC VRV Indoor"}]'::jsonb,1,'SUBMITTED','2026-10-15'),
      ('R4','J4','Cleaning','[{"tipe":"AC VRV Indoor"}]'::jsonb,1,'VERIFIED','2026-09-15');
    INSERT INTO public.price_list VALUES ('Install','Pemasangan AC Baru 0,5PK - 1PK',true);
    INSERT INTO public.invoices VALUES
      ('I1','J1',200000,'false','PAID','2026-10-15T03:00:00Z',
       '[{"nama":"Pemasangan AC Baru 0,5PK - 1PK","jumlah":2}]');
  `);

  const getCounts = async () => (await db.query(
    "SELECT public.get_dashboard_monthly_work_summary(DATE '2026-10-01')->'counts' AS counts",
  )).rows[0].counts;

  const before = await getCounts();
  assert.equal(before.cleaning_total, 50);
  assert.equal(before.cleaning_other, 46);

  await db.exec(patch);
  const after = await getCounts();
  assert.equal(after.cleaning_total, 50);
  assert.deepEqual([
    after.cleaning_split_wall, after.cleaning_cassette,
    after.cleaning_split_duct, after.cleaning_standing,
    after.cleaning_vrv_indoor, after.cleaning_vrv_outdoor,
    after.cleaning_vrv_other, after.cleaning_other,
  ], [1, 1, 1, 1, 30, 12, 1, 3]);
  assert.equal(after.installation_units, 2);
  assert.equal(after.capacitor_units, before.capacitor_units);
  assert.equal(after.freon_total, before.freon_total);

  await db.query("SELECT set_config('test.role', 'anon', false)");
  const anonymous = (await db.query('SELECT auth.role() AS db_role, public.get_my_role() AS app_role')).rows[0];
  assert.equal(anonymous.db_role, 'anon');
  assert.equal(anonymous.app_role, null);
  await assert.rejects(getCounts, /hanya untuk Owner\/Admin/);
  console.log('PASS dashboard cleaning categories: 50 exclusive units, VRV/VRF split, legacy unknown preserved, installation unchanged, anon denied');
} finally {
  await db.close();
}
