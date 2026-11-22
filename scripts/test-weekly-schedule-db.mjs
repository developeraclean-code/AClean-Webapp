import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../migrations/250_shared_weekly_schedule_notes.sql', import.meta.url), 'utf8');
const planningMigration = await readFile(new URL('../migrations/251_schedule_note_planning_confirmation.sql', import.meta.url), 'utf8');
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
      ('${uid(5)}', 'Admin Nonaktif', 'Admin', false),
      ('${uid(6)}', 'Teknisi QA', 'Teknisi', true);
  `);
  await db.exec(migration);
  await db.exec(`
    CREATE TABLE public.orders (
      id text PRIMARY KEY, customer text, phone text, address text, area text,
      service text, type text, units integer, teknisi text, helper text,
      date date, time time, time_end time, status text, team_slot text,
      notes text, source text, dispatch boolean NOT NULL DEFAULT false
    );
    GRANT SELECT ON public.orders TO authenticated;
    CREATE FUNCTION public.create_order_workflow_atomic(jsonb, boolean, text, text)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    DECLARE saved public.orders%ROWTYPE;
    BEGIN
      IF $2 THEN RAISE EXCEPTION 'schedule notes must not auto-dispatch'; END IF;
      INSERT INTO public.orders(id,customer,phone,address,area,service,type,units,teknisi,helper,date,time,time_end,status,team_slot,notes,source,dispatch)
      VALUES($1->>'id',$1->>'customer',$1->>'phone',$1->>'address',$1->>'area',$1->>'service',$1->>'type',($1->>'units')::integer,
        $1->>'teknisi',$1->>'helper',($1->>'date')::date,($1->>'time')::time,($1->>'time_end')::time,'CONFIRMED',$1->>'team_slot',$1->>'notes',$1->>'source',false)
      RETURNING * INTO saved;
      RETURN jsonb_build_object('order',to_jsonb(saved),'customer',NULL,'replayed',false);
    END $$;
  `);
  await db.exec(planningMigration);

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

  await save({ id: '2026-11-24-team-1', date: '2026-11-24', expected: 0, text: 'Jam 9: Pelanggan QA / Cleaning / 628123456789 / Alamat QA' });
  const job = (id, time) => ({ id, customer: 'Pelanggan QA', phone: '628123456789', address: 'Alamat QA blok A',
    area: '', service: 'Cleaning', type: 'AC Split 0.5-1PK', units: 1, teknisi: 'Teknisi QA', helper: null,
    date: '2026-11-24', time, time_end: time === '09:00' ? '10:30' : '12:30', team_slot: 'Team 01', notes: 'Job QA' });
  await actAs(uid(1));
  const confirmed = await db.query('SELECT public.confirm_schedule_note_team($1,$2,$3,$4) AS result', [
    '2026-11-24-team-1', 1, [job('JOB-SN-QA-1', '09:00'), job('JOB-SN-QA-2', '11:00')], 'Owner Fixture',
  ]);
  const confirmation = confirmed.rows[0].result;
  assert.equal(confirmation.orders.length, 2, 'confirm creates every valid job in the team');
  assert.equal(confirmation.already_confirmed, false);
  assert.equal(confirmation.note.planning_order_ids.length, 2);
  assert.equal(confirmation.note.version, 2, 'confirmation advances the note version');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.orders WHERE source='schedule_note' AND status='CONFIRMED' AND dispatch=false")).rows[0].n, 2);
  await reset();

  await actAs(uid(3));
  const replayedConfirmation = await db.query('SELECT public.confirm_schedule_note_team($1,$2,$3,$4) AS result', [
    '2026-11-24-team-1', 1, [job('JOB-SN-RETRY-1', '09:00'), job('JOB-SN-RETRY-2', '11:00')], 'Admin Dua',
  ]);
  assert.equal(replayedConfirmation.rows[0].result.already_confirmed, true, 'second admin loads existing order IDs instead of inserting duplicates');
  assert.deepEqual(replayedConfirmation.rows[0].result.order_ids, confirmation.order_ids);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.orders WHERE source='schedule_note'")).rows[0].n, 2);
  await assert.rejects(
    db.query("SELECT public.save_schedule_note_block($1,$2,$3,$4,$5,$6,$7,$8,$9)", ['2026-11-24-team-1','2026-11-23','2026-11-24','Team 1','Jam 10: edit setelah dibuat',0,2,crypto.randomUUID(),false]),
    /sudah menjadi Planning Order/,
    'confirmed schedule groups must be edited through Planning Order',
  );
  await reset();

  const beforeInvalidBatch = (await db.query('SELECT count(*)::int AS n FROM public.orders')).rows[0].n;
  await save({ id: '2026-11-25-team-1', date: '2026-11-25', expected: 0, text: 'Jam 9: Pelanggan QA / Cleaning / 628123456789 / Alamat QA' });
  await actAs(uid(1));
  await assert.rejects(
    db.query('SELECT public.confirm_schedule_note_team($1,$2,$3,$4)', [
      '2026-11-25-team-1', 1, [job('JOB-SN-ROLLBACK-1', '09:00'), { ...job('JOB-SN-ROLLBACK-2', '11:00'), teknisi: '' }], 'Owner Fixture',
    ]),
    /belum lengkap atau tidak valid/,
    'one invalid job must reject the complete team batch',
  );
  await reset();
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.orders')).rows[0].n, beforeInvalidBatch, 'failed batches leave no partial orders');

  console.log('PASS: note access, shared edits, optimistic conflict, soft delete, atomic team confirmation, retry dedup, immutability after confirmation, invalid-batch rollback, and role denials.');
} finally {
  await db.close();
}
