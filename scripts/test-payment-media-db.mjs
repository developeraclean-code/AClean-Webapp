// Real PostgreSQL semantics in isolation; no production credentials/network.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.WA_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE payment_suggestions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),media_job_id uuid,status text);
    CREATE UNIQUE INDEX uq_payment_suggestions_media_job ON payment_suggestions(media_job_id) WHERE media_job_id IS NOT NULL;`);
  const insert=`INSERT INTO payment_suggestions(media_job_id,status) VALUES('10000000-0000-4000-8000-000000000001','PENDING') ON CONFLICT(media_job_id) DO NOTHING`;
  await assert.rejects(()=>db.exec(insert),/no unique or exclusion constraint/);
  console.log('PASS reproduces production 42P10 before migration');
  const migration=fs.readFileSync(new URL('../migrations/197_payment_media_repair.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);
  await db.exec(insert);await db.exec(insert);
  assert.equal((await db.query('SELECT count(*)::int n FROM payment_suggestions')).rows[0].n,1);
  await db.exec(`UPDATE payment_suggestions SET status='CONFIRMED';`);await db.exec(insert);
  assert.equal((await db.query('SELECT status FROM payment_suggestions')).rows[0].status,'CONFIRMED');
  await db.exec(`INSERT INTO payment_suggestions(status) VALUES('PENDING'),('PENDING');`);
  assert.equal((await db.query('SELECT count(*)::int n FROM payment_suggestions')).rows[0].n,3);
  console.log('PASS migration idempotency, duplicate suppression, resolved status preservation, legacy NULL media IDs');
} finally { await db.close(); }
