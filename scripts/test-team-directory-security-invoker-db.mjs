import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(
  new URL('../migrations/236_team_directory_security_invoker.sql', import.meta.url),
  'utf8',
);
const db = new PGlite();

try {
  await db.exec(`
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.role', true), '')
    $$;
    CREATE TABLE public.user_profiles (
      id uuid PRIMARY KEY,
      name text,
      role text,
      status text,
      active boolean,
      color text,
      avatar text,
      skills text[],
      bank_account_no text
    );
    ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.user_profiles TO authenticated;
    CREATE POLICY profile_self_read ON public.user_profiles
      FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));
    CREATE FUNCTION public.get_my_role() RETURNS text
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
        SELECT role FROM public.user_profiles
        WHERE id = auth.uid() AND active IS TRUE
      $$;
    REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;
    INSERT INTO public.user_profiles VALUES
      ('00000000-0000-0000-0000-000000000001', 'Owner Fixture', 'Owner', 'active', true, '#111', null, ARRAY['manager'], 'OWNER-BANK-SECRET'),
      ('00000000-0000-0000-0000-000000000002', 'Admin Fixture', 'Admin', 'active', true, '#222', null, ARRAY['dispatch'], 'ADMIN-BANK-SECRET'),
      ('00000000-0000-0000-0000-000000000003', 'Finance Fixture', 'Finance', 'active', true, '#333', null, ARRAY['finance'], 'FINANCE-BANK-SECRET'),
      ('00000000-0000-0000-0000-000000000004', 'Teknisi Fixture', 'Teknisi', 'active', true, '#444', null, ARRAY['repair'], 'TEKNISI-BANK-SECRET'),
      ('00000000-0000-0000-0000-000000000005', 'Helper Fixture', 'Helper', 'active', true, '#555', null, ARRAY['cleaning'], 'HELPER-BANK-SECRET'),
      ('00000000-0000-0000-0000-000000000006', 'Inactive Fixture', 'Teknisi', 'inactive', false, '#666', null, ARRAY['inactive'], 'INACTIVE-BANK-SECRET');
  `);

  await db.exec(migration);

  const viewOptions = await db.query(`
    SELECT reloptions FROM pg_class
    WHERE oid = 'public.lab_team_directory'::regclass
  `);
  assert.ok(viewOptions.rows[0].reloptions.includes('security_invoker=true'));

  const safeColumns = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lab_team_directory'
    ORDER BY ordinal_position
  `);
  assert.deepEqual(safeColumns.rows.map((row) => row.column_name), [
    'id', 'name', 'role', 'status', 'active', 'color', 'avatar', 'skills',
  ]);

  async function readAs(userId, role, query) {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${userId}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false); SET ROLE authenticated;`);
    const result = await db.query(query);
    await db.exec('RESET ROLE');
    return result.rows;
  }

  for (const [userId, role] of [
    ['00000000-0000-0000-0000-000000000001', 'Owner'],
    ['00000000-0000-0000-0000-000000000002', 'Admin'],
    ['00000000-0000-0000-0000-000000000003', 'Finance'],
    ['00000000-0000-0000-0000-000000000004', 'Teknisi'],
    ['00000000-0000-0000-0000-000000000005', 'Helper'],
  ]) {
    const rows = await readAs(userId, role, 'SELECT * FROM public.lab_team_directory ORDER BY id');
    assert.equal(rows.length, 5, `${role} should see active teammates only`);
    assert.ok(rows.some((row) => row.role === 'Admin'), `${role} should retain roster visibility`);
    assert.ok(rows.every((row) => !('bank_account_no' in row)), 'directory exposed a private profile field');
  }

  const helperProfiles = await readAs(
    '00000000-0000-0000-0000-000000000005',
    'Helper',
    'SELECT id, bank_account_no FROM public.user_profiles',
  );
  assert.equal(helperProfiles.length, 1, 'field staff must retain own-row-only profile RLS');

  const inactiveDirectory = await readAs(
    '00000000-0000-0000-0000-000000000006',
    'Inactive Technician',
    'SELECT * FROM public.lab_team_directory',
  );
  assert.deepEqual(inactiveDirectory, [], 'inactive user must not retain directory access');

  const noProfile = await readAs(
    '00000000-0000-0000-0000-000000000099',
    'NoProfile',
    'SELECT * FROM public.lab_team_directory',
  );
  assert.deepEqual(noProfile, [], 'user without an active app profile must see no roster rows');

  await db.exec(`
    UPDATE public.user_profiles SET name = 'Helper Updated', skills = ARRAY['cleaning', 'repair']
    WHERE id = '00000000-0000-0000-0000-000000000005';
    UPDATE public.user_profiles SET active = false
    WHERE id = '00000000-0000-0000-0000-000000000002';
  `);
  const updatedDirectory = await readAs(
    '00000000-0000-0000-0000-000000000001',
    'Owner',
    'SELECT id, name, skills FROM public.lab_team_directory ORDER BY id',
  );
  assert.deepEqual(updatedDirectory.map((row) => row.name), [
    'Owner Fixture', 'Finance Fixture', 'Teknisi Fixture', 'Helper Updated',
  ]);
  assert.deepEqual(updatedDirectory[3].skills, ['cleaning', 'repair']);

  await db.exec(`
    DELETE FROM public.user_profiles
    WHERE id = '00000000-0000-0000-0000-000000000005';
  `);
  const directoryRows = await db.query('SELECT id FROM public.team_directory_safe ORDER BY id');
  assert.deepEqual(directoryRows.rows.map((row) => row.id), [
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
  ], 'profile deletion must remove its directory projection');

  console.log('PASS team directory security_invoker, RLS, safe columns, and trigger synchronization');
} finally {
  await db.close();
}
