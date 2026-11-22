import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../migrations/250_shared_weekly_schedule_notes.sql', import.meta.url), 'utf8');
const db = new PGlite();
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.user_profiles(id uuid PRIMARY KEY, name text, role text, active boolean);
    INSERT INTO public.user_profiles VALUES
      ('${uid(1)}', 'Owner Fixture', 'Owner', true),
      ('${uid(2)}', 'Admin Satu', 'Admin', true),
      ('${uid(3)}', 'Admin Dua', 'Admin', true),
      ('${uid(4)}', 'Finance Fixture', 'Finance', true),
      ('${uid(5)}', 'Admin Nonaktif', 'Admin', false);
  `);
  await db.exec(migration);

  const actAs = async id => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${id || ''}', false); SET ROLE authenticated;`);
  const reset = async () => db.exec('RESET ROLE;');
  const save = async ({ id = '2026-11-23-team-1', actor = 1, expected = 0, name = 'Team 1', text = 'Jam 9: Pelanggan / 628123456789 / Cleaning', mutation = crypto.randomUUID(), deleted = false, date = '2026-11-23', week = '2026-11-23' } = {}) => {
    await actAs(uid(actor));
    try {
      const result = await db.query(`SELECT public.save_schedule_note_block($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result`, [id, week, date, name, text, 0, expected, mutation, deleted]);
      return result.rows[0].result;
    } finally { await reset(); }
  };
  const firstMutation = crypto.randomUUID();
  const first = await save({ mutation: firstMutation });
  assert.equal(first.row.version, 1, 'initial note should persist with version 1');
  assert.equal(first.row.updated_by, 'Owner Fixture');
  const replay = await save({ expected: 0, mutation: firstMutation });
  assert.equal(replay.replayed, true, 'retry with same mutation should be idempotent');
  assert.equal(replay.row.version, 1);
  await assert.rejects(save({ mutation: firstMutation, text: 'payload berbeda' }), /digunakan untuk perubahan yang berbeda/);

  await actAs(uid(2));
  await assert.rejects(
    db.query(`SELECT public.save_schedule_note_block($1,$2,$3,$4,$5,$6,$7,$8,$9)`, ['2026-11-23-team-1', '2026-11-23', '2026-11-23', 'Team 1', 'admin dua stale', 0, 0, crypto.randomUUID(), false]),
    /diubah oleh/,
    'stale second admin must not overwrite the first admin',
  );
  await reset();
  const second = await save({ actor: 3, expected: 1, text: 'Perubahan Admin Dua', name: 'Team Operasional' });
  assert.equal(second.row.version, 2);
  assert.equal(second.row.updated_by, 'Admin Dua');

  await actAs(uid(1));
  const read = await db.query('SELECT id, content, version FROM public.schedule_note_blocks');
  assert.equal(read.rows[0].content, 'Perubahan Admin Dua');
  await reset();

  await actAs(uid(4));
  assert.equal((await db.query('SELECT * FROM public.schedule_note_blocks')).rows.length, 0, 'Finance must not read schedule notes');
  await assert.rejects(db.query(`SELECT public.save_schedule_note_block('x','2026-11-23','2026-11-23','T','x',0,0,gen_random_uuid(),false)`), /Hanya Owner\/Admin/);
  await reset();
  await actAs(uid(5));
  await assert.rejects(db.query(`SELECT public.save_schedule_note_block('x','2026-11-23','2026-11-23','T','x',0,0,gen_random_uuid(),false)`), /Hanya Owner\/Admin/);
  await reset();
  await db.exec('SET ROLE anon');
  await assert.rejects(db.query('SELECT * FROM public.schedule_note_blocks'), /permission denied/);
  await reset();

  await assert.rejects(save({ id: 'bad-date', date: '2026-11-29', week: '2026-11-23' }), /Data catatan jadwal tidak valid/);
  await assert.rejects(save({ id: 'too-long', text: 'x'.repeat(30001) }), /Data catatan jadwal tidak valid/);
  const tombstone = await save({ expected: 2, deleted: true });
  assert.equal(tombstone.row.is_deleted, true, 'deletion should be a retained soft-delete row');
  assert.equal(tombstone.row.version, 3);

  console.log('PASS: owner/admin access, shared reads, idempotent retry, optimistic conflict, soft delete, input bounds, inactive/Finance/anon denial.');
} finally {
  await db.close();
}
